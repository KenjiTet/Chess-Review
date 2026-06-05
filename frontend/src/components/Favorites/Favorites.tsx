/** Scrollable list/grid of bookmarked blunder positions. */

import type { JSX, MouseEvent } from 'react';
import useFavorites from '../../hooks/useFavorites';
import type { FavoritePosition } from '../../hooks/useFavorites';
import './Favorites.css';

export type FavLayout = 'blocks' | 'inline';

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ── Block card ─────────────────────────────────────────────────────────────

interface FavCardProps {
  fav: FavoritePosition;
  onOpen?: (fav: FavoritePosition) => void;
}

function FavCard({ fav, onOpen }: FavCardProps): JSX.Element {
  const removeFavorite = useFavorites((s) => s.removeFavorite);

  function handleRemove(e: MouseEvent<HTMLButtonElement>): void {
    e.stopPropagation();
    removeFavorite(fav.id);
  }

  function handleOpen(): void {
    onOpen?.(fav);
  }

  return (
    <div
      className={`fav-card${onOpen ? ' fav-card--clickable' : ''}`}
      onClick={handleOpen}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleOpen();
        }
      }}
    >
      <div className="fav-card__board-wrap">
        <img
          className="fav-card__board"
          src={fav.boardImageDataUrl}
          alt={`Board — ${fav.blunderDescription}`}
        />
        <button
          className="fav-card__remove"
          type="button"
          onClick={handleRemove}
          title="Remove"
        >
          ✕
        </button>
      </div>

      <div className="fav-card__footer">
        <span className={`fav-card__badge fav-card__badge--${fav.classification}`}>
          {fav.classification} · {fav.cpLoss}cp
        </span>
        <p className="fav-card__desc">{fav.blunderDescription}</p>
        {fav.note && (
          <p className="fav-card__note">{fav.note}</p>
        )}
        <span className="fav-card__date">{formatDate(fav.date)}</span>
      </div>
    </div>
  );
}

// ── Inline row ─────────────────────────────────────────────────────────────

interface FavRowProps {
  fav: FavoritePosition;
  onOpen?: (fav: FavoritePosition) => void;
}

function FavRow({ fav, onOpen }: FavRowProps): JSX.Element {
  const removeFavorite = useFavorites((s) => s.removeFavorite);

  function handleRemove(e: MouseEvent<HTMLButtonElement>): void {
    e.stopPropagation();
    removeFavorite(fav.id);
  }

  function handleOpen(): void {
    onOpen?.(fav);
  }

  return (
    <div
      className={`fav-row${onOpen ? ' fav-row--clickable' : ''}`}
      onClick={handleOpen}
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          handleOpen();
        }
      }}
    >
      <img
        className="fav-row__board"
        src={fav.boardImageDataUrl}
        alt={`Board — ${fav.blunderDescription}`}
      />

      <div className="fav-row__info">
        <div className="fav-row__meta-row">
          <span className={`fav-row__badge fav-row__badge--${fav.classification}`}>
            {fav.classification} · {fav.cpLoss}cp
          </span>
          <span className="fav-row__date">{formatDate(fav.date)}</span>
        </div>
        <p className="fav-row__desc">{fav.blunderDescription}</p>
        {fav.note && (
          <p className="fav-row__note">{fav.note}</p>
        )}
      </div>

      <button
        className="fav-row__remove"
        type="button"
        onClick={handleRemove}
        title="Remove"
      >
        ✕
      </button>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

interface FavoritesProps {
  onOpen?: (fav: FavoritePosition) => void;
  layout?: FavLayout;
}

function Favorites({ onOpen, layout = 'blocks' }: FavoritesProps): JSX.Element {
  const favorites = useFavorites((s) => s.favorites);

  if (favorites.length === 0) {
    return (
      <div className="fav-empty">
        <span className="fav-empty__icon">★</span>
        <p className="fav-empty__text">No saved positions yet.</p>
        <p className="fav-empty__sub">
          Press <strong>Save Position</strong> while training to bookmark a blunder.
        </p>
      </div>
    );
  }

  if (layout === 'blocks') {
    return (
      <div className="fav-grid">
        {favorites.map((fav, idx) => (
          <FavCard key={`fav-card-${fav.id}-${idx}`} fav={fav} onOpen={onOpen} />
        ))}
      </div>
    );
  }

  return (
    <div className="fav-rows">
      {favorites.map((fav, idx) => (
        <FavRow key={`fav-row-${fav.id}-${idx}`} fav={fav} onOpen={onOpen} />
      ))}
    </div>
  );
}

export default Favorites;
