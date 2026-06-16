/** Profile band displayed at the top of the menu card — avatar, ratings, and session stats. */

import { useState } from 'react';
import type { JSX } from 'react';
import type { UserProfileResponse } from '../../api/client';
import type { MenuStatItem } from '../../hooks/useMenuStats';
import { TimeClassIcon } from '../TimeClassIcons';
import chesscomLogo from '../../assets/chesscom_logo.png';
import lichessLogo from '../../assets/Lichess_logo.png';
import './ProfileBand.css';

// ── Types ──────────────────────────────────────────────────────────────────

interface ProfileBandProps {
  username: string;
  avatar: string | undefined;
  platform: string | undefined;
  /** Platform profile (ratings, avatar, joined year) — lifted to useMenuStats. */
  ratings: UserProfileResponse | undefined;
  /** True while the profile fetch is in flight. */
  ratingsLoading: boolean;
  /** Ordered, layout-independent stat list shared with the mobile layout. */
  statItems: MenuStatItem[];
  /** Currently selected time-control filter, used to highlight the matching rating pill. */
  activeTimeClass: string | undefined;
  /** Called when a rating pill is clicked — filters recent games by that time control. */
  onSelectTimeClass: (tc: 'rapid' | 'blitz' | 'bullet') => void;
}

// ── Component ──────────────────────────────────────────────────────────────

function ProfileBand({
  username,
  avatar,
  platform,
  ratings,
  ratingsLoading,
  statItems,
  activeTimeClass,
  onSelectTimeClass,
}: ProfileBandProps): JSX.Element {
  const [imgFailed, setImgFailed] = useState<boolean>(false);

  const platformLabel = platform === 'lichess' ? 'Lichess' : 'Chess.com';
  const fallbackSrc = platform === 'lichess' ? lichessLogo : chesscomLogo;
  // Prefer the avatar fetched for the linked handle; fall back to the auth-store avatar.
  const avatarSrc = ratings?.avatar ?? avatar;
  const showAvatar = avatarSrc && !imgFailed;

  return (
    <div className="profile-band">
      {/* Avatar */}
      <div className="profile-band__avatar">
        {showAvatar ? (
          <img
            src={avatarSrc}
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
              <button
                type="button"
                className={`profile-band__rating-pill${activeTimeClass === 'rapid' ? ' profile-band__rating-pill--active' : ''}`}
                title="Filter recent games by Rapid"
                onClick={() => onSelectTimeClass('rapid')}
              >
                <TimeClassIcon tc="rapid" size={15} />
                <b>{ratings.rapid_rating}</b>
                <span>Rapid</span>
              </button>
            )}
            {!ratingsLoading && ratings?.blitz_rating !== null && ratings?.blitz_rating !== undefined && (
              <button
                type="button"
                className={`profile-band__rating-pill${activeTimeClass === 'blitz' ? ' profile-band__rating-pill--active' : ''}`}
                title="Filter recent games by Blitz"
                onClick={() => onSelectTimeClass('blitz')}
              >
                <TimeClassIcon tc="blitz" size={15} />
                <b>{ratings.blitz_rating}</b>
                <span>Blitz</span>
              </button>
            )}
            {!ratingsLoading && ratings?.bullet_rating !== null && ratings?.bullet_rating !== undefined && (
              <button
                type="button"
                className={`profile-band__rating-pill${activeTimeClass === 'bullet' ? ' profile-band__rating-pill--active' : ''}`}
                title="Filter recent games by Bullet"
                onClick={() => onSelectTimeClass('bullet')}
              >
                <TimeClassIcon tc="bullet" size={15} />
                <b>{ratings.bullet_rating}</b>
                <span>Bullet</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Stats — rendered from the shared stat list (same set as mobile). */}
      <div className="profile-band__stats">
        {statItems.map((item, index) => {
          const isFirst = index === 0;

          return (
            <div className="profile-band__stat" key={`profile-stat-${item.key}-${index}`}>
              <span className={`profile-band__stat-num${isFirst ? '' : ' profile-band__stat-num--alt'}`}>
                {item.value}
              </span>
              <span className="profile-band__stat-lbl">
                {item.label}
                <br />
                {item.sublabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default ProfileBand;
