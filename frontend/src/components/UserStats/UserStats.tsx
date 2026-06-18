/**
 * Full-screen User Stats dashboard overlay.
 *
 * Opened from the desktop ProfileBand ("See more stats") and the mobile settings
 * dropdown. Fetches the merged stats payload (platform ratings/records + the
 * analysis-derived rollups) once on open and renders it as curated sections with
 * hand-rolled CSS/SVG visuals (no chart dependency, matching the codebase style).
 */

import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { fetchUserStatsFull } from '../../api/client';
import type { UserFullStats } from '../../api/client';
import { BLUNDER_CATEGORIES, UNCATEGORIZED_CATEGORY } from '../../constants/blunderCategories';
import { TimeClassIcon } from '../TimeClassIcons';
import './UserStats.css';

// ── Types ────────────────────────────────────────────────────────────────────

interface UserStatsProps {
  /** Linked platform handle whose stats are shown. */
  handle: string;
  /** "chesscom" | "lichess". */
  platform: string;
}

// Time classes shown in the ratings grid, in display order.
const RATING_CLASSES: readonly ('rapid' | 'blitz' | 'bullet' | 'daily')[] = ['rapid', 'blitz', 'bullet', 'daily'];

// Move-level breakdown rows reused for phase / colour / severity sections.
const PHASE_ROWS: readonly { key: string; label: string; color: string }[] = [
  { key: 'opening', label: 'Opening', color: '#3b82f6' },
  { key: 'middlegame', label: 'Middlegame', color: '#a855f7' },
  { key: 'endgame', label: 'Endgame', color: '#f97316' },
];

const COLOR_ROWS: readonly { key: string; label: string; color: string }[] = [
  { key: 'white', label: 'As White', color: '#cbd5e1' },
  { key: 'black', label: 'As Black', color: '#475569' },
];

const SEVERITY_ROWS: readonly { key: string; label: string; color: string }[] = [
  { key: 'minor', label: 'Minor (3–5)', color: '#eab308' },
  { key: 'major', label: 'Major (5–9)', color: '#f97316' },
  { key: 'critical', label: 'Critical (9+)', color: '#ef4444' },
];

// ── Formatting helpers ───────────────────────────────────────────────────────

/** Format a possibly-null percentage as "67%" or an em dash. */
function formatPct(value: number | null): string {
  if (value === null) {
    return '—';
  }

  return `${Math.round(value)}%`;
}

/** Format a possibly-null number to one decimal, or an em dash. */
function formatDecimal(value: number | null): string {
  if (value === null) {
    return '—';
  }

  return value.toFixed(1);
}

/** Sum the values of a count map. */
function sumValues(map: Record<string, number>): number {
  return Object.values(map).reduce((acc, n) => acc + n, 0);
}

// ── Small presentational pieces ──────────────────────────────────────────────

interface StatTileProps {
  value: string;
  label: string;
  accent?: boolean;
}

function StatTile({ value, label, accent = false }: StatTileProps): JSX.Element {
  return (
    <div className="ustat__tile">
      <span className={`ustat__tile-val${accent ? ' ustat__tile-val--gold' : ''}`}>{value}</span>
      <span className="ustat__tile-lbl">{label}</span>
    </div>
  );
}

interface BarRowProps {
  label: string;
  count: number;
  total: number;
  color: string;
}

/** A single labelled horizontal bar with count + percentage. */
function BarRow({ label, count, total, color }: BarRowProps): JSX.Element {
  let pct: number;

  if (total > 0) {
    pct = (count / total) * 100;
  } else {
    pct = 0;
  }

  return (
    <div className="ustat__bar-row">
      <span className="ustat__bar-lbl">
        <span className="ustat__bar-dot" style={{ background: color }} />
        {label}
      </span>
      <div className="ustat__bar-track">
        <div className="ustat__bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="ustat__bar-val">
        {count}
        <span className="ustat__bar-pct">{Math.round(pct)}%</span>
      </span>
    </div>
  );
}

interface BreakdownProps {
  rows: readonly { key: string; label: string; color: string }[];
  counts: Record<string, number>;
}

/** Render a set of bar rows over a shared total (phase / colour / severity). */
function Breakdown({ rows, counts }: BreakdownProps): JSX.Element {
  const total = sumValues(counts);

  return (
    <div className="ustat__bars">
      {rows.map((row, index) => (
        <BarRow
          key={`breakdown-${row.key}-${index}`}
          label={row.label}
          count={counts[row.key] ?? 0}
          total={total}
          color={row.color}
        />
      ))}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

function UserStats({ handle, platform }: UserStatsProps): JSX.Element {
  const [stats, setStats] = useState<UserFullStats | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);

  // Fetch the full payload once when the panel mounts (or the handle changes).
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: show the loader while the fetch runs
    setLoading(true);
    setError(false);

    async function load(): Promise<void> {
      try {
        const result = await fetchUserStatsFull(handle, platform);

        if (!cancelled) {
          setStats(result);
        }
      } catch {
        if (!cancelled) {
          setError(true);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [handle, platform]);

  // Ordered blunder categories (filterable types first, then the fallback).
  const orderedCategories = [...BLUNDER_CATEGORIES, UNCATEGORIZED_CATEGORY];

  function renderBody(): JSX.Element {
    if (loading) {
      return <div className="ustat__state">Loading your stats…</div>;
    }

    if (error || stats === undefined) {
      return <div className="ustat__state">Couldn't load your stats. Try again later.</div>;
    }

    const { account, training, engagement, blunder_types, phases, colors, severity } = stats;
    const totalBlunders = sumValues(blunder_types);

    return (
      <div className="ustat__body">
        {/* ── Section A — Platform ratings & records ── */}
        <section className="ustat__section">
          <h3 className="ustat__section-title">Ratings &amp; records</h3>
          <div className="ustat__ratings">
            {RATING_CLASSES.map((tc, index) => {
              const record = account.ratings[tc];

              if (record === undefined) {
                return null;
              }

              const games = record.wins + record.losses + record.draws;
              let winRate: number;

              if (games > 0) {
                winRate = (record.wins / games) * 100;
              } else {
                winRate = 0;
              }

              return (
                <div className="ustat__rating-card" key={`rating-${tc}-${index}`}>
                  <div className="ustat__rating-head">
                    <TimeClassIcon tc={tc} size={16} />
                    <span className="ustat__rating-tc">{tc.charAt(0).toUpperCase() + tc.slice(1)}</span>
                  </div>
                  <span className="ustat__rating-num">{record.current ?? '—'}</span>
                  <span className="ustat__rating-peak">Peak {record.peak ?? '—'}</span>
                  <div className="ustat__rating-wld">
                    <span className="ustat__wld-w">{record.wins}W</span>
                    <span className="ustat__wld-d">{record.draws}D</span>
                    <span className="ustat__wld-l">{record.losses}L</span>
                  </div>
                  <div className="ustat__bar-track ustat__bar-track--thin">
                    <div className="ustat__bar-fill" style={{ width: `${winRate}%`, background: 'var(--success)' }} />
                  </div>
                  <span className="ustat__rating-rate">{Math.round(winRate)}% win rate</span>
                </div>
              );
            })}
          </div>
          <div className="ustat__tiles">
            <StatTile value={String(account.total_games)} label="Rated games played" />
            <StatTile value={formatPct(account.overall_win_rate)} label="Overall win rate" accent />
            {account.followers !== null && (
              <StatTile value={String(account.followers)} label="Followers" />
            )}
            {account.country !== null && (
              <StatTile value={account.country} label="Country" />
            )}
          </div>
        </section>

        {/* ── Section B — Training activity ── */}
        <section className="ustat__section">
          <h3 className="ustat__section-title">Training activity</h3>
          <div className="ustat__tiles">
            <StatTile value={String(training.games_analysed)} label="Games analysed" />
            <StatTile value={String(training.total_blunders)} label="Blunders detected" />
            <StatTile value={formatDecimal(training.avg_blunders)} label="Avg blunders / game" accent />
            <StatTile value={formatPct(training.win_rate)} label="Win rate (analysed)" />
            <StatTile value={String(training.clean_games)} label="Clean games" />
            <StatTile value={String(training.most_blunders_in_game)} label="Most in one game" />
          </div>

          {/* Per-time-class analysed breakdown */}
          {Object.keys(training.games_analysed_by_class).length > 0 && (
            <div className="ustat__class-table">
              {Object.entries(training.games_analysed_by_class).map(([tc, count], index) => (
                <div className="ustat__class-row" key={`class-${tc}-${index}`}>
                  <span className="ustat__class-tc">{tc.charAt(0).toUpperCase() + tc.slice(1)}</span>
                  <div className="ustat__class-metrics">
                    <span className="ustat__class-meta">{count} games</span>
                    <span className="ustat__class-meta">
                      {formatDecimal(training.avg_blunders_by_class[tc] ?? null)} avg
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Sections D + E — Blunder repartition & move-level breakdowns,
            laid out 2-by-2 on desktop. ── */}
        <div className="ustat__cols">
          <section className="ustat__section ustat__section--col">
            <h3 className="ustat__section-title">Blunder types</h3>
            <div className="ustat__bars">
              {orderedCategories.map((category, index) => (
                <BarRow
                  key={`cat-${category.key}-${index}`}
                  label={category.label}
                  count={blunder_types[category.key] ?? 0}
                  total={totalBlunders}
                  color={category.color}
                />
              ))}
            </div>
          </section>
          <section className="ustat__section ustat__section--col">
            <h3 className="ustat__section-title">By game phase</h3>
            <Breakdown rows={PHASE_ROWS} counts={phases} />
          </section>
        </div>

        <div className="ustat__cols">
          <section className="ustat__section ustat__section--col">
            <h3 className="ustat__section-title">By colour</h3>
            <Breakdown rows={COLOR_ROWS} counts={colors} />
          </section>
          <section className="ustat__section ustat__section--col">
            <h3 className="ustat__section-title">By severity</h3>
            <Breakdown rows={SEVERITY_ROWS} counts={severity} />
          </section>
        </div>

        {/* ── Section C — Engagement ── */}
        <section className="ustat__section">
          <h3 className="ustat__section-title">Review engagement</h3>
          <div className="ustat__tiles">
            <StatTile value={String(engagement.games_reviewed)} label="Games reviewed" />
            <StatTile value={String(engagement.positions_drilled)} label="Positions drilled" accent />
            <StatTile value={formatPct(engagement.review_coverage)} label="Review coverage" />
            <StatTile value={formatPct(engagement.drill_rate)} label="Drill rate" />
            <StatTile value={`${engagement.current_review_streak}d`} label="Current streak" />
            <StatTile value={`${engagement.longest_review_streak}d`} label="Longest streak" />
          </div>
        </section>
      </div>
    );
  }

  return <div className="ustat">{renderBody()}</div>;
}

export default UserStats;
