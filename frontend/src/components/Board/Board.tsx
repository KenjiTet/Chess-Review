/**
 * Chess board component wrapping react-chessboard.
 *
 * Supports both drag-and-drop AND click-to-move:
 *   1. Click a piece to select it (highlights in yellow, shows legal dots).
 *   2. Click a target square to complete the move.
 *   Clicking an empty non-target square deselects. Clicking an own piece switches selection.
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
 * Legal move dots: dots and rings overlay legal target squares while dragging
 * or after clicking to select a piece.
 */

import { useState, useLayoutEffect, useEffect, useCallback, useMemo, useRef } from 'react';
import type { JSX, CSSProperties } from 'react';
import { Chessboard } from 'react-chessboard';
import type { PieceDropHandlerArgs, PieceHandlerArgs, SquareHandlerArgs } from 'react-chessboard';
import { Chess } from 'chess.js';
import { playMoveOutcome } from '../../utils/sounds';
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

/** Highlight for the landing (destination) square of the last move. */
const DEST_HIGHLIGHT: CSSProperties = {
  background: 'rgba(255, 210, 0, 0.38)',
  boxShadow: 'inset 0 0 0 3px rgba(255, 210, 0, 0.65)',
};

/** Red marker for right-click highlighted squares (rendered below the pieces). */
const MARKED_HIGHLIGHT: CSSProperties = {
  background: 'rgba(235, 60, 50, 0.55)',
};

/** Highlight for the click-selected piece's source square. */
const SELECTED_HIGHLIGHT: CSSProperties = {
  background: 'rgba(255, 210, 0, 0.60)',
  boxShadow: 'inset 0 0 0 3px rgba(255, 210, 0, 1)',
};

// Dot shown on empty legal target squares while dragging/selected
const LEGAL_MOVE_DOT: CSSProperties = {
  background: 'radial-gradient(circle, rgba(0,0,0,0.22) 28%, transparent 28%)',
};

// Ring shown on occupied (capture) legal target squares while dragging/selected
const LEGAL_CAPTURE_RING: CSSProperties = {
  background: 'radial-gradient(circle, transparent 64%, rgba(0,0,0,0.22) 64%)',
};

// Hint / blunder arrow colours (drawn by react-chessboard). The hint arrows are
// ranked best-first via a decreasing alpha baked into their rgba colour (this
// multiplies with the board's global arrow opacity).
const HINT_ARROW_RGB = '59, 130, 246';
const HINT_ARROW_ALPHAS = [1, 0.78, 0.6, 0.45] as const;
const BLUNDER_ARROW_COLOR = '#dc2626';

/** Blue hint colour for the given rank (0 = best). */
function hintArrowColor(rank: number): string {
  const alpha = HINT_ARROW_ALPHAS[Math.min(rank, HINT_ARROW_ALPHAS.length - 1)];
  return `rgba(${HINT_ARROW_RGB}, ${alpha})`;
}

/** Compute the set of legal target / capture squares for a given source square. */
function computeLegalSquares(fen: string, fromSquare: string): { targets: Set<string>; captures: Set<string> } {
  try {
    const temp = new Chess(fen);
    const targets = new Set<string>();
    const captures = new Set<string>();

    for (const m of temp.moves({ verbose: true })) {
      if (m.from !== fromSquare) {
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
  // Source square selected by a click (null when nothing selected)
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  // Squares the user has right-click highlighted in red (toggled per square).
  const [markedSquares, setMarkedSquares] = useState<Set<string>>(new Set());

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

  // Clear selected square and any right-click markers whenever the board
  // position changes (after each move) so highlights don't linger.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: clear stale highlights/markers when the position changes
    setSelectedSquare(null);
    setMarkedSquares(new Set());
  }, [fen]);

  // Phase timers: switch to phase 2 after 400ms to animate the piece, done at 1500ms.
  useEffect(() => {
    if (!introActive) {
      return undefined;
    }

    // Play sound when the piece actually animates (phase 2 = opponent move animation).
    // Replay the opponent move on prevFen to detect capture / check / checkmate.
    const phaseTimer = setTimeout(() => {
      setIntroPhase(2);
      let outcome = { captured: false, check: false, checkmate: false };
      if (prevFen && prevMoveUci && prevMoveUci.length >= 4) {
        try {
          const replay = new Chess(prevFen);
          const moved = replay.move({ from: prevMoveUci.slice(0, 2), to: prevMoveUci.slice(2, 4), promotion: prevMoveUci[4] ?? 'q' });
          outcome = { captured: Boolean(moved?.captured), check: replay.inCheck(), checkmate: replay.isCheckmate() };
        } catch {
          // Fall back to the plain move sound.
        }
      }
      playMoveOutcome(outcome);
    }, 1000);
    const doneTimer = setTimeout(() => setIntroTimedOut(true), 1800);

    return () => {
      clearTimeout(phaseTimer);
      clearTimeout(doneTimer);
    };
  }, [introActive, introKey, prevFen, prevMoveUci]);

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

  // Legal moves for the piece being dragged (for dot overlays while dragging).
  const dragLegalInfo = useMemo(
    () => {
      if (!dragSquare || !canInteract) {
        return { targets: new Set<string>(), captures: new Set<string>() };
      }
      return computeLegalSquares(fen, dragSquare);
    },
    [dragSquare, fen, canInteract],
  );

  // Legal moves for the click-selected piece (for dot overlays after selection).
  const clickLegalInfo = useMemo(
    () => {
      if (!selectedSquare || !canInteract) {
        return { targets: new Set<string>(), captures: new Set<string>() };
      }
      return computeLegalSquares(fen, selectedSquare);
    },
    [selectedSquare, fen, canInteract],
  );

  // ── Square styles ──────────────────────────────────────────────────────────
  const customSquareStyles: Record<Square, CSSProperties> = {};

  // Right-click red markers — applied first so interactive states can override.
  markedSquares.forEach((sq) => {
    customSquareStyles[sq] = MARKED_HIGHLIGHT;
  });

  if (introActive && prevMoveUci && prevMoveUci.length >= 4) {
    // Highlight both the origin and the landing square of the opponent's move.
    customSquareStyles[prevMoveUci.slice(0, 2)] = SOURCE_HIGHLIGHT;
    customSquareStyles[prevMoveUci.slice(2, 4)] = DEST_HIGHLIGHT;
  } else if (!introActive) {
    // After intro, keep the last-move highlight until the user plays their move.
    const highlightUci = lastMoveUci ?? prevMoveUci;
    if (highlightUci && highlightUci.length >= 4) {
      customSquareStyles[highlightUci.slice(0, 2)] = SOURCE_HIGHLIGHT;
      customSquareStyles[highlightUci.slice(2, 4)] = DEST_HIGHLIGHT;
    }
  }

  // Drag dots take priority; click dots fill in the gaps
  const activeLegal = dragSquare ? dragLegalInfo : clickLegalInfo;
  activeLegal.targets.forEach((sq) => {
    if (activeLegal.captures.has(sq)) {
      customSquareStyles[sq] = LEGAL_CAPTURE_RING;
    } else {
      customSquareStyles[sq] = LEGAL_MOVE_DOT;
    }
  });

  // Highlight the click-selected source square
  if (selectedSquare && !dragSquare) {
    customSquareStyles[selectedSquare] = SELECTED_HIGHLIGHT;
  }

  // ── Right-click marker handler ─────────────────────────────────────────────
  // Toggles a red highlight on the clicked square (right-click again to remove).
  const handleSquareRightClick = useCallback(
    ({ square }: SquareHandlerArgs): void => {
      if (!square) {
        return;
      }
      setMarkedSquares((prev) => {
        const next = new Set(prev);
        if (next.has(square)) {
          next.delete(square);
        } else {
          next.add(square);
        }
        return next;
      });
    },
    [],
  );

  // ── Drag handler ───────────────────────────────────────────────────────────
  const handlePieceDrag = useCallback(
    ({ square }: PieceHandlerArgs): void => {
      if (!canInteractRef.current || !square) {
        return;
      }
      // Starting a drag clears any click selection to avoid visual confusion
      setSelectedSquare(null);
      setDragSquare(square);
    },
    [],
  );

  // ── Drop handler ───────────────────────────────────────────────────────────
  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean => {
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
        // chess has the move applied, so its state reflects check / checkmate.
        playMoveOutcome({ captured: Boolean(move.captured), check: chess.inCheck(), checkmate: chess.isCheckmate() });
        onMove(uci);
        return true;
      } catch {
        return false;
      }
    },
    [fen, onMove],
  );

  // ── Click-to-move handler ──────────────────────────────────────────────────
  const handleSquareClick = useCallback(
    ({ square }: SquareHandlerArgs): void => {
      if (!canInteractRef.current) {
        return;
      }

      // If a piece is already selected, try to use this click as the destination
      if (selectedSquare) {
        // Clicking the same square again deselects
        if (selectedSquare === square) {
          setSelectedSquare(null);
          return;
        }

        // If the square is a legal move target → execute the move
        if (clickLegalInfo.targets.has(square)) {
          try {
            const chess = new Chess(fen);
            const move = chess.move({ from: selectedSquare, to: square, promotion: 'q' });

            if (move && onMove) {
              const uci = `${selectedSquare}${square}${move.promotion ?? ''}`;
              setSelectedSquare(null);
              playMoveOutcome({ captured: Boolean(move.captured), check: chess.inCheck(), checkmate: chess.isCheckmate() });
              onMove(uci);
              return;
            }
          } catch {
            // fall through to deselect
          }
        }

        // If the square has another own piece → switch selection to it
        try {
          const chess = new Chess(fen);
          const piece = chess.get(square as Parameters<typeof chess.get>[0]);
          const currentTurn = chess.turn();

          if (piece && piece.color === currentTurn) {
            setSelectedSquare(square);
            return;
          }
        } catch {
          // fall through
        }

        // Otherwise deselect
        setSelectedSquare(null);
        return;
      }

      // Nothing selected yet: select if the square has a piece that can move
      try {
        const chess = new Chess(fen);
        const piece = chess.get(square as Parameters<typeof chess.get>[0]);
        const currentTurn = chess.turn();

        if (piece && piece.color === currentTurn) {
          setSelectedSquare(square);
        }
      } catch {
        // ignore invalid fen / square
      }
    },
    [selectedSquare, clickLegalInfo, fen, onMove],
  );

  const introLabel = prevMoveSan ? `↩ ${prevMoveSan}` : '↩ Opponent moved';

  // ── Hint / blunder arrows ──────────────────────────────────────────────────
  // Rendered by react-chessboard's own arrow layer (clean look + knight L-shape).
  const overlayArrows: { startSquare: string; endSquare: string; color: string }[] = [];
  if (!introActive) {
    const blunderMove = blunderArrowUci && blunderArrowUci.length >= 4 ? blunderArrowUci.slice(0, 4) : undefined;

    arrowUcis.forEach((uci, rank) => {
      // Never draw a hint over the red blunder arrow — the overlap would tint it
      // violet and leave a stale blue arrow when hints are toggled off.
      if (uci.length >= 4 && uci.slice(0, 4) !== blunderMove) {
        // Rank 0 is the best move — most opaque; lower-ranked moves fade out.
        overlayArrows.push({ startSquare: uci.slice(0, 2), endSquare: uci.slice(2, 4), color: hintArrowColor(rank) });
      }
    });

    if (blunderMove) {
      overlayArrows.push({ startSquare: blunderMove.slice(0, 2), endSquare: blunderMove.slice(2, 4), color: BLUNDER_ARROW_COLOR });
    }
  }

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
          onSquareClick: handleSquareClick,
          onSquareRightClick: handleSquareRightClick,
          allowDragging: canInteract,
          squareStyles: customSquareStyles,
          arrows: overlayArrows,
          animationDurationInMs: 500,
          boardStyle: { borderRadius: '6px' },
        }}
      />
    </div>
  );
}

export default Board;
