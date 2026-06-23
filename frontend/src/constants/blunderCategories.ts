/**
 * Blunder category definitions — shared by the SessionSetup filter, the
 * GameHistory breakdown modal, and the Trainer pill.
 *
 * Keys MUST stay in sync with backend/services/categorize.py.
 */

export interface BlunderCategory {
  /** Stable key sent to / received from the backend. */
  key: string;
  /** Human-readable label shown in pills and the modal. */
  label: string;
  /** Solid accent colour (text / icon). */
  color: string;
  /** Translucent background for the pill. */
  bg: string;
  /** Border colour for the pill. */
  border: string;
  /** Short phrase describing the mistake, used in the trainer prompt banner. */
  prompt: string;
  /** Terse gerund phrase used in the compact (mobile) banner, e.g. "missing a gain". */
  shortPrompt: string;
}

/** Ordered list of the filterable / displayable categories. */
export const BLUNDER_CATEGORIES: BlunderCategory[] = [
  {
    key: 'missed_mate',
    label: 'Missed Mate',
    color: '#a855f7',
    bg: 'rgba(168, 85, 247, 0.12)',
    border: 'rgba(168, 85, 247, 0.35)',
    prompt: 'you missed a forced checkmate',
    shortPrompt: 'missing a forced mate',
  },
  {
    key: 'allowed_mate',
    label: 'Allowed Mate',
    color: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.12)',
    border: 'rgba(239, 68, 68, 0.35)',
    prompt: 'you allowed a forced checkmate',
    shortPrompt: 'allowing a forced mate',
  },
  {
    key: 'material_loss',
    label: 'Hung Material',
    color: '#f97316',
    bg: 'rgba(249, 115, 22, 0.12)',
    border: 'rgba(249, 115, 22, 0.35)',
    prompt: 'you lost material',
    shortPrompt: 'hanging material',
  },
  {
    key: 'missed_gain',
    label: 'Missed Gain',
    color: '#3b82f6',
    bg: 'rgba(59, 130, 246, 0.12)',
    border: 'rgba(59, 130, 246, 0.35)',
    prompt: 'you missed a chance to win material',
    shortPrompt: 'missing a gain',
  },
];

/** Default red pill shown in the trainer when a blunder has no displayable category. */
export const DEFAULT_BLUNDER_CATEGORY: BlunderCategory = {
  key: 'blunder',
  label: 'Blunder',
  color: '#ef4444',
  bg: 'rgba(239, 68, 68, 0.12)',
  border: 'rgba(239, 68, 68, 0.35)',
  prompt: 'this was a blunder',
  shortPrompt: 'blundering',
};

/** Fallback shown for legacy blunders whose category could not be recovered. */
export const UNCATEGORIZED_CATEGORY: BlunderCategory = {
  key: 'uncategorized',
  label: 'Uncategorized',
  color: '#94a3b8',
  bg: 'rgba(148, 163, 184, 0.12)',
  border: 'rgba(148, 163, 184, 0.35)',
  prompt: 'you blundered',
  shortPrompt: 'blundering',
};

/** Lookup map by key, including the uncategorized fallback. */
export const BLUNDER_CATEGORY_BY_KEY: Record<string, BlunderCategory> = {
  ...Object.fromEntries(BLUNDER_CATEGORIES.map((category) => [category.key, category])),
  [UNCATEGORIZED_CATEGORY.key]: UNCATEGORIZED_CATEGORY,
};

/** All filterable category keys (excludes the uncategorized fallback). */
export const ALL_CATEGORY_KEYS: string[] = BLUNDER_CATEGORIES.map((category) => category.key);

/**
 * Resolve a category by key, or undefined for keys with no displayable type
 * (e.g. positional / uncategorized) so the UI can omit the pill entirely.
 */
export function getBlunderCategory(key: string): BlunderCategory | undefined {
  return BLUNDER_CATEGORY_BY_KEY[key];
}
