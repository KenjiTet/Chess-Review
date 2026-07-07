/**
 * Sticky player header shown at the top of every menu page inside the shell.
 *
 * Surfaces the linked Chess.com/Lichess profile — avatar, name, ratings and the
 * shared stats — via the existing ProfileBand, driven by the shell-level
 * MenuData context so the numbers match the content below it.
 */

import type { JSX } from 'react';
import ProfileBand from '../SessionSetup/ProfileBand';
import { useMenuData } from './MenuDataContext';
import './ProfileHeader.css';

function ProfileHeader(): JSX.Element | null {
  const { playerUsername, platform, avatar, menuStats, statItems, timeClass, setTimeClass } = useMenuData();

  // Nothing meaningful to show until a platform handle is known.
  if (!playerUsername) {
    return null;
  }

  return (
    <div className="profile-header">
      <ProfileBand
        username={playerUsername}
        avatar={avatar}
        platform={platform}
        ratings={menuStats.ratings}
        ratingsLoading={menuStats.ratingsLoading}
        statItems={statItems}
        activeTimeClass={timeClass}
        onSelectTimeClass={setTimeClass}
      />
    </div>
  );
}

export default ProfileHeader;
