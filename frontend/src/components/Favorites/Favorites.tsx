/** Scrollable list of bookmarked blunder positions. */

import type { JSX, MouseEvent } from 'react';
import useFavorites from '../../hooks/useFavorites';
import type { FavoritePosition } from '../../hooks/useFavorites';
import './Favorites.css';

function formatDate(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

interface FavoriteItemProps {
  fav: FavoritePosition;
  onOpen?: (fav: FavoritePosition) => void;
}

function FavoriteItem({ fav, onOpen }: FavoriteItemProps): JSX.Element {
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
      className={`fav-item${onOpen ? ' fav-item--clickable' : ''}`}
      onClick={handleOpen}
    >
      <div className="fav-item__header">
        <span className="fav-item__date">{formatDate(fav.date)}</span>
        <button
          className="fav-item__remove"
          type="button"
          onClick={handleRemove}
          title="Remove"
        >
          ✕
        </button>
      </div>

      <div className="fav-item__body">
        <img
          className="fav-item__board"
          src={fav.boardImageDataUrl}
          alt={`Board — ${fav.blunderDescription}`}
        />
        <div className="fav-item__info">
          <span className={`fav-item__badge fav-item__badge--${fav.classification}`}>
            {fav.classification}
          </span>
          <p className="fav-item__desc">{fav.blunderDescription}</p>
          {fav.note && (
            <p className="fav-item__note">{fav.note}</p>
          )}
        </div>
      </div>
    </div>
  );
}

interface FavoritesProps {
  onOpen?: (fav: FavoritePosition) => void;
}

function Favorites({ onOpen }: FavoritesProps): JSX.Element {
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

  return (
    <div className="fav-list">
      {favorites.map((fav, idx) => (
        <FavoriteItem key={`fav-item-${fav.id}-${idx}`} fav={fav} onOpen={onOpen} />
      ))}
    </div>
  );
}

export default Favorites;
