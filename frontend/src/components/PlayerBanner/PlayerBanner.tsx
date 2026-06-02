import type { JSX } from 'react';
import './PlayerBanner.css';

interface PlayerBannerProps {
  username: string;
  rating: number | undefined;
  timeRemaining: string | null | undefined;
  pieceColor: 'white' | 'black';
}

function formatTime(t: string | null | undefined): string {
  if (!t) {
    return '';
  }
  const parts = t.split(':');
  if (parts.length !== 3) {
    return t;
  }
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const s = parts[2];
  if (h === 0) {
    return `${m}:${s}`;
  }
  return t;
}

function PlayerBanner({ username, rating, timeRemaining, pieceColor }: PlayerBannerProps): JSX.Element {
  const pieceIcon = pieceColor === 'white' ? '♔' : '♚';
  const formattedTime = formatTime(timeRemaining);

  return (
    <div className={`player-banner player-banner--${pieceColor}`}>
      <div className="player-banner__identity">
        <span className={`player-banner__piece player-banner__piece--${pieceColor}`}>
          {pieceIcon}
        </span>
        <span className="player-banner__username">{username || (pieceColor === 'white' ? 'White' : 'Black')}</span>
        {rating !== undefined && rating > 0 && (
          <span className="player-banner__rating">{rating}</span>
        )}
      </div>
      {formattedTime && (
        <div className="player-banner__time">
          {formattedTime}
        </div>
      )}
    </div>
  );
}

export default PlayerBanner;
