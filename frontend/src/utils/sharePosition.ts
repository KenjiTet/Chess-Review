/** Encode/decode shareable position payloads as base64url query params. */

export interface SharePayload {
  /** FEN of the blunder position. */
  fen: string;
  /** Raw color from BlunderResponse ('w' | 'b'). */
  color: string;
  move_san: string;
  cp_loss: number;
  classification: string;
  move_number: number;
  prev_fen?: string | null;
  prev_move_uci?: string | null;
  uci_played?: string;
  best_moves?: string[];
  eval_before_white_pov?: number;
}

export function encodeSharePayload(payload: SharePayload): string {
  const json = JSON.stringify(payload);
  // encode unicode → ASCII-safe base64url
  return btoa(unescape(encodeURIComponent(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function decodeSharePayload(encoded: string): SharePayload | null {
  try {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(base64)));
    return JSON.parse(json) as SharePayload;
  } catch {
    return null;
  }
}

export function buildShareUrl(payload: SharePayload): string {
  const url = new URL(window.location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('share', encodeSharePayload(payload));
  return url.toString();
}
