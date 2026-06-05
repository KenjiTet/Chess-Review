/** Renders a chess position as a PNG data URL using the Canvas API. */

import { Chess } from 'chess.js';

const PIECE_CHARS: Record<string, string> = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟',
};

const LIGHT_SQ = '#f0d9b5';
const DARK_SQ = '#b58863';

export function generateBoardImage(fen: string, orientation: 'white' | 'black' = 'white'): string {
  // Render at 2× physical pixels so the image looks crisp when upscaled in the UI.
  const SIZE = 400;
  const SQ = SIZE / 8;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return '';
  }

  let board: ReturnType<Chess['board']>;

  try {
    const chess = new Chess(fen);
    board = chess.board();
  } catch {
    return '';
  }

  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const vRank = orientation === 'white' ? rank : 7 - rank;
      const vFile = orientation === 'white' ? file : 7 - file;
      const isLight = (rank + file) % 2 === 0;

      ctx.fillStyle = isLight ? LIGHT_SQ : DARK_SQ;
      ctx.fillRect(vFile * SQ, vRank * SQ, SQ, SQ);

      const piece = board[rank][file];

      if (!piece) {
        continue;
      }

      const key = `${piece.color}${piece.type.toUpperCase()}`;
      const char = PIECE_CHARS[key];

      if (!char) {
        continue;
      }

      ctx.font = `bold ${Math.floor(SQ * 0.78)}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const cx = (vFile + 0.5) * SQ;
      const cy = (vRank + 0.5) * SQ;

      if (piece.color === 'w') {
        ctx.strokeStyle = 'rgba(0,0,0,0.65)';
        ctx.lineWidth = 2.5;
        ctx.strokeText(char, cx, cy);
        ctx.fillStyle = '#ffffff';
      } else {
        ctx.fillStyle = '#1a1a1a';
      }

      ctx.fillText(char, cx, cy);
    }
  }

  return canvas.toDataURL('image/png');
}
