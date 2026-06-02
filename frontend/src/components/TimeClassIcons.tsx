/** Shared colored time-class SVG icons used across the app. */

import type { JSX } from 'react';

// Green stopwatch — rapid
export function IconRapid({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#4caf50"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M19 7L20.5 5.5" />
      <path d="M22 6L20 4" />
      <path d="M21 13.25C21 18.218 16.968 22.25 12 22.25C7.032 22.25 3 18.218 3 13.25C3 8.282 7.032 4.25 12 4.25C16.968 4.25 21 8.282 21 13.25Z" />
      <path d="M12 8.25V13.25" />
      <path d="M9 1.75L15 1.75" />
    </svg>
  );
}

// Yellow filled lightning bolt — blitz
export function IconBlitz({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="#ffc107"
      stroke="#ffc107"
      strokeWidth="0.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <polygon points="25,16 19,16 26,3 14,3 7,16 13,16 7,29" />
    </svg>
  );
}

// Gold/brown filled bullet — bullet
export function IconBullet({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="#c8861f"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M495.212,16.785c-44.125-44.141-188.297,5.875-250.078,67.656S61.79,267.8,61.79,267.8l182.406,182.407c0,0,121.563-121.579,183.359-183.36C489.321,205.082,539.337,60.91,495.212,16.785z" />
      <polygon points="0.009,329.597 182.399,512.004 217.712,476.691 35.306,294.285" />
    </svg>
  );
}

// Green chess clock — daily
export function IconDaily({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="#4caf50"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M16 2C16 1.44772 16.4477 1 17 1H18H19C19.5523 1 20 1.44772 20 2C20 2.55228 19.5523 3 19 3V5C20.6569 5 22 6.34315 22 8V20C22 21.6569 20.6569 23 19 23H5C3.34315 23 2 21.6569 2 20V8C2 6.34315 3.34315 5 5 5V4C4.44772 4 4 3.55228 4 3C4 2.44772 4.44772 2 5 2H6H7C7.55228 2 8 2.44772 8 3C8 3.55228 7.55228 4 7 4V5H17V3C16.4477 3 16 2.55228 16 2ZM6 7H18H19C19.5523 7 20 7.44772 20 8V20C20 20.5523 19.5523 21 19 21H5C4.44772 21 4 20.5523 4 20V8C4 7.44772 4.44772 7 5 7H6ZM12 8C12.5523 8 13 8.44771 13 9V13.4648L15.5547 15.1679C16.0142 15.4743 16.1384 16.0952 15.8321 16.5547C15.5257 17.0142 14.9048 17.1384 14.4453 16.8321L11.4453 14.8321C11.1671 14.6466 11 14.3344 11 14V9C11 8.44771 11.4477 8 12 8ZM7 15C7.55228 15 8 14.5523 8 14C8 13.4477 7.55228 13 7 13C6.44772 13 6 13.4477 6 14C6 14.5523 6.44772 15 7 15ZM18 14C18 14.5523 17.5523 15 17 15C16.4477 15 16 14.5523 16 14C16 13.4477 16.4477 13 17 13C17.5523 13 18 13.4477 18 14ZM12 20C12.5523 20 13 19.5523 13 19C13 18.4477 12.5523 18 12 18C11.4477 18 11 18.4477 11 19C11 19.5523 11.4477 20 12 20Z"
      />
    </svg>
  );
}

// Dispatcher used in tables and selects
export function TimeClassIcon({ tc, size = 16 }: { tc: string; size?: number }): JSX.Element {
  const normalized = tc.toLowerCase();

  if (normalized === 'bullet') {
    return <IconBullet size={size} />;
  }

  if (normalized === 'blitz') {
    return <IconBlitz size={size} />;
  }

  if (normalized === 'daily') {
    return <IconDaily size={size} />;
  }

  // Default: rapid
  return <IconRapid size={size} />;
}
