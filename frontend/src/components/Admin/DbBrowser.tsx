/**
 * Interactive database browser for the admin panel.
 *
 * IDE-style data view over the whole SQLite database: pick a table from the
 * sidebar, page through its rows, and edit / insert / delete inline. Every
 * mutation hits the validated admin DB endpoints and then re-fetches the page so
 * the grid always reflects what's actually stored.
 */

import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import {
  adminDbDeleteRow,
  adminDbInsertRow,
  adminDbTable,
  adminDbTables,
  adminDbUpdateRow,
  type DbCellValue,
  type DbColumn,
  type DbTablePage,
  type DbTableSummary,
} from '../../api/client';
import './DbBrowser.css';

// Rows fetched per page. Kept modest so tables with large JSON blobs (game_cache)
// don't return multi-megabyte payloads in a single request.
const PAGE_SIZE = 50;

// ── Value helpers ────────────────────────────────────────────────────────────

/** Render a raw cell value for an <input> (null becomes an empty string). */
function toInputString(value: DbCellValue): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value);
}

/**
 * Coerce a raw input string back to the type the column expects before sending.
 * An empty cell is treated as NULL (the DB rejects it when the column is NOT
 * NULL, and that error is surfaced to the admin).
 */
function coerceValue(column: DbColumn | undefined, raw: string): DbCellValue {
  if (raw === '') {
    return null;
  }

  const type = (column?.type ?? '').toUpperCase();

  if (type.includes('INT')) {
    const parsed = Number(raw);

    if (Number.isFinite(parsed)) {
      return parsed;
    }

    return raw;
  }

  if (type.includes('REAL') || type.includes('FLOA') || type.includes('DOUB') || type.includes('NUM')) {
    const parsed = Number(raw);

    if (Number.isFinite(parsed)) {
      return parsed;
    }

    return raw;
  }

  return raw;
}

/** Build a stable string identity for a row from its primary-key columns. */
function rowIdentity(row: Record<string, DbCellValue>, primaryKey: string[]): string {
  return primaryKey.map((col) => `${col}=${String(row[col])}`).join('&');
}

/** Extract the identity-key map (column -> original value) for a row. */
function rowKey(row: Record<string, DbCellValue>, primaryKey: string[]): Record<string, DbCellValue> {
  const key: Record<string, DbCellValue> = {};

  for (const col of primaryKey) {
    key[col] = row[col];
  }

  return key;
}

// ── Component ────────────────────────────────────────────────────────────────

function DbBrowser(): JSX.Element {
  const [tables, setTables] = useState<DbTableSummary[]>([]);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [page, setPage] = useState<DbTablePage | undefined>(undefined);
  const [offset, setOffset] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  // Pending edits keyed by row identity, then column name -> raw input string.
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  // Draft values for the "add row" form, keyed by column name.
  const [newRow, setNewRow] = useState<Record<string, string>>({});

  // Load the table list once on mount.
  useEffect(() => {
    async function loadTables(): Promise<void> {
      try {
        const data = await adminDbTables();
        setTables(data);

        if (data.length > 0) {
          setSelected(data[0].name);
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to load tables.');
      }
    }

    void loadTables();
  }, []);

  // Fetch a page of the selected table whenever the table or offset changes.
  const loadPage = useCallback(async (table: string, pageOffset: number): Promise<void> => {
    setLoading(true);
    setError('');
    setEdits({});
    setNewRow({});

    try {
      const data = await adminDbTable(table, PAGE_SIZE, pageOffset);
      setPage(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load table.');
      setPage(undefined);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selected === undefined) {
      return;
    }

    void loadPage(selected, offset);
  }, [selected, offset, loadPage]);

  function handleSelectTable(name: string): void {
    setSelected(name);
    setOffset(0);
  }

  function handleEditCell(identity: string, column: string, value: string): void {
    setEdits((prev) => ({
      ...prev,
      [identity]: {
        ...prev[identity],
        [column]: value,
      },
    }));
  }

  function handleNewCell(column: string, value: string): void {
    setNewRow((prev) => ({ ...prev, [column]: value }));
  }

  // Reload the current page after a mutation.
  async function reload(): Promise<void> {
    if (selected !== undefined) {
      await loadPage(selected, offset);
    }
  }

  async function handleSaveRow(row: Record<string, DbCellValue>): Promise<void> {
    if (page === undefined || selected === undefined) {
      return;
    }

    const identity = rowIdentity(row, page.primary_key);
    const edited = edits[identity];

    if (edited === undefined) {
      return;
    }

    const updates: Record<string, DbCellValue> = {};

    for (const [col, raw] of Object.entries(edited)) {
      const column = page.columns.find((c) => c.name === col);
      updates[col] = coerceValue(column, raw);
    }

    setBusy(true);
    setError('');

    try {
      await adminDbUpdateRow(selected, rowKey(row, page.primary_key), updates);
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Update failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteRow(row: Record<string, DbCellValue>): Promise<void> {
    if (page === undefined || selected === undefined) {
      return;
    }

    const confirmed = window.confirm('Delete this row? This cannot be undone.');

    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError('');

    try {
      await adminDbDeleteRow(selected, rowKey(row, page.primary_key));
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setBusy(false);
    }
  }

  async function handleInsertRow(): Promise<void> {
    if (page === undefined || selected === undefined) {
      return;
    }

    const values: Record<string, DbCellValue> = {};

    // Omit blank fields so the DB applies its column defaults.
    for (const [col, raw] of Object.entries(newRow)) {
      if (raw !== '') {
        const column = page.columns.find((c) => c.name === col);
        values[col] = coerceValue(column, raw);
      }
    }

    if (Object.keys(values).length === 0) {
      setError('Fill in at least one column to add a row.');
      return;
    }

    setBusy(true);
    setError('');

    try {
      await adminDbInsertRow(selected, values);
      await reload();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Insert failed.');
    } finally {
      setBusy(false);
    }
  }

  function renderSidebar(): JSX.Element {
    return (
      <aside className="dbb__sidebar">
        {tables.map((t, index) => (
          <button
            key={`dbtable-${t.name}-${index}`}
            type="button"
            className={`dbb__table-btn${selected === t.name ? ' dbb__table-btn--active' : ''}`}
            onClick={() => handleSelectTable(t.name)}
          >
            <span className="dbb__table-name">{t.name}</span>
            <span className="dbb__table-count">{t.row_count}</span>
          </button>
        ))}
      </aside>
    );
  }

  function renderGrid(): JSX.Element {
    if (loading) {
      return <p className="dbb__state">Loading…</p>;
    }

    if (page === undefined) {
      return <p className="dbb__state">Select a table.</p>;
    }

    const isDirty = (identity: string): boolean => {
      return edits[identity] !== undefined && Object.keys(edits[identity]).length > 0;
    };

    return (
      <div className="dbb__grid-wrap">
        <table className="dbb__grid">
          <thead>
            <tr>
              {page.columns.map((col, index) => (
                <th key={`col-${col.name}-${index}`}>
                  {col.name}
                  {col.pk > 0 && <span className="dbb__pk">PK</span>}
                  <span className="dbb__coltype">{col.type}</span>
                </th>
              ))}
              <th className="dbb__actions-col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {/* Add-row form as the first row. */}
            <tr className="dbb__new-row">
              {page.columns.map((col, index) => (
                <td key={`new-${col.name}-${index}`}>
                  <input
                    className="dbb__input"
                    value={newRow[col.name] ?? ''}
                    placeholder={col.dflt_value !== null ? `default: ${col.dflt_value}` : 'NULL'}
                    onChange={(e) => handleNewCell(col.name, e.target.value)}
                  />
                </td>
              ))}
              <td className="dbb__actions-col">
                <button type="button" className="dbb__btn dbb__btn--add" disabled={busy} onClick={() => void handleInsertRow()}>
                  + Add
                </button>
              </td>
            </tr>

            {page.rows.map((row, rowIndex) => {
              const identity = rowIdentity(row, page.primary_key);
              const dirty = isDirty(identity);

              return (
                <tr key={`row-${identity}-${rowIndex}`}>
                  {page.columns.map((col, colIndex) => {
                    const edited = edits[identity]?.[col.name];
                    const value = edited !== undefined ? edited : toInputString(row[col.name]);
                    const isNull = edited === undefined && row[col.name] === null;

                    return (
                      <td key={`cell-${identity}-${col.name}-${colIndex}`}>
                        <input
                          className={`dbb__input${isNull ? ' dbb__input--null' : ''}`}
                          value={value}
                          placeholder={isNull ? 'NULL' : ''}
                          onChange={(e) => handleEditCell(identity, col.name, e.target.value)}
                        />
                      </td>
                    );
                  })}
                  <td className="dbb__actions-col">
                    <button
                      type="button"
                      className="dbb__btn dbb__btn--save"
                      disabled={!dirty || busy}
                      onClick={() => void handleSaveRow(row)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="dbb__btn dbb__btn--del"
                      disabled={busy}
                      onClick={() => void handleDeleteRow(row)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  function renderPager(): JSX.Element | undefined {
    if (page === undefined) {
      return undefined;
    }

    const start = page.total === 0 ? 0 : offset + 1;
    const end = Math.min(offset + PAGE_SIZE, page.total);
    const canPrev = offset > 0;
    const canNext = offset + PAGE_SIZE < page.total;

    return (
      <div className="dbb__pager">
        <span className="dbb__pager-info">
          {start}–{end} of {page.total}
        </span>
        <button
          type="button"
          className="dbb__btn"
          disabled={!canPrev || busy}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
        >
          ‹ Prev
        </button>
        <button
          type="button"
          className="dbb__btn"
          disabled={!canNext || busy}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          Next ›
        </button>
      </div>
    );
  }

  return (
    <div className="dbb">
      {renderSidebar()}
      <div className="dbb__main">
        {error && <p className="dbb__error">{error}</p>}
        {renderGrid()}
        {renderPager()}
      </div>
    </div>
  );
}

export default DbBrowser;
