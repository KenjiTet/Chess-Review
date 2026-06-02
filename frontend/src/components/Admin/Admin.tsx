/** Admin dashboard — live DB inspection. Only rendered for the admin account. */

import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import {
  adminGetCache,
  adminGetStats,
  adminGetUsers,
  type AdminCacheEntry,
  type AdminStats,
  type AdminUser,
} from '../../api/client';
import './Admin.css';

type Tab = 'stats' | 'users' | 'cache';

function Admin(): JSX.Element {
  const [tab, setTab] = useState<Tab>('stats');
  const [stats, setStats] = useState<AdminStats | undefined>(undefined);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [cache, setCache] = useState<AdminCacheEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  async function loadTab(t: Tab): Promise<void> {
    setLoading(true);
    setError('');

    try {
      if (t === 'stats') {
        const data = await adminGetStats();
        setStats(data);
      } else if (t === 'users') {
        const data = await adminGetUsers();
        setUsers(data);
      } else if (t === 'cache') {
        const data = await adminGetCache(100);
        setCache(data);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load data.');
    } finally {
      setLoading(false);
    }
  }

  function handleTab(t: Tab): void {
    setTab(t);
    void loadTab(t);
  }

  // Load stats on first render.
  useEffect(() => {
    void loadTab('stats');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function renderStats(): JSX.Element {
    if (!stats) {
      return <p className="admin__empty">No data.</p>;
    }

    return (
      <div className="admin__stats">
        <div className="admin__stat-card">
          <span className="admin__stat-value">{stats.total_users}</span>
          <span className="admin__stat-label">Registered users</span>
        </div>
        <div className="admin__stat-card">
          <span className="admin__stat-value">{stats.total_cached_games}</span>
          <span className="admin__stat-label">Cached games</span>
        </div>
      </div>
    );
  }

  function renderUsers(): JSX.Element {
    if (users.length === 0) {
      return <p className="admin__empty">No users found.</p>;
    }

    return (
      <table className="admin__table">
        <thead>
          <tr>
            <th>Username</th>
            <th>Created at</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u, i) => (
            <tr key={`user-${u.username_lower}-${i}`}>
              <td>{u.username}</td>
              <td>{u.created_at}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function renderCache(): JSX.Element {
    if (cache.length === 0) {
      return <p className="admin__empty">No cached games.</p>;
    }

    return (
      <table className="admin__table">
        <thead>
          <tr>
            <th>Game URL</th>
            <th>Analysed at</th>
            <th>Depth</th>
          </tr>
        </thead>
        <tbody>
          {cache.map((c, i) => (
            <tr key={`cache-${i}`}>
              <td>
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="admin__link">
                  {c.url.replace('https://www.chess.com/game/live/', '')}
                </a>
              </td>
              <td>{c.analysed_at}</td>
              <td>{c.depth}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <div className="admin">
      <div className="admin__header">
        <h1 className="admin__title">Admin Dashboard</h1>
        <button className="admin__refresh" type="button" onClick={() => handleTab(tab)}>
          ↺ Refresh
        </button>
      </div>

      <nav className="admin__tabs">
        {(['stats', 'users', 'cache'] as Tab[]).map((t) => (
          <button
            key={`tab-${t}`}
            className={`admin__tab${tab === t ? ' admin__tab--active' : ''}`}
            type="button"
            onClick={() => handleTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </nav>

      <div className="admin__content">
        {loading && <p className="admin__loading">Loading…</p>}
        {!loading && error && <p className="admin__error">{error}</p>}
        {!loading && !error && tab === 'stats' && renderStats()}
        {!loading && !error && tab === 'users' && renderUsers()}
        {!loading && !error && tab === 'cache' && renderCache()}
      </div>
    </div>
  );
}

export default Admin;
