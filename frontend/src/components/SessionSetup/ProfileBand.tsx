/** Profile band displayed at the top of the menu card — avatar, ratings, and session stats. */

import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { fetchUserProfile } from '../../api/client';
import type { UserProfileResponse } from '../../api/client';
import { TimeClassIcon } from '../TimeClassIcons';
import chesscomLogo from '../../assets/chesscom_logo.png';
import lichessLogo from '../../assets/Lichess_logo.png';
import './ProfileBand.css';

// ── Types ──────────────────────────────────────────────────────────────────

interface ProfileBandProps {
  username: string;
  avatar: string | undefined;
  platform: string | undefined;
  /** Win-rate over the last 30 days (0–100), undefined if no games loaded yet. */
  winRate30d: number | undefined;
  /** Number of games in the loaded list that have been analysed by Stockfish. */
  gamesAnalysed: number;
  /** Total blunders across reviewed games in the loaded list. */
  blundersDrilled: number;
  /** Average blunders per game across all analysed games in the loaded list. */
  avgBlunders: number | undefined;
}

// ── Component ──────────────────────────────────────────────────────────────

function ProfileBand({
  username,
  avatar,
  platform,
  winRate30d,
  blundersDrilled,
  avgBlunders,
}: ProfileBandProps): JSX.Element {
  const [imgFailed, setImgFailed] = useState<boolean>(false);
  const [ratings, setRatings] = useState<UserProfileResponse | undefined>(undefined);
  const [ratingsLoading, setRatingsLoading] = useState<boolean>(true);

  const platformLabel = platform === 'lichess' ? 'Lichess' : 'Chess.com';
  const fallbackSrc = platform === 'lichess' ? lichessLogo : chesscomLogo;
  const showAvatar = avatar && !imgFailed;

  // Fetch ratings from the backend on mount / username change.
  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const result = await fetchUserProfile(username, platform ?? 'chesscom');

        if (!cancelled) {
          setRatings(result);
        }
      } catch {
        // Silently fail — ratings just won't show if the fetch fails.
      } finally {
        if (!cancelled) {
          setRatingsLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [username, platform]);

  const winRateLabel = winRate30d !== undefined ? `${Math.round(winRate30d)}%` : '—';

  return (
    <div className="profile-band">
      {/* Avatar */}
      <div className="profile-band__avatar">
        {showAvatar ? (
          <img
            src={avatar}
            alt={username}
            className="profile-band__avatar-img"
            onError={() => setImgFailed(true)}
          />
        ) : (
          <img
            src={fallbackSrc}
            alt={platformLabel}
            className="profile-band__avatar-img profile-band__avatar-img--logo"
          />
        )}
      </div>

      {/* Name + platform + ratings */}
      <div className="profile-band__info">
        <div className="profile-band__namerow">
          <span className="profile-band__name">{username}</span>
          <span className="profile-band__platform">
            {platformLabel}
            {ratings?.joined_year !== null && ratings?.joined_year !== undefined && (
              <>
                <i className="profile-band__dot" />
                Member since {ratings.joined_year}
              </>
            )}
          </span>
        </div>

        {platform !== 'lichess' && (
          <div className="profile-band__ratings">
            {/* Skeleton pills while the profile fetch is in flight */}
            {ratingsLoading && (
              <>
                <div className="profile-band__rating-pill profile-band__rating-pill--skeleton" />
                <div className="profile-band__rating-pill profile-band__rating-pill--skeleton" />
                <div className="profile-band__rating-pill profile-band__rating-pill--skeleton" />
              </>
            )}

            {!ratingsLoading && ratings?.rapid_rating !== null && ratings?.rapid_rating !== undefined && (
              <div className="profile-band__rating-pill" title="Rapid rating">
                <TimeClassIcon tc="rapid" size={15} />
                <b>{ratings.rapid_rating}</b>
                <span>Rapid</span>
              </div>
            )}
            {!ratingsLoading && ratings?.blitz_rating !== null && ratings?.blitz_rating !== undefined && (
              <div className="profile-band__rating-pill" title="Blitz rating">
                <TimeClassIcon tc="blitz" size={15} />
                <b>{ratings.blitz_rating}</b>
                <span>Blitz</span>
              </div>
            )}
            {!ratingsLoading && ratings?.bullet_rating !== null && ratings?.bullet_rating !== undefined && (
              <div className="profile-band__rating-pill" title="Bullet rating">
                <TimeClassIcon tc="bullet" size={15} />
                <b>{ratings.bullet_rating}</b>
                <span>Bullet</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="profile-band__stats">
        <div className="profile-band__stat">
          <span className="profile-band__stat-num">{winRateLabel}</span>
          <span className="profile-band__stat-lbl">Win rate<br />Loaded Games</span>
        </div>
        <div className="profile-band__stat">
          <span className="profile-band__stat-num profile-band__stat-num--alt">{blundersDrilled}</span>
          <span className="profile-band__stat-lbl">Blunders<br />drilled</span>
        </div>
        <div className="profile-band__stat">
          <span className="profile-band__stat-num profile-band__stat-num--alt">
            {avgBlunders !== undefined ? avgBlunders.toFixed(1) : '—'}
          </span>
          <span className="profile-band__stat-lbl">Avg blunders<br />per game</span>
        </div>
      </div>
    </div>
  );
}

export default ProfileBand;
