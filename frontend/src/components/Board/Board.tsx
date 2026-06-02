/**
 * Chess board component wrapping react-chessboard.
 *
 * Intro animation: when prevFen and prevMoveUci are provided, shows the
 * opponent's last position for 1000ms then animates the piece to its destination
 * before becoming interactive at 1800ms total.
 *
 * Custom SVG arrows: arrowUcis are rendered as an SVG overlay with decreasing
 * stroke widths (index 0 = largest) to show move ranking visually.
 *
 * Source-square highlighting: the source square of lastMoveUci (or prevMoveUci
 * during intro) is highlighted with a yellow glow after each move.
 *
 * Legal move dots: dots and rings overlay legal target squares while dragging.
 */

import { useState, useLayoutEffect, useEffect, useCallback, useMemo, useRef } from 'react';
import type { JSX, CSSProperties } from 'react';
import { Chessboard } from 'react-chessboard';
import type { PieceDropHandlerArgs, PieceHandlerArgs } from 'react-chessboard';
import { Chess } from 'chess.js';
import { playMoveSound } from '../../utils/sounds';
import './Board.css';

interface BoardProps {
  fen: string;
  orientation: 'white' | 'black';
  prevFen?: string | null;
  prevMoveUci?: string | null;
  prevMoveSan?: string | null;
  onMove?: (uciMove: string) => void;
  interactive?: boolean;
  arrowUcis?: string[];
  lastMoveUci?: string | null;
  /** UCI of the blunder move — rendered as a red arrow when provided. */
  blunderArrowUci?: string | null;
}

type Square = string;

const SOURCE_HIGHLIGHT: CSSProperties = {
  background: 'rgba(255, 210, 0, 0.50)',
  boxShadow: 'inset 0 0 0 3px rgba(255, 210, 0, 0.8)',
};

// Dot shown on empty legal target squares while dragging a piece
const LEGAL_MOVE_DOT: CSSProperties = {
  background: 'radial-gradient(circle, rgba(0,0,0,0.22) 28%, transparent 28%)',
};

// Ring shown on occupied (capture) legal target squares while dragging
const LEGAL_CAPTURE_RING: CSSProperties = {
  background: 'radial-gradient(circle, transparent 64%, rgba(0,0,0,0.22) 64%)',
};

// Sizes per arrow rank: [best, 2nd, 3rd, 4th+]
const ARROW_STROKE_WIDTHS = [0.22, 0.15, 0.10, 0.07] as const;
const ARROW_ALPHAS = [0.88, 0.68, 0.50, 0.36] as const;

function squareCenter(
  square: string,
  orientation: 'white' | 'black',
): { x: number; y: number } {
  const file = square.charCodeAt(0) - 97;
  const rank = parseInt(square[1]) - 1;

  if (orientation === 'white') {
    return { x: file + 0.5, y: 7.5 - rank };
  }
  return { x: 7.5 - file, y: rank + 0.5 };
}

function buildArrowPaths(
  from: { x: number; y: number },
  to: { x: number; y: number },
  sw: number,
): { shaft: string; head: string } | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);

  if (len < 0.01) {
    return null;
  }

  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;

  const headLen = sw * 2.4;
  const headHalf = sw * 1.25;
  const startOff = 0.36;

  const sx = from.x + ux * startOff;
  const sy = from.y + uy * startOff;
  const mx = to.x - ux * headLen;
  const my = to.y - uy * headLen;

  const shaft = `M${sx.toFixed(4)},${sy.toFixed(4)} L${mx.toFixed(4)},${my.toFixed(4)}`;

  const b1x = (mx + px * headHalf).toFixed(4);
  const b1y = (my + py * headHalf).toFixed(4);
  const b2x = (mx - px * headHalf).toFixed(4);
  const b2y = (my - py * headHalf).toFixed(4);
  const tx = to.x.toFixed(4);
  const ty = to.y.toFixed(4);

  const head = `M${b1x},${b1y} L${tx},${ty} L${b2x},${b2y} Z`;

  return { shaft, head };
}

function Board({
  fen,
  orientation,
  prevFen,
  prevMoveUci,
  prevMoveSan,
  onMove,
  interactive = true,
  arrowUcis = [],
  lastMoveUci,
  blunderArrowUci,
}: BoardProps): JSX.Element {
  // Tracks the prev-move pair so changes can be detected during render.
  const [introKey, setIntroKey] = useState<string>(`${prevFen ?? ''}|${prevMoveUci ?? ''}`);
  const [introTimedOut, setIntroTimedOut] = useState<boolean>(false);
  // Phase 1: show prevFen (before opponent moved), Phase 2: show fen (piece animates)
  const [introPhase, setIntroPhase] = useState<1 | 2>(1);
  // Source square of the piece currently being dragged (null when not dragging)
  const [dragSquare, setDragSquare] = useState<string | null>(null);

  // Reset intro when the opponent-move data changes (during render, not in effect).
  const currentIntroKey = `${prevFen ?? ''}|${prevMoveUci ?? ''}`;
  if (currentIntroKey !== introKey) {
    setIntroKey(currentIntroKey);
    setIntroTimedOut(false);
    setIntroPhase(1);
  }

  const introActive = Boolean(prevFen && prevMoveUci) && !introTimedOut;

  // Ref so drag/drop callbacks always read the latest canInteract without
  // depending on stale closures (react-chessboard may cache handler references).
  const canInteractRef = useRef<boolean>(false);
  useLayoutEffect(() => {
    canInteractRef.current = interactive && !introActive;
  }, [interactive, introActive]);

  // Phase timers: switch to phase 2 after 400ms to animate the piece, done at 1500ms.
  useEffect(() => {
    if (!introActive) {
      return undefined;
    }

    const phaseTimer = setTimeout(() => setIntroPhase(2), 1000);
    const doneTimer = setTimeout(() => setIntroTimedOut(true), 1800);

    return () => {
      clearTimeout(phaseTimer);
      clearTimeout(doneTimer);
    };
  }, [introActive, introKey]);

  // Global mouseup clears drag state — handles cases where drag is cancelled
  // (e.g. pointer leaves the browser window mid-drag).
  useEffect(() => {
    const handleMouseUp = (): void => {
      setDragSquare(null);
    };
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Phase 1 shows prevFen so the user sees the position; phase 2 switches to fen
  // which triggers react-chessboard's piece animation.
  const displayFen = introActive && prevFen && introPhase === 1 ? prevFen : fen;
  const canInteract = interactive && !introActive;

  // Compute legal move targets for the dragged piece so we can show overlay dots.
  const legalMoveInfo = useMemo((): { targets: Set<string>; captures: Set<string> } => {
    if (!dragSquare || !canInteract) {
      return { targets: new Set<string>(), captures: new Set<string>() };
    }
    try {
      const temp = new Chess(fen);
      const targets = new Set<string>();
      const captures = new Set<string>();
      for (const m of temp.moves({ verbose: true })) {
        if (m.from !== dragSquare) {
          continue;
        }
        targets.add(m.to);
        if (m.captured) {
          captures.add(m.to);
        }
      }
      return { targets, captures };
    } catch {
      return { targets: new Set<string>(), captures: new Set<string>() };
    }
  }, [dragSquare, fen, canInteract]);

  // ── Square styles ──────────────────────────────────────────────────────────
  const customSquareStyles: Record<Square, CSSProperties> = {};

  if (introActive && prevMoveUci && prevMoveUci.length >= 2) {
    customSquareStyles[prevMoveUci.slice(0, 2)] = SOURCE_HIGHLIGHT;
  } else if (!introActive) {
    // After intro, keep prevMoveUci highlight until the user plays their first move
    const highlightUci = lastMoveUci ?? prevMoveUci;
    if (highlightUci && highlightUci.length >= 2) {
      customSquareStyles[highlightUci.slice(0, 2)] = SOURCE_HIGHLIGHT;
    }
  }

  legalMoveInfo.targets.forEach((sq) => {
    if (legalMoveInfo.captures.has(sq)) {
      customSquareStyles[sq] = LEGAL_CAPTURE_RING;
    } else {
      customSquareStyles[sq] = LEGAL_MOVE_DOT;
    }
  });

  // ── Drag handler ───────────────────────────────────────────────────────────
  const handlePieceDrag = useCallback(
    ({ square }: PieceHandlerArgs): void => {
      if (!canInteractRef.current || !square) {
        return;
      }
      setDragSquare(square);
    },
    [],
  );

  // ── Move handler ───────────────────────────────────────────────────────────
  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean => {
      // Always clear legal-move dots on drop (regardless of validity)
      setDragSquare(null);

      if (!canInteractRef.current || !onMove) {
        return false;
      }

      if (targetSquare === null) {
        return false;
      }

      try {
        const chess = new Chess(fen);
        const move = chess.move({ from: sourceSquare, to: targetSquare, promotion: 'q' });

        if (!move) {
          return false;
        }

        const uci = `${sourceSquare}${targetSquare}${move.promotion ?? ''}`;
        playMoveSound();
        onMove(uci);
        return true;
      } catch {
        return false;
      }
    },
    [fen, onMove],
  );

  const introLabel = prevMoveSan ? `↩ ${prevMoveSan}` : '↩ Opponent moved';

  // ── Custom SVG arrows ──────────────────────────────────────────────────────
  const showCustomArrows = !introActive && (arrowUcis.length > 0 || Boolean(blunderArrowUci));

  return (
    <div className="board">
      {introActive && (
        <div className="board__intro-overlay">
          <span className="board__intro-label">{introLabel}</span>
        </div>
      )}
      <Chessboard
        options={{
          position: displayFen,
          boardOrientation: orientation,
          onPieceDrag: handlePieceDrag,
          onPieceDrop: onPieceDrop,
          allowDragging: canInteract,
          squareStyles: customSquareStyles,
          animationDurationInMs: 500,
          boardStyle: { borderRadius: '6px' },
        }}
      />
      {showCustomArrows && (
        <svg
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            zIndex: 30,
          }}
          viewBox="0 0 8 8"
        >
          {arrowUcis.map((uci, idx) => {
            if (uci.length < 4) {
              return null;
            }

            const fromSq = uci.slice(0, 2);
            const toSq = uci.slice(2, 4);
            const from = squareCenter(fromSq, orientation);
            const to = squareCenter(toSq, orientation);

            const sw = ARROW_STROKE_WIDTHS[Math.min(idx, ARROW_STROKE_WIDTHS.length - 1)];
            const alpha = ARROW_ALPHAS[Math.min(idx, ARROW_ALPHAS.length - 1)];
            const color = `rgba(59,130,246,${alpha})`;

            const paths = buildArrowPaths(from, to, sw);

            if (!paths) {
              return null;
            }

            return (
              <g key={`arrow-${uci}-${idx}`}>
                <path
                  d={paths.shaft}
                  stroke={color}
                  strokeWidth={sw}
                  fill="none"
                  strokeLinecap="round"
                />
                <path d={paths.head} fill={color} />
              </g>
            );
          })}
          {blunderArrowUci && blunderArrowUci.length >= 4 && (() => {
            const fromSq = blunderArrowUci.slice(0, 2);
            const toSq = blunderArrowUci.slice(2, 4);
            const from = squareCenter(fromSq, orientation);
            const to = squareCenter(toSq, orientation);
            const sw = ARROW_STROKE_WIDTHS[0];
            const paths = buildArrowPaths(from, to, sw);

            if (!paths) {
              return null;
            }

            return (
              <g key={`blunder-arrow-${blunderArrowUci}`}>
                <path
                  d={paths.shaft}
                  stroke="rgba(220,38,38,0.88)"
                  strokeWidth={sw}
                  fill="none"
                  strokeLinecap="round"
                />
                <path d={paths.head} fill="rgba(220,38,38,0.88)" />
              </g>
            );
          })()}
        </svg>
      )}
    </div>
  );
}

export default Board;
