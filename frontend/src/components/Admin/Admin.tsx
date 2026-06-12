/** Admin dashboard — live DB inspection. Only rendered for the admin account. */

import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import {
  adminGetCache,
  adminGetQueueStatus,
  adminGetStats,
  adminGetUsers,
  adminGetUserStats,
  type AdminCacheEntry,
  type AdminQueueStatus,
  type AdminStats,
  type AdminUser,
  type AdminUserStat,
} from '../../api/client';
import './Admin.css';

type Tab = 'stats' | 'users' | 'userStats' | 'queue' | 'cache';

function Admin(): JSX.Element {
  const [tab, setTab] = useState<Tab>('stats');
  const [stats, setStats] = useState<AdminStats | undefined>(undefined);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userStats, setUserStats] = useState<AdminUserStat[]>([]);
  const [queue, setQueue] = useState<AdminQueueStatus | undefined>(undefined);
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
      } else if (t === 'userStats') {
        const data = await adminGetUserStats();
        setUserStats(data);
      } else if (t === 'queue') {
        const data = await adminGetQueueStatus();
        setQueue(data);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTab('stats');
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
        <div className="admin__stat-card">
          <span className="admin__stat-value">{stats.total_analysed_games}</span>
          <span className="admin__stat-label">Analysed games (per-user)</span>
        </div>
      </div>
    );
  }

  function renderUserStats(): JSX.Element {
    if (userStats.length === 0) {
      return <p className="admin__empty">No analysed games yet.</p>;
    }

    return (
      <table className="admin__table">
        <thead>
          <tr>
            <th>User</th>
            <th>Analysed</th>
            <th>Total blunders</th>
            <th>Avg / game</th>
            <th>W / D / L</th>
            <th>Drilled</th>
          </tr>
        </thead>
        <tbody>
          {userStats.map((u, i) => (
            <tr key={`ustat-${u.username_lower}-${i}`}>
              <td>{u.username}</td>
              <td>{u.games_analysed}</td>
              <td>{u.total_blunders}</td>
              <td>{u.avg_blunders.toFixed(1)}</td>
              <td>{u.wins} / {u.draws} / {u.losses}</td>
              <td>{u.blunders_drilled}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function renderQueue(): JSX.Element {
    if (!queue) {
      return <p className="admin__empty">No data.</p>;
    }

    const pending = Object.entries(queue.pending_by_stream);

    return (
      <div className="admin__stats">
        <div className="admin__stat-card">
          <span className="admin__stat-value">{queue.mode}</span>
          <span className="admin__stat-label">Mode ({queue.running ? 'running' : 'stopped'})</span>
        </div>
        <div className="admin__stat-card">
          <span className="admin__stat-value">{queue.analysed_total}</span>
          <span className="admin__stat-label">Analysed this run</span>
        </div>
        <div className="admin__stat-card">
          <span className="admin__stat-value">{queue.in_flight.length} / {queue.concurrency}</span>
          <span className="admin__stat-label">In flight / concurrency</span>
        </div>
        <div className="admin__stat-card">
          <span className="admin__stat-value">{queue.poll_interval}s</span>
          <span className="admin__stat-label">Poll interval</span>
        </div>

        <table className="admin__table" style={{ marginTop: '1rem', gridColumn: '1 / -1' }}>
          <thead>
            <tr>
              <th>Stream (user / platform)</th>
              <th>Pending backfill</th>
            </tr>
          </thead>
          <tbody>
            {pending.length === 0 && (
              <tr><td colSpan={2}>Backfill complete — polling for new games.</td></tr>
            )}
            {pending.map(([stream, count], i) => (
              <tr key={`queue-${stream}-${i}`}>
                <td>{stream}</td>
                <td>{count}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
            <th>Admin</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u, i) => (
            <tr key={`user-${u.username_lower}-${i}`}>
              <td>{u.username}</td>
              <td>{u.created_at}</td>
              <td>{u.is_admin ? '✓' : ''}</td>
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
        {([
          ['stats', 'Stats'],
          ['users', 'Users'],
          ['userStats', 'User stats'],
          ['queue', 'Queue'],
          ['cache', 'Cache'],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={`tab-${t}`}
            className={`admin__tab${tab === t ? ' admin__tab--active' : ''}`}
            type="button"
            onClick={() => handleTab(t)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="admin__content">
        {loading && <p className="admin__loading">Loading…</p>}
        {!loading && error && <p className="admin__error">{error}</p>}
        {!loading && !error && tab === 'stats' && renderStats()}
        {!loading && !error && tab === 'users' && renderUsers()}
        {!loading && !error && tab === 'userStats' && renderUserStats()}
        {!loading && !error && tab === 'queue' && renderQueue()}
        {!loading && !error && tab === 'cache' && renderCache()}
      </div>
    </div>
  );
}

export default Admin;
