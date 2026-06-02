/**
 * Trainer screen — shows one blunder at a time.
 *
 * Analysis mode (default): the board stays interactive across multiple moves.
 * Each move is evaluated asynchronously by Stockfish and shown in the move-log
 * sidebar. The first move played is saved as the attempt; clicking "Next →"
 * submits it to the backend and transitions to the reveal screen.
 *
 * Bot mode: after the user plays a move Stockfish responds automatically.
 * The user can keep playing until they click "Next →".
 */

import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import type { JSX } from 'react';
import { Chess } from 'chess.js';
import useSession from '../../hooks/useSession';
import useFavorites from '../../hooks/useFavorites';
import Board from '../Board/Board';
import EvalBar from '../EvalBar/EvalBar';
import BlunderCard from '../BlunderCard/BlunderCard';
import MoveLog, { type MoveLogEntry } from '../MoveLog/MoveLog';
import { evaluateMove, getPositionEval, getStockfishMove, getBestMoves, getBlunderLine, type BlunderLineResponse } from '../../api/client';
import { playMoveSound } from '../../utils/sounds';
import { generateBoardImage } from '../../utils/generateBoardImage';
import './Trainer.css';

interface HistoryEntry {
  fen: string;
  uci: string | null;
  /** Eval from white's perspective — filled in async after each move. */
  evalScore: number;
}

interface InitialHistory {
  history: HistoryEntry[];
  /** Index of the blunder position (where the trainer starts). */
  blunderIdx: number;
}

/**
 * Build the pre-seeded position history for a blunder.
 * When game_fens/game_uci_moves are present the full game history from move 0
 * up to the blunder position is used so the user can navigate the entire game.
 * Falls back to a two-entry (prev → blunder) list for older cached blunders.
 * The blunder result is appended after the blunder position so forward
 * navigation shows what actually happened.
 */
function buildInitialHistory(blunder: { fen_before: string; prev_fen: string | null; prev_move_uci: string | null; uci_played: string; eval_before_white_pov: number; move_index?: number; game_fens?: string[]; game_uci_moves?: string[] } | undefined): InitialHistory {
  if (!blunder) {
    return { history: [{ fen: '', uci: null, evalScore: 0 }], blunderIdx: 0 };
  }

  const entries: HistoryEntry[] = [];

  if (blunder.game_fens && blunder.game_fens.length > 0 && blunder.move_index !== undefined) {
    // Full game history: game_fens[i] is the position before move i, game_uci_moves[i] is that move.
    // len(game_fens) == len(game_uci_moves) + 1
    const gameFens = blunder.game_fens;
    const gameUcis = blunder.game_uci_moves ?? [];

    for (let i = 0; i < gameFens.length; i++) {
      // The move that led to position i is uci_moves[i-1]
      const uci = i === 0 ? null : (gameUcis[i - 1] ?? null);
      const evalScore = i === blunder.move_index ? (blunder.eval_before_white_pov ?? 0) : 0;
      entries.push({ fen: gameFens[i], uci, evalScore });
    }

    return { history: entries, blunderIdx: blunder.move_index };
  }

  // Fallback for old cached blunders: prev position + blunder position + blunder result
  if (blunder.prev_fen) {
    entries.push({ fen: blunder.prev_fen, uci: blunder.prev_move_uci, evalScore: 0 });
  }
  entries.push({ fen: blunder.fen_before, uci: null, evalScore: blunder.eval_before_white_pov ?? 0 });

  const blunderIdx = entries.length - 1;

  if (blunder.uci_played) {
    try {
      const chess = new Chess(blunder.fen_before);
      const moved = chess.move({
        from: blunder.uci_played.slice(0, 2),
        to: blunder.uci_played.slice(2, 4),
        promotion: blunder.uci_played[4] ?? 'q',
      });
      if (moved) {
        entries.push({ fen: chess.fen(), uci: blunder.uci_played, evalScore: 0 });
      }
    } catch {
      // ignore invalid blunder move
    }
  }

  return { history: entries, blunderIdx };
}

function Trainer(): JSX.Element {
  const currentBlunder = useSession((s) => s.currentBlunder);
  const reviewedCount = useSession((s) => s.reviewedCount);
  const blunderCount = useSession((s) => s.blunderCount);
  const sessionId = useSession((s) => s.sessionId);
  const submitAttempt = useSession((s) => s.submitAttempt);
  const skipBlunder = useSession((s) => s.skipBlunder);
  const reset = useSession((s) => s.reset);

  const addFavorite = useFavorites((s) => s.addFavorite);
  const favorites = useFavorites((s) => s.favorites);

  // ── Local board state ───────────────────────────────────────────────────────
  // Initialize directly from currentBlunder so the board has the correct FEN
  // from the very first render (Trainer remounts on each new blunder via screen
  // transitions, so the useState initializer always has a fresh blunder).
  const [localFen, setLocalFen] = useState<string>(currentBlunder?.fen_before ?? '');
  const [lastMoveUci, setLastMoveUci] = useState<string | null>(null);
  const [firstMove, setFirstMove] = useState<string | null>(null);
  const [moveLog, setMoveLog] = useState<MoveLogEntry[]>([]);
  const [currentEval, setCurrentEval] = useState<number>(currentBlunder?.eval_before_white_pov ?? 0);
  const [showArrows, setShowArrows] = useState<boolean>(false);
  const [currentArrows, setCurrentArrows] = useState<string[]>(currentBlunder?.best_moves ?? []);
  const [botMode, setBotMode] = useState<boolean>(false);
  const [botThinking, setBotThinking] = useState<boolean>(false);
  const [isPlayingSequence, setIsPlayingSequence] = useState<boolean>(false);

  // Position history for < > navigation — seeded with prev/blunder/blunder-result context
  const initialHistory = buildInitialHistory(currentBlunder);
  const [positionHistory, setPositionHistory] = useState<HistoryEntry[]>(initialHistory.history);
  const [historyIndex, setHistoryIndex] = useState<number>(initialHistory.blunderIdx);
  // The furthest index the user has actually reached (pre-seeded entries beyond this are nav-only)
  const [liveIndex, setLiveIndex] = useState<number>(initialHistory.blunderIdx);
  // Index of the blunder position in positionHistory — move log entries start after this
  const [blunderIdx, setBlunderIdx] = useState<number>(initialHistory.blunderIdx);

  // Sequential IDs so async eval responses match the right log entry
  const moveIdRef = useRef<number>(0);
  // Set to false to cancel a running blunder sequence
  const sequenceActiveRef = useRef<boolean>(false);

  // Board-row ref + measured size for responsive height-driven layout
  const boardRowRef = useRef<HTMLDivElement>(null);
  const [boardSize, setBoardSize] = useState<number>(0);

  useEffect(() => {
    const el = boardRowRef.current;
    if (!el) {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setBoardSize(Math.floor(entry.contentRect.height * 0.9));
      }
    });

    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Track the blunder FEN we last synced to so changes can be detected during render.
  const [syncedBlunderFen, setSyncedBlunderFen] = useState<string | undefined>(
    currentBlunder?.fen_before,
  );

  // Reset all local board state when the blunder changes (during render avoids
  // cascading renders that synchronous setState in effects would cause).
  if (currentBlunder?.fen_before !== syncedBlunderFen) {
    setSyncedBlunderFen(currentBlunder?.fen_before);
    setLocalFen(currentBlunder?.fen_before ?? '');
    setLastMoveUci(null);
    setFirstMove(null);
    setMoveLog([]);
    setBotThinking(false);
    setCurrentEval(currentBlunder?.eval_before_white_pov ?? 0);
    setCurrentArrows(currentBlunder?.best_moves ?? []);
    sequenceActiveRef.current = false;
    setIsPlayingSequence(false);
    const newHistory = buildInitialHistory(currentBlunder);
    setPositionHistory(newHistory.history);
    setHistoryIndex(newHistory.blunderIdx);
    setLiveIndex(newHistory.blunderIdx);
    setBlunderIdx(newHistory.blunderIdx);
  }

  // Reset move counter and fetch position eval when the blunder changes.
  // Ref mutations must live in effects, not in the render body.
  // Also covers games analysed before eval_before_white_pov was added to the cache.
  useEffect(() => {
    moveIdRef.current = 0;

    if (!currentBlunder || currentBlunder.eval_before_white_pov !== 0) {
      return;
    }

    getPositionEval(currentBlunder.fen_before).then((res) => {
      setCurrentEval(res.eval_white_pov);
    });
  }, [currentBlunder]);

  // Refresh arrows whenever the board position changes (or arrows are toggled on).
  // For the initial blunder position, reuse the cached best_moves to skip a round-trip.
  useEffect(() => {
    if (!showArrows || !localFen || !currentBlunder) {
      return undefined;
    }

    if (localFen === currentBlunder.fen_before) {
      setCurrentArrows(currentBlunder.best_moves);
      return undefined;
    }

    let cancelled = false;
    getBestMoves(localFen).then((res) => {
      if (!cancelled) {
        setCurrentArrows(res.best_moves);
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [showArrows, localFen, currentBlunder]);

  // ── Move handler ────────────────────────────────────────────────────────────
  const handleMove = useCallback(
    (uci: string): void => {
      if (!currentBlunder) {
        return;
      }

      const capturedFen = localFen || currentBlunder.fen_before;
      const chess = new Chess(capturedFen);

      let san: string;
      let newFen: string;

      try {
        const move = chess.move({
          from: uci.slice(0, 2),
          to: uci.slice(2, 4),
          promotion: uci[4] ?? 'q',
        });

        if (!move) {
          return;
        }

        san = move.san;
        newFen = chess.fen();
      } catch {
        return;
      }

      const id = moveIdRef.current;
      moveIdRef.current += 1;

      if (firstMove === null) {
        setFirstMove(uci);
      }

      // Truncate any forward history and push user move at the current position
      const userHistoryIdx = historyIndex + 1;
      setPositionHistory((prev) => [
        ...prev.slice(0, historyIndex + 1),
        { fen: newFen, uci, evalScore: 0 },
      ]);
      setHistoryIndex(userHistoryIdx);
      setLiveIndex(userHistoryIdx);

      setLocalFen(newFen);
      setLastMoveUci(uci);
      setMoveLog((prev) => [...prev, { id, san, classification: null, cpLoss: null }]);

      // Async eval — update log entry, eval bar, and history entry when result arrives
      evaluateMove({ fen_before: capturedFen, uci_move: uci }).then((result) => {
        setCurrentEval(result.eval_after_white_pov);
        setPositionHistory((prev) => {
          const updated = [...prev];
          if (updated[userHistoryIdx]) {
            updated[userHistoryIdx] = { ...updated[userHistoryIdx], evalScore: result.eval_after_white_pov };
          }
          return updated;
        });
        setMoveLog((prev) =>
          prev.map((entry) =>
            entry.id === id
              ? { ...entry, classification: result.classification, cpLoss: result.cp_loss }
              : entry,
          ),
        );
      });

      // Bot mode: ask Stockfish to respond
      if (botMode) {
        setBotThinking(true);

        getStockfishMove({ fen: newFen }).then((response) => {
          const sfUci = response.best_move_uci;

          if (sfUci) {
            const sfChess = new Chess(newFen);
            let sfSan: string;
            let sfFen: string;

            try {
              const sfMove = sfChess.move({
                from: sfUci.slice(0, 2),
                to: sfUci.slice(2, 4),
                promotion: sfUci[4] ?? 'q',
              });
              sfSan = sfMove ? sfMove.san : sfUci;
              sfFen = sfChess.fen();
            } catch {
              sfSan = sfUci;
              sfFen = newFen;
            }

            const sfId = moveIdRef.current;
            moveIdRef.current += 1;

            // Bot move goes right after the user move (historyIndex captured at callback creation)
            const sfHistoryIdx = historyIndex + 2;
            setPositionHistory((prev) => [
              ...prev.slice(0, historyIndex + 2),
              { fen: sfFen, uci: sfUci, evalScore: response.eval_after_white_pov },
            ]);
            setHistoryIndex(sfHistoryIdx);
            setLiveIndex(sfHistoryIdx);

            setLocalFen(sfFen);
            setLastMoveUci(sfUci);
            setCurrentEval(response.eval_after_white_pov);
            playMoveSound();
            setMoveLog((prev) => [
              ...prev,
              { id: sfId, san: sfSan, classification: null, cpLoss: null },
            ]);

            // Evaluate bot's move quality too so the log shows its classification
            evaluateMove({ fen_before: newFen, uci_move: sfUci }).then((sfResult) => {
              setMoveLog((prev) =>
                prev.map((entry) =>
                  entry.id === sfId
                    ? {
                        ...entry,
                        classification: sfResult.classification,
                        cpLoss: sfResult.cp_loss,
                      }
                    : entry,
                ),
              );
            });
          }

          setBotThinking(false);
        });
      }
    },
    [currentBlunder, localFen, firstMove, botMode, historyIndex],
  );

  // ── Reset to blunder position ───────────────────────────────────────────────
  function handleReset(): void {
    if (!currentBlunder) {
      return;
    }

    sequenceActiveRef.current = false;
    setIsPlayingSequence(false);
    setLocalFen(currentBlunder.fen_before);
    setLastMoveUci(null);
    setFirstMove(null);
    setMoveLog([]);
    setCurrentEval(currentBlunder.eval_before_white_pov ?? 0);
    setBotThinking(false);
    moveIdRef.current = 0;
    const resetHistory = buildInitialHistory(currentBlunder);
    setPositionHistory(resetHistory.history);
    setHistoryIndex(resetHistory.blunderIdx);
    setLiveIndex(resetHistory.blunderIdx);
    setBlunderIdx(resetHistory.blunderIdx);
  }

  // ── Blunder sequence replay ─────────────────────────────────────────────────
  async function handleShowBlunderSequence(): Promise<void> {
    if (!currentBlunder) {
      return;
    }

    // Cancel any already-running sequence, then reset to the blunder position.
    sequenceActiveRef.current = false;
    setIsPlayingSequence(true);
    setLocalFen(currentBlunder.fen_before);
    setLastMoveUci(null);
    setFirstMove(null);
    setMoveLog([]);
    moveIdRef.current = 0;
    const seqBaseHistory = buildInitialHistory(currentBlunder);
    setPositionHistory(seqBaseHistory.history);
    setHistoryIndex(seqBaseHistory.blunderIdx);
    setLiveIndex(seqBaseHistory.blunderIdx);
    setBlunderIdx(seqBaseHistory.blunderIdx);

    let result: BlunderLineResponse;

    try {
      result = await getBlunderLine(currentBlunder.fen_before, currentBlunder.uci_played);
    } catch {
      setIsPlayingSequence(false);
      return;
    }

    sequenceActiveRef.current = true;

    // Recursive timer chain: apply one move then schedule the next after 600ms.
    // nextIdx tracks the history index to write into, passed through each call.
    const playStep = (moves: string[], fen: string, index: number, nextIdx: number): void => {
      if (!sequenceActiveRef.current || index >= moves.length) {
        setIsPlayingSequence(false);
        return;
      }

      const uci = moves[index];
      const chess = new Chess(fen);
      let newFen: string;

      try {
        const moved = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' });

        if (!moved) {
          setIsPlayingSequence(false);
          return;
        }

        newFen = chess.fen();
      } catch {
        setIsPlayingSequence(false);
        return;
      }

      setPositionHistory((prev) => [
        ...prev.slice(0, nextIdx),
        { fen: newFen, uci, evalScore: 0 },
      ]);
      setHistoryIndex(nextIdx);
      setLiveIndex(nextIdx);

      setLocalFen(newFen);
      setLastMoveUci(uci);
      playMoveSound();

      setTimeout(() => playStep(moves, newFen, index + 1, nextIdx + 1), 600);
    };

    // Small initial delay so the reset board renders before the sequence starts.
    // Start writing after the pre-seeded blunder position (blunderIdx + 1).
    setTimeout(() => playStep(result.moves, currentBlunder.fen_before, 0, seqBaseHistory.blunderIdx + 1), 200);
  }

  // ── Submit first move to backend ────────────────────────────────────────────
  function handleNext(): void {
    if (sessionId === undefined) {
      reset();
      return;
    }
    if (firstMove !== null) {
      submitAttempt(firstMove);
    }
  }

  // ── Save position to favorites ──────────────────────────────────────────────
  function handleSaveFavorite(): void {
    if (!currentBlunder) {
      return;
    }

    const boardImageDataUrl = generateBoardImage(currentBlunder.fen_before, orientation);
    const colorLabel = currentBlunder.color === 'w' ? 'White' : 'Black';
    const blunderDescription = `Move ${currentBlunder.move_number} (${colorLabel}) — ${currentBlunder.move_san} · ${currentBlunder.cp_loss} cp loss`;

    addFavorite({
      fen: currentBlunder.fen_before,
      orientation,
      blunderDescription,
      classification: currentBlunder.classification,
      cpLoss: currentBlunder.cp_loss,
      moveSan: currentBlunder.move_san,
      color: currentBlunder.color,
      moveNumber: currentBlunder.move_number,
      boardImageDataUrl,
    });
  }

  // ── History navigation ──────────────────────────────────────────────────────
  function handleHistoryBack(): void {
    if (historyIndex > 0) {
      setHistoryIndex(historyIndex - 1);
    }
  }

  function handleHistoryForward(): void {
    if (historyIndex < positionHistory.length - 1) {
      setHistoryIndex(historyIndex + 1);
    }
  }

  // ── Guard ───────────────────────────────────────────────────────────────────
  if (!currentBlunder) {
    return (
      <div className="trainer trainer--empty">
        <p className="trainer__empty-msg">Loading next blunder…</p>
      </div>
    );
  }

  const orientation = currentBlunder.color === 'black' ? 'black' : 'white';
  const isSaved = favorites.some((f) => f.fen === currentBlunder.fen_before);

  // Board is non-interactive whenever the user is browsing any position that
  // is not the live tip (before OR after it in the pre-seeded game history).
  const isViewingHistory = historyIndex !== liveIndex;
  const historyEntry = positionHistory[historyIndex];
  const displayFen = historyEntry?.fen ?? localFen ?? currentBlunder.fen_before;
  const displayLastMoveUci = historyEntry?.uci ?? null;
  const displayEval = historyEntry?.evalScore ?? currentEval;
  const progressPct = blunderCount > 0 ? (reviewedCount / blunderCount) * 100 : 0;

  // Applied only once ResizeObserver has measured; avoids zero-size flash
  const boardDimStyle: CSSProperties | undefined = boardSize > 0 ? { width: boardSize, height: boardSize } : undefined;
  const sideHeightStyle: CSSProperties | undefined = boardSize > 0 ? { height: boardSize } : undefined;

  let actionButton: JSX.Element;
  if (sessionId === undefined) {
    actionButton = (
      <button
        className="trainer__panel-btn"
        type="button"
        onClick={reset}
      >
        ← Back
      </button>
    );
  } else if (firstMove === null) {
    actionButton = (
      <button
        className="trainer__panel-btn"
        type="button"
        onClick={skipBlunder}
      >
        Skip →
      </button>
    );
  } else {
    actionButton = (
      <button
        className="trainer__panel-btn trainer__panel-btn--primary"
        type="button"
        onClick={handleNext}
      >
        Next →
      </button>
    );
  }

  // Derive SAN for the opponent's last move so the intro overlay can label it.
  let prevMoveSan: string | null = null;
  if (currentBlunder.prev_fen && currentBlunder.prev_move_uci) {
    try {
      const prevChess = new Chess(currentBlunder.prev_fen);
      const uci = currentBlunder.prev_move_uci;
      const prevMoved = prevChess.move({
        from: uci.slice(0, 2),
        to: uci.slice(2, 4),
        promotion: uci[4] ?? 'q',
      });
      if (prevMoved) {
        prevMoveSan = prevMoved.san;
      }
    } catch {
      prevMoveSan = null;
    }
  }

  return (
    <div className="trainer">
      <header className="trainer__header">
        <div className="trainer__brand">
          <span className="trainer__brand-icon">♚</span>
          <div>
            <div className="trainer__brand-title">Chess Blunder Trainer</div>
            <div className="trainer__brand-sub">
              Blunder {reviewedCount + 1} / {blunderCount}
            </div>
          </div>
        </div>

        <button className="trainer__menu-btn" type="button" onClick={reset} title="Back to menu">
          ⌂ Menu
        </button>
      </header>

      <div className="trainer__content">
        <div className="trainer__progress-track">
          <div className="trainer__progress-fill" style={{ width: `${progressPct}%` }} />
        </div>

        <BlunderCard
          moveSan={currentBlunder.move_san}
          cpLoss={currentBlunder.cp_loss}
          classification={currentBlunder.classification}
          onShowBlunderSequence={() => { void handleShowBlunderSequence(); }}
          sequenceDisabled={isPlayingSequence}
        />

      <div className="trainer__board-row" ref={boardRowRef}>
        <div className="trainer__eval" style={sideHeightStyle}>
          <EvalBar cpScore={displayEval} orientation={orientation} />
        </div>

        <div className="trainer__board" style={boardDimStyle}>
          <Board
            fen={displayFen}
            orientation={orientation}
            prevFen={currentBlunder.prev_fen}
            prevMoveUci={currentBlunder.prev_move_uci}
            prevMoveSan={prevMoveSan}
            onMove={handleMove}
            interactive={!botThinking && !isPlayingSequence && !isViewingHistory}
            arrowUcis={showArrows && !isViewingHistory ? currentArrows : []}
            lastMoveUci={displayLastMoveUci}
          />
        </div>

        <div className="trainer__panel-col" style={sideHeightStyle}>
          <div className="trainer__panel">
            {/* Move log */}
            <MoveLog entries={moveLog.slice(0, Math.max(0, historyIndex - blunderIdx))} />

            <hr className="trainer__panel-divider" />

            {/* Options */}
            <div className="trainer__panel-header">Options</div>
            <button
              className="trainer__panel-btn"
              type="button"
              onClick={() => setShowArrows((prev) => !prev)}
            >
              {showArrows ? 'Hide Moves' : 'Show Moves'}
            </button>

            <button
              className={`trainer__panel-btn${botMode ? ' trainer__panel-btn--active' : ''}`}
              type="button"
              onClick={() => setBotMode((prev) => !prev)}
              title={botMode ? 'Switch to analysis mode' : 'Play vs Stockfish'}
            >
              {botMode ? '◈ Analysis' : '♟ vs Bot'}
            </button>

            {botThinking && (
              <div className="trainer__bot-status">Stockfish thinking…</div>
            )}

            <button
              className="trainer__panel-btn"
              type="button"
              onClick={handleReset}
            >
              Reset Position
            </button>

            <hr className="trainer__panel-divider" />

            {/* Actions */}
            <div className="trainer__panel-header">Actions</div>

            <button
              className={`trainer__panel-btn${isSaved ? ' trainer__panel-btn--saved' : ''}`}
              type="button"
              onClick={handleSaveFavorite}
              disabled={isSaved}
            >
              {isSaved ? '★ Saved' : '☆ Save Position'}
            </button>

            {actionButton}
          </div>

          {/* History navigation — directly below the panel */}
          <div className="trainer__nav-row">
            <button
              className="trainer__nav-btn"
              type="button"
              onClick={handleHistoryBack}
              disabled={historyIndex === 0}
              title="Previous position"
            >
              ‹
            </button>
            <button
              className="trainer__nav-btn"
              type="button"
              onClick={handleHistoryForward}
              disabled={historyIndex === positionHistory.length - 1 || botMode}
              title="Next position"
            >
              ›
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

export default Trainer;
