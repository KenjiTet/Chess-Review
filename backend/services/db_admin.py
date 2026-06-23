"""Generic SQLite table browser/editor backing the admin panel.

Exposes the whole database the way an IDE's data view does: list every table,
page through its rows, and insert / update / delete rows.

Identifiers (table and column names) can't be parametrised in SQL, so every name
is validated against the live schema before it is ever interpolated into a query.
Row values always go through bound parameters. Row identity uses each table's
declared primary key (composite keys supported), falling back to the implicit
rowid for the (currently non-existent) case of a table without one.
"""

import sqlite3
from typing import Any

from services.db import get_connection

# Tables hidden from the generic browser. Empty for now, but kept as a single
# place to exclude internal bookkeeping tables should any be added later.
_HIDDEN_TABLES: frozenset[str] = frozenset()


def _table_names(conn: sqlite3.Connection) -> list[str]:
    """Return the names of all user tables, sorted, excluding hidden ones."""
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()

    return [row["name"] for row in rows if row["name"] not in _HIDDEN_TABLES]


def _require_table(conn: sqlite3.Connection, table: str) -> None:
    """Raise ValueError unless `table` is a real, non-hidden table.

    Validating against the live schema is what makes it safe to interpolate the
    table name into the subsequent query.
    """
    if table not in _table_names(conn):
        raise ValueError(f"Unknown table '{table}'.")


def _columns(conn: sqlite3.Connection, table: str) -> list[dict]:
    """Return PRAGMA table_info rows for a (validated) table as plain dicts."""
    rows = conn.execute(f'PRAGMA table_info("{table}")').fetchall()

    return [dict(row) for row in rows]


def _primary_key(columns: list[dict]) -> list[str]:
    """Return the primary-key column names in key order (empty when none)."""
    pk_cols: list[dict] = [col for col in columns if col["pk"]]
    pk_cols.sort(key=lambda col: col["pk"])

    return [col["name"] for col in pk_cols]


def _identity_columns(columns: list[dict]) -> list[str]:
    """Return the columns used to address a single row: the PK, else rowid."""
    pk: list[str] = _primary_key(columns)

    if pk:
        return pk

    return ["rowid"]


def _validate_columns(columns: list[dict], names: list[str], allow_rowid: bool = False) -> None:
    """Raise ValueError if any name is not a real column of the table."""
    valid: set[str] = {col["name"] for col in columns}

    if allow_rowid:
        valid.add("rowid")

    for name in names:
        if name not in valid:
            raise ValueError(f"Unknown column '{name}'.")


def list_tables() -> list[dict]:
    """Return every table with its row count and column names.

    Returns:
        List of dicts: {name, row_count, columns} for the table sidebar.
    """
    with get_connection() as conn:
        result: list[dict] = []

        for name in _table_names(conn):
            count: int = conn.execute(f'SELECT COUNT(*) FROM "{name}"').fetchone()[0]
            columns: list[dict] = _columns(conn, name)
            result.append({
                "name": name,
                "row_count": count,
                "columns": [col["name"] for col in columns],
            })

        return result


def get_table(table: str, limit: int, offset: int) -> dict:
    """Return a page of rows plus column metadata for one table.

    Args:
        table: Table name (validated against the schema).
        limit: Maximum rows to return.
        offset: Rows to skip (pagination).

    Returns:
        Dict with column metadata, primary key, the page of rows, and the total
        row count.

    Raises:
        ValueError: If the table does not exist.
    """
    with get_connection() as conn:
        _require_table(conn, table)

        columns: list[dict] = _columns(conn, table)
        identity: list[str] = _identity_columns(columns)
        total: int = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]

        # Surface rowid only when the table has no declared primary key, so the
        # editor still has a stable handle on each row.
        if identity == ["rowid"]:
            select: str = f'SELECT rowid AS rowid, * FROM "{table}" LIMIT ? OFFSET ?'
        else:
            select = f'SELECT * FROM "{table}" LIMIT ? OFFSET ?'

        rows = conn.execute(select, (limit, offset)).fetchall()

        return {
            "table": table,
            "columns": columns,
            "primary_key": identity,
            "rows": [dict(row) for row in rows],
            "total": total,
        }


def update_row(table: str, key: dict[str, Any], updates: dict[str, Any]) -> int:
    """Update a single row identified by its primary-key values.

    Args:
        table: Table name (validated).
        key: Map of identity column -> original value addressing the row.
        updates: Map of column -> new value to write.

    Returns:
        Number of rows affected (0 when the key matched nothing).

    Raises:
        ValueError: On unknown table/column or empty update.
    """
    if not updates:
        raise ValueError("No columns to update.")

    with get_connection() as conn:
        _require_table(conn, table)

        columns: list[dict] = _columns(conn, table)
        _validate_columns(columns, list(updates.keys()))
        _validate_columns(columns, list(key.keys()), allow_rowid=True)

        set_clause: str = ", ".join(f'"{col}" = ?' for col in updates)
        where_clause: str = " AND ".join(f'"{col}" = ?' for col in key)
        params: list[Any] = list(updates.values()) + list(key.values())

        cursor = conn.execute(f'UPDATE "{table}" SET {set_clause} WHERE {where_clause}', params)
        conn.commit()

        return cursor.rowcount


def insert_row(table: str, values: dict[str, Any]) -> dict:
    """Insert a new row.

    Args:
        table: Table name (validated).
        values: Map of column -> value. Columns may be omitted to take defaults.

    Returns:
        Dict with the number of rows inserted.

    Raises:
        ValueError: On unknown table/column or empty payload.
    """
    if not values:
        raise ValueError("No values to insert.")

    with get_connection() as conn:
        _require_table(conn, table)

        columns: list[dict] = _columns(conn, table)
        _validate_columns(columns, list(values.keys()))

        col_clause: str = ", ".join(f'"{col}"' for col in values)
        placeholders: str = ", ".join("?" for _ in values)

        cursor = conn.execute(
            f'INSERT INTO "{table}" ({col_clause}) VALUES ({placeholders})',
            list(values.values()),
        )
        conn.commit()

        return {"inserted": cursor.rowcount}


def delete_row(table: str, key: dict[str, Any]) -> int:
    """Delete a single row identified by its primary-key values.

    Args:
        table: Table name (validated).
        key: Map of identity column -> value addressing the row.

    Returns:
        Number of rows deleted.

    Raises:
        ValueError: On unknown table/column or empty key.
    """
    if not key:
        raise ValueError("No key provided.")

    with get_connection() as conn:
        _require_table(conn, table)

        columns: list[dict] = _columns(conn, table)
        _validate_columns(columns, list(key.keys()), allow_rowid=True)

        where_clause: str = " AND ".join(f'"{col}" = ?' for col in key)

        cursor = conn.execute(f'DELETE FROM "{table}" WHERE {where_clause}', list(key.values()))
        conn.commit()

        return cursor.rowcount
