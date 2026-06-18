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
import { playMoveOutcome } from '../../utils/sounds';
import { generateBoardImage } from '../../utils/generateBoardImage';
import { buildShareUrl } from '../../utils/sharePosition';
import ShareModal from '../ShareModal/ShareModal';
import shareIconUrl from '../../assets/share_icon.svg';
import arrowIconUrl from '../../assets/arrow_icon.svg';
import botIconUrl from '../../assets/bot_icon.svg';
import resetIconUrl from '../../assets/reset_icon.svg';
import arrowLeftIconUrl from '../../assets/arrow_left_icon.svg';
import arrowRightIconUrl from '../../assets/arrow_right_icon.svg';
import menuIconUrl from '../../assets/menu_icon.svg';
import doneIconUrl from '../../assets/done_icon.svg';
import SaveFavoriteModal from '../SaveFavoriteModal/SaveFavoriteModal';
import ThresholdPicker from '../ThresholdPicker/ThresholdPicker';
import useSettings from '../../hooks/useSettings';
import './Trainer.css';
import './Trainer.mobile.css';

/** Inline SVG chess pawn — replaces the ♟ emoji to avoid font-rendering variance. */
function PawnIcon({ size = 16 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 9c2.67 0 8 1.34 8 4v1H4v-1c0-2.66 5.33-4 8-4zM9 17h6l1.5 5H7.5L9 17z"/>
    </svg>
  );
}

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

interface TrainerProps {
  isMobile?: boolean;
}

function Trainer({ isMobile = false }: TrainerProps): JSX.Element {
  const currentBlunder = useSession((s) => s.currentBlunder);
  const reviewedCount = useSession((s) => s.reviewedCount);
  const blunderCount = useSession((s) => s.blunderCount);
  const sessionId = useSession((s) => s.sessionId);
  const sessionDone = useSession((s) => s.sessionDone);
  const sessionDoneReason = useSession((s) => s.sessionDoneReason);
  const lastSessionRequest = useSession((s) => s.lastSessionRequest);
  const submitAttempt = useSession((s) => s.submitAttempt);
  const skipBlunder = useSession((s) => s.skipBlunder);
  const buildSession = useSession((s) => s.buildSession);
  const reset = useSession((s) => s.reset);

  const addFavorite = useFavorites((s) => s.addFavorite);
  const favorites = useFavorites((s) => s.favorites);

  const threshold = useSettings((s) => s.threshold);
  const setThreshold = useSettings((s) => s.setThreshold);

  // ── Local board state ───────────────────────────────────────────────────────
  // Initialize directly from currentBlunder so the board has the correct FEN
  // from the very first render (Trainer remounts on each new blunder via screen
  // transitions, so the useState initializer always has a fresh blunder).
  const [localFen, setLocalFen] = useState<string>(currentBlunder?.fen_before ?? '');
  const [firstMove, setFirstMove] = useState<string | null>(null);
  const [moveLog, setMoveLog] = useState<MoveLogEntry[]>([]);
  const [currentEval, setCurrentEval] = useState<number>(currentBlunder?.eval_before_white_pov ?? 0);
  const [showArrows, setShowArrows] = useState<boolean>(false);
  const [currentArrows, setCurrentArrows] = useState<string[]>(currentBlunder?.best_moves ?? []);
  const [botMode, setBotMode] = useState<boolean>(false);
  const [botThinking, setBotThinking] = useState<boolean>(false);
  const [isPlayingSequence, setIsPlayingSequence] = useState<boolean>(false);
  const [saveModalOpen, setSaveModalOpen] = useState<boolean>(false);
  const [shareModalOpen, setShareModalOpen] = useState<boolean>(false);

  // Position history for < > navigation — seeded with prev/blunder/blunder-result context
  const initialHistory = buildInitialHistory(currentBlunder);
  const [positionHistory, setPositionHistory] = useState<HistoryEntry[]>(initialHistory.history);
  const [historyIndex, setHistoryIndex] = useState<number>(initialHistory.blunderIdx);
  // History index at which moveLog[0] was played — slice offset for the move log display
  const [moveLogBaseIdx, setMoveLogBaseIdx] = useState<number>(initialHistory.blunderIdx);
  // Immutable snapshot of the game path — used to restore forward history when the user plays a game move
  const gameHistoryRef = useRef<HistoryEntry[]>(initialHistory.history);

  // Sequential IDs so async eval responses match the right log entry
  const moveIdRef = useRef<number>(0);
  // Set to false to cancel a running blunder sequence
  const sequenceActiveRef = useRef<boolean>(false);
  // Guards the bot-move effect so a single reply is never requested twice.
  const botMoveInFlightRef = useRef<boolean>(false);

  // Board-row ref + measured size for responsive height-driven layout
  const boardRowRef = useRef<HTMLDivElement>(null);
  const [boardSize, setBoardSize] = useState<number>(0);

  useEffect(() => {
    const el = boardRowRef.current;
    if (!el) {
      return undefined;
    }

    // Width the settings panel + eval bar + flex gaps must always keep so the
    // panel never shrinks below its legible minimum (see .trainer__panel-col).
    const PANEL_MIN_WIDTH = 260;
    const EVAL_BAR_WIDTH = 30;
    const ROW_GAPS = 40;
    const RESERVED_WIDTH = PANEL_MIN_WIDTH + EVAL_BAR_WIDTH + ROW_GAPS;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        // Board is square: cap by both available height and the width left
        // over after reserving room for the panel, so a tall/narrow window
        // shrinks the board instead of crushing the settings panel.
        const heightLimit = entry.contentRect.height * 0.9;
        const widthLimit = entry.contentRect.width - RESERVED_WIDTH;
        setBoardSize(Math.floor(Math.max(0, Math.min(heightLimit, widthLimit))));
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
    setFirstMove(null);
    setMoveLog([]);
    setBotThinking(false);
    setCurrentEval(currentBlunder?.eval_before_white_pov ?? 0);
    setCurrentArrows(currentBlunder?.best_moves ?? []);
    // Hints don't carry over to the next position — the player opts in each time.
    setShowArrows(false);
    setIsPlayingSequence(false);
    const newHistory = buildInitialHistory(currentBlunder);
    setPositionHistory(newHistory.history);
    setHistoryIndex(newHistory.blunderIdx);
    setMoveLogBaseIdx(newHistory.blunderIdx);
  }

  // Reset move counter and fetch position eval when the blunder changes.
  // Ref mutations must live in effects, not in the render body.
  // Also covers games analysed before eval_before_white_pov was added to the cache.
  useEffect(() => {
    moveIdRef.current = 0;
    sequenceActiveRef.current = false;
    botMoveInFlightRef.current = false;
    const effectHistory = buildInitialHistory(currentBlunder);
    gameHistoryRef.current = effectHistory.history;

    if (!currentBlunder || currentBlunder.eval_before_white_pov !== 0) {
      return;
    }

    getPositionEval(currentBlunder.fen_before).then((res) => {
      setCurrentEval(res.eval_white_pov);
    });
  }, [currentBlunder]);

  // Refresh arrows whenever the board position changes (or arrows are toggled on).
  // For the initial blunder position, reuse the cached best_moves to skip a round-trip
  // unless they are empty (e.g. favorites loaded without pre-cached analysis).
  useEffect(() => {
    if (!showArrows || !localFen || !currentBlunder) {
      return undefined;
    }

    const hasCachedArrows = currentBlunder.best_moves.length > 0;
    if (localFen === currentBlunder.fen_before && hasCachedArrows) {
      // Arrows for the blunder position are derived directly in JSX from currentBlunder.best_moves
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

      const capturedFen = positionHistory[historyIndex]?.fen ?? localFen ?? currentBlunder.fen_before;
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

      // Side that played this move ('w' / 'b') — drives the move-log row tint.
      const moveSide: 'w' | 'b' = capturedFen.split(' ')[1] === 'b' ? 'b' : 'w';

      // The strongest suggested move for the captured position. At the blunder
      // position this is the cached best_moves; elsewhere it is the live hint
      // arrows. Playing it must always read as "best", even in a losing position.
      let topSuggested: string | undefined;
      if (capturedFen === currentBlunder.fen_before) {
        // Cached best moves are always valid for the blunder position.
        topSuggested = currentBlunder.best_moves?.[0];
      } else if (showArrows) {
        // Live arrows only match the current position while hints are shown.
        topSuggested = currentArrows[0];
      }
      const playedTopMove = topSuggested !== undefined && uci === topSuggested;

      if (firstMove === null) {
        setFirstMove(uci);
      }

      // Push user move — if it matches the next game-path entry, restore the forward game history
      const userHistoryIdx = historyIndex + 1;
      setPositionHistory((prev) => {
        const nextGameEntry = gameHistoryRef.current[historyIndex + 1];
        // Seed with the prior position's eval so the bar holds steady instead of
        // snapping to 0.0 until the async evaluation for this move arrives.
        const seedEval = prev[historyIndex]?.evalScore ?? currentEval;
        const base = [...prev.slice(0, historyIndex + 1), { fen: newFen, uci, evalScore: seedEval }];

        if (nextGameEntry && nextGameEntry.uci === uci) {
          // Played the game move — keep remaining game path intact so forward nav works
          return [...base, ...gameHistoryRef.current.slice(historyIndex + 2)];
        }

        return base;
      });
      setHistoryIndex(userHistoryIdx);

      setLocalFen(newFen);
      // Keep only log entries that are still valid for the current position, then append the new move
      const keepCount = Math.max(0, historyIndex - moveLogBaseIdx);
      setMoveLog((prev) => [...prev.slice(0, keepCount), { id, san, classification: null, cpLoss: null, side: moveSide }]);
      // If the user played from before the current log base, slide the base back to the new starting point
      if (historyIndex < moveLogBaseIdx) {
        setMoveLogBaseIdx(historyIndex);
      }

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
        // The top engine suggestion is best by definition, regardless of how
        // bad the resulting position is — never let it be flagged as a mistake.
        const classification = playedTopMove ? 'best' : result.classification;
        const cpLoss = playedTopMove ? 0 : result.cp_loss;
        setMoveLog((prev) =>
          prev.map((entry) =>
            entry.id === id
              ? { ...entry, classification, cpLoss }
              : entry,
          ),
        );
      });

      // Bot mode: the bot's reply is driven by a dedicated effect that fires
      // whenever it becomes the bot's turn at the live position (see below).
    },
    [currentBlunder, localFen, firstMove, historyIndex, positionHistory, moveLogBaseIdx, currentArrows, showArrows, currentEval],
  );

  // ── Bot reply ───────────────────────────────────────────────────────────────
  // Plays Stockfish's move from `fromFen`, appending it right after `appendAfterIdx`.
  const playBotMove = useCallback(
    (fromFen: string, appendAfterIdx: number): void => {
      botMoveInFlightRef.current = true;
      setBotThinking(true);

      getStockfishMove({ fen: fromFen }).then((response) => {
        const sfUci = response.best_move_uci;

        if (sfUci) {
          const sfChess = new Chess(fromFen);
          let sfSan: string;
          let sfFen: string;
          let sfOutcome = { captured: false, check: false, checkmate: false };

          try {
            const sfMove = sfChess.move({ from: sfUci.slice(0, 2), to: sfUci.slice(2, 4), promotion: sfUci[4] ?? 'q' });
            sfSan = sfMove ? sfMove.san : sfUci;
            sfFen = sfChess.fen();
            sfOutcome = { captured: Boolean(sfMove?.captured), check: sfChess.inCheck(), checkmate: sfChess.isCheckmate() };
          } catch {
            sfSan = sfUci;
            sfFen = fromFen;
          }

          const sfId = moveIdRef.current;
          moveIdRef.current += 1;

          const sfHistoryIdx = appendAfterIdx + 1;
          setPositionHistory((prev) => [
            ...prev.slice(0, appendAfterIdx + 1),
            { fen: sfFen, uci: sfUci, evalScore: response.eval_after_white_pov },
          ]);
          setHistoryIndex(sfHistoryIdx);

          setLocalFen(sfFen);
          setCurrentEval(response.eval_after_white_pov);
          playMoveOutcome(sfOutcome);
          // Bot moves from fromFen, so its side is whoever is to move there.
          const sfSide: 'w' | 'b' = fromFen.split(' ')[1] === 'b' ? 'b' : 'w';
          setMoveLog((prev) => [...prev, { id: sfId, san: sfSan, classification: null, cpLoss: null, side: sfSide }]);

          // Evaluate bot's move quality too so the log shows its classification.
          evaluateMove({ fen_before: fromFen, uci_move: sfUci }).then((sfResult) => {
            setMoveLog((prev) =>
              prev.map((entry) =>
                entry.id === sfId
                  ? { ...entry, classification: sfResult.classification, cpLoss: sfResult.cp_loss }
                  : entry,
              ),
            );
          });
        }

        botMoveInFlightRef.current = false;
        setBotThinking(false);
      }).catch(() => {
        botMoveInFlightRef.current = false;
        setBotThinking(false);
      });
    },
    [],
  );

  // Drive the bot reply: whenever bot mode is on and it becomes the bot's turn at
  // the live tip of the position, ask Stockfish to move. This covers both the
  // reply after the user's move and enabling bot mode during the opponent's turn.
  useEffect(() => {
    if (!botMode || !currentBlunder || botThinking || botMoveInFlightRef.current) {
      return undefined;
    }

    // Only act at the live tip — not while browsing earlier positions.
    if (historyIndex !== positionHistory.length - 1) {
      return undefined;
    }

    const tipFen = positionHistory[historyIndex]?.fen ?? localFen;
    if (!tipFen) {
      return undefined;
    }

    // The game is over (checkmate / stalemate) — there is nothing to reply with,
    // so don't keep the bot "thinking".
    try {
      if (new Chess(tipFen).isGameOver()) {
        return undefined;
      }
    } catch {
      return undefined;
    }

    // User's colour is the side to move at the blunder position; the bot is the
    // other side. Auto-play only when it is the bot's turn.
    const userColor = currentBlunder.fen_before.split(' ')[1];
    const turn = tipFen.split(' ')[1];
    if (turn === userColor) {
      return undefined;
    }

    // Defer behind a short delay so the reply feels deliberate (and to keep the
    // state update out of the synchronous effect body).
    const timer = setTimeout(() => playBotMove(tipFen, historyIndex), 350);
    return () => {
      clearTimeout(timer);
    };
  }, [botMode, botThinking, currentBlunder, historyIndex, positionHistory, localFen, playBotMove]);

  // ── Reset to blunder position ───────────────────────────────────────────────
  function handleReset(): void {
    if (!currentBlunder) {
      return;
    }

    sequenceActiveRef.current = false;
    setIsPlayingSequence(false);
    setLocalFen(currentBlunder.fen_before);
    setFirstMove(null);
    setMoveLog([]);
    setCurrentEval(currentBlunder.eval_before_white_pov ?? 0);
    setCurrentArrows(currentBlunder.best_moves ?? []);
    // Hints are an explicit aid — turn them off when the position is reset.
    setShowArrows(false);
    setBotThinking(false);
    botMoveInFlightRef.current = false;
    moveIdRef.current = 0;
    const resetHistory = buildInitialHistory(currentBlunder);
    setPositionHistory(resetHistory.history);
    setHistoryIndex(resetHistory.blunderIdx);
    setMoveLogBaseIdx(resetHistory.blunderIdx);
    gameHistoryRef.current = resetHistory.history;
  }

  // ── Sequence replay ─────────────────────────────────────────────────────────
  // Plays a line starting from firstUci (the blunder move, or the best move the
  // player missed) followed by Stockfish's continuation.
  async function playLineFrom(firstUci: string): Promise<void> {
    if (!currentBlunder) {
      return;
    }

    // Cancel any already-running sequence, then reset to the blunder position.
    sequenceActiveRef.current = false;
    setIsPlayingSequence(true);
    setLocalFen(currentBlunder.fen_before);
    setFirstMove(null);
    setMoveLog([]);
    moveIdRef.current = 0;
    const seqBaseHistory = buildInitialHistory(currentBlunder);
    setPositionHistory(seqBaseHistory.history);
    setHistoryIndex(seqBaseHistory.blunderIdx);
    setMoveLogBaseIdx(seqBaseHistory.blunderIdx);
    gameHistoryRef.current = seqBaseHistory.history;

    let result: BlunderLineResponse;

    try {
      result = await getBlunderLine(currentBlunder.fen_before, firstUci);
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
      let outcome: { captured: boolean; check: boolean; checkmate: boolean };

      try {
        const moved = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' });

        if (!moved) {
          setIsPlayingSequence(false);
          return;
        }

        newFen = chess.fen();
        outcome = { captured: Boolean(moved.captured), check: chess.inCheck(), checkmate: chess.isCheckmate() };
      } catch {
        setIsPlayingSequence(false);
        return;
      }

      // Seed with the previous position's eval so the bar holds steady (instead
      // of snapping to 0) until the real evaluation for this position arrives.
      setPositionHistory((prev) => {
        const seedEval = prev[nextIdx - 1]?.evalScore ?? currentEval;
        return [...prev.slice(0, nextIdx), { fen: newFen, uci, evalScore: seedEval }];
      });
      setHistoryIndex(nextIdx);

      setLocalFen(newFen);
      playMoveOutcome(outcome);

      // Evaluate this position so the eval bar moves live through the sequence.
      getPositionEval(newFen).then((res) => {
        if (!sequenceActiveRef.current) {
          return;
        }
        setPositionHistory((prev) => {
          const updated = [...prev];
          if (updated[nextIdx]) {
            updated[nextIdx] = { ...updated[nextIdx], evalScore: res.eval_white_pov };
          }
          return updated;
        });
        setCurrentEval(res.eval_white_pov);
      }).catch(() => {});

      setTimeout(() => playStep(moves, newFen, index + 1, nextIdx + 1), 600);
    };

    // Small initial delay so the reset board renders before the sequence starts.
    // Start writing after the pre-seeded blunder position (blunderIdx + 1).
    setTimeout(() => playStep(result.moves, currentBlunder.fen_before, 0, seqBaseHistory.blunderIdx + 1), 200);
  }

  // Replays the blunder that was played, then the engine's refutation.
  async function handleShowBlunderSequence(): Promise<void> {
    if (!currentBlunder) {
      return;
    }
    await playLineFrom(currentBlunder.uci_played);
  }

  // Replays the winning line the player missed (best move + continuation).
  async function handleShowBestSequence(): Promise<void> {
    if (!currentBlunder || currentBlunder.best_moves.length === 0) {
      return;
    }
    await playLineFrom(currentBlunder.best_moves[0]);
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

  // ── Session done modal actions ──────────────────────────────────────────────
  function handleReviewNextGame(): void {
    if (!lastSessionRequest) {
      reset();
      return;
    }

    void buildSession({ ...lastSessionRequest, game_url: undefined });
  }

  function handleRetryWithThreshold(newThreshold: number): void {
    setThreshold(newThreshold);

    if (!lastSessionRequest) {
      reset();
      return;
    }

    void buildSession({ ...lastSessionRequest, threshold: newThreshold });
  }

  // ── Save position to favorites ──────────────────────────────────────────────
  function handleSaveFavorite(): void {
    if (!currentBlunder) {
      return;
    }

    setSaveModalOpen(true);
  }

  function handleConfirmSave(note: string): void {
    if (!currentBlunder) {
      return;
    }

    setSaveModalOpen(false);

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
      note: note !== '' ? note : undefined,
      prevFen: currentBlunder.prev_fen,
      prevMoveUci: currentBlunder.prev_move_uci,
      uciPlayed: currentBlunder.uci_played,
    });
  }

  function handleCancelSave(): void {
    setSaveModalOpen(false);
  }

  // ── Share position ──────────────────────────────────────────────────────────
  function handleShare(): void {
    if (!currentBlunder) {
      return;
    }

    setShareModalOpen(true);
  }

  const shareUrl = currentBlunder
    ? buildShareUrl({
        fen: currentBlunder.fen_before,
        color: currentBlunder.color,
        move_san: currentBlunder.move_san,
        cp_loss: currentBlunder.cp_loss,
        classification: currentBlunder.classification,
        move_number: currentBlunder.move_number,
        prev_fen: currentBlunder.prev_fen,
        prev_move_uci: currentBlunder.prev_move_uci,
        uci_played: currentBlunder.uci_played,
        best_moves: currentBlunder.best_moves,
        eval_before_white_pov: currentBlunder.eval_before_white_pov,
      })
    : '';

  // ── History navigation ──────────────────────────────────────────────────────
  function handleHistoryBack(): void {
    if (historyIndex > 0) {
      const newIdx = historyIndex - 1;
      setHistoryIndex(newIdx);
      setLocalFen(positionHistory[newIdx]?.fen ?? localFen);
    }
  }

  function handleHistoryForward(): void {
    if (historyIndex < positionHistory.length - 1) {
      const newIdx = historyIndex + 1;
      setHistoryIndex(newIdx);
      setLocalFen(positionHistory[newIdx]?.fen ?? localFen);
    }
  }

  // ── Guard ───────────────────────────────────────────────────────────────────
  if (sessionDone) {
    return (
      <div className="trainer trainer--empty">
        <div className="trainer__done-overlay trainer__done-overlay--static">
          <div className="trainer__done-modal">
            <div className="trainer__done-icon"><PawnIcon size={32} /></div>
            <h2 className="trainer__done-title">
              {sessionDoneReason === 'no_blunders' ? 'Clean game!' : 'All blunders reviewed!'}
            </h2>
            <p className="trainer__done-msg">
              {sessionDoneReason === 'no_blunders'
                ? 'No blunders found in this game.'
                : 'No more blunders to review in this game.'}
            </p>

            {sessionDoneReason === 'no_blunders' && (
              <div className="trainer__done-threshold">
                <span className="trainer__done-threshold-label">Lower the threshold to find more blunders</span>
                <ThresholdPicker value={threshold} onChange={handleRetryWithThreshold} />
              </div>
            )}

            <div className="trainer__done-actions">
              <button
                className="trainer__done-btn trainer__done-btn--primary"
                type="button"
                onClick={handleReviewNextGame}
              >
                Next game
              </button>
              <button
                className="trainer__done-btn"
                type="button"
                onClick={reset}
              >
                Back to menu
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!currentBlunder) {
    return (
      <div className="trainer trainer--empty">
        <p className="trainer__empty-msg">Loading next blunder…</p>
      </div>
    );
  }

  const orientation = currentBlunder.color === 'black' ? 'black' : 'white';
  const isSaved = favorites.some((f) => f.fen === currentBlunder.fen_before);

  const historyEntry = positionHistory[historyIndex];
  const displayFen = historyEntry?.fen ?? localFen ?? currentBlunder.fen_before;
  const displayLastMoveUci = historyEntry?.uci ?? null;
  const displayEval = historyEntry?.evalScore ?? currentEval;
  // Show the blunder arrow only when the board is at the exact blunder position
  const isAtBlunderPosition = historyIndex === initialHistory.blunderIdx && firstMove === null;
  const blunderArrowUci = isAtBlunderPosition ? (currentBlunder.uci_played ?? null) : null;
  const progressPct = blunderCount > 0 ? ((reviewedCount + 1) / blunderCount) * 100 : 0;

  // Applied only once ResizeObserver has measured; avoids zero-size flash
  const boardDimStyle: CSSProperties | undefined = boardSize > 0 ? { width: boardSize, height: boardSize } : undefined;
  const sideHeightStyle: CSSProperties | undefined = boardSize > 0 ? { height: boardSize } : undefined;

  const finishContent = (
    <>
      <img className="trainer__panel-btn-svg" src={doneIconUrl} alt="" />
      Finish
    </>
  );

  let actionButton: JSX.Element;
  if (sessionId === undefined) {
    actionButton = (
      <button
        className="trainer__panel-btn trainer__panel-btn--primary trainer__panel-btn--next trainer__panel-btn--icon"
        type="button"
        onClick={reset}
      >
        {finishContent}
      </button>
    );
  } else if (firstMove === null) {
    const isLastBlunder = reviewedCount + 1 >= blunderCount;
    actionButton = (
      <button
        className={`trainer__panel-btn trainer__panel-btn--next${isLastBlunder ? ' trainer__panel-btn--primary trainer__panel-btn--icon' : ''}`}
        type="button"
        onClick={skipBlunder}
      >
        {isLastBlunder ? finishContent : <><span className="trainer__panel-btn-ic">▶▶</span>Skip</>}
      </button>
    );
  } else {
    const isLastBlunder = reviewedCount + 1 >= blunderCount;
    actionButton = (
      <button
        className="trainer__panel-btn trainer__panel-btn--primary trainer__panel-btn--next trainer__panel-btn--icon"
        type="button"
        onClick={handleNext}
      >
        {isLastBlunder ? finishContent : <><span className="trainer__panel-btn-ic">▶▶</span>Next</>}
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

  // ── Mobile layout ───────────────────────────────────────────────────────────
  if (isMobile) {
    // Contextual action for the bottom bar's last button
    let mobileActionLabel: string;
    let mobileActionHandler: () => void;
    let mobileActionPrimary: boolean;

    if (sessionId === undefined) {
      mobileActionLabel = 'Finish';
      mobileActionHandler = reset;
      mobileActionPrimary = true;
    } else if (firstMove === null) {
      const isLastBlunder = reviewedCount + 1 >= blunderCount;
      mobileActionLabel = isLastBlunder ? 'Finish' : 'Skip';
      mobileActionHandler = skipBlunder;
      mobileActionPrimary = isLastBlunder;
    } else {
      const isLastBlunder = reviewedCount + 1 >= blunderCount;
      mobileActionLabel = isLastBlunder ? 'Finish' : 'Next';
      mobileActionHandler = handleNext;
      mobileActionPrimary = true;
    }

    const BADGE_COLORS: Record<string, string> = {
      best: '#22c55e',
      good: '#84cc16',
      inaccuracy: '#f59e0b',
      mistake: '#f97316',
      blunder: '#ef4444',
    };

    return (
      <>
      <div className="trainer trainer--mobile">
        {/* Body — board fills all available space */}
        <div className="trainer__mobile-body">
          {/* Blunder prompt banner — same message + Show button as the desktop layout */}
          <BlunderCard
            moveSan={currentBlunder.move_san}
            cpLoss={currentBlunder.cp_loss}
            category={currentBlunder.category}
            onShowBlunderSequence={() => { void handleShowBlunderSequence(); }}
            onShowBestSequence={() => { void handleShowBestSequence(); }}
            sequenceDisabled={isPlayingSequence}
            compactPrompt
            compactSequenceLabel
          />

          {/* Horizontal eval bar */}
          <EvalBar cpScore={displayEval} orientation={orientation} horizontal />

          {/* Board */}
          <div className="trainer__mobile-board-area">
            <div className="trainer__mobile-board-wrap">
              <Board
                fen={displayFen}
                orientation={orientation}
                prevFen={currentBlunder.prev_fen}
                prevMoveUci={currentBlunder.prev_move_uci}
                prevMoveSan={prevMoveSan}
                onMove={handleMove}
                interactive={!botThinking && !isPlayingSequence}
                arrowUcis={showArrows ? currentArrows : []}
                lastMoveUci={displayLastMoveUci}
                blunderArrowUci={blunderArrowUci}
              />
            </div>
          </div>
        </div>

        {/* Settings panel — sticky footer */}
        <div className="trainer__mobile-panel">
          {/* Nav row: ‹  [blunder info / move feedback]  [show sequence]  › */}
          <div className="trainer__mobile-panel-nav">
            <button
              className="trainer__mobile-nav-btn"
              type="button"
              onClick={handleHistoryBack}
              disabled={historyIndex === 0}
              title="Previous position"
            >
              <img className="trainer__mobile-nav-ic" src={arrowLeftIconUrl} alt="Previous" />
            </button>

            {/* Centre: blunder info + Show button when no move played, move feedback otherwise */}
            <div className="trainer__mobile-inline-fb">
              {(() => {
                const visibleEntries = moveLog.slice(0, Math.max(0, historyIndex - moveLogBaseIdx));
                const lastEntry = visibleEntries[visibleEntries.length - 1] ?? null;

                if (botThinking) {
                  return <span className="trainer__mobile-inline-fb__thinking">Stockfish…</span>;
                }

                if (lastEntry === null) {
                  // Before a move is played the blunder prompt + Show button live in
                  // the banner above the board, so the nav centre stays empty here.
                  return null;
                }

                const moveColor = lastEntry.classification !== null ? BADGE_COLORS[lastEntry.classification] : undefined;

                return (
                  <div className="trainer__mobile-inline-fb__entry">
                    <span className="trainer__mobile-inline-fb__san">{lastEntry.san}</span>
                    {lastEntry.classification !== null && moveColor !== undefined
                      ? (
                        <span
                          className="trainer__mobile-inline-fb__badge"
                          style={{ color: moveColor, borderColor: `${moveColor}55`, background: `${moveColor}18` }}
                        >
                          {lastEntry.classification}
                        </span>
                      )
                      : <span className="trainer__mobile-inline-fb__pending">⏳</span>
                    }
                    {lastEntry.cpLoss !== null && (
                      <span className="trainer__mobile-inline-fb__cp" style={moveColor !== undefined ? { color: moveColor } : undefined}>
                        -{lastEntry.cpLoss} cp
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>

            <button
              className="trainer__mobile-nav-btn"
              type="button"
              onClick={handleHistoryForward}
              disabled={historyIndex === positionHistory.length - 1 || botMode}
              title="Next position"
            >
              <img className="trainer__mobile-nav-ic" src={arrowRightIconUrl} alt="Next" />
            </button>
          </div>

          {/* Progress bar — separator between nav and options, with side margins */}
          <div className="trainer__mobile-panel-progress">
            <div className="trainer__progress-track">
              <div className="trainer__progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          </div>

          {/* Action row — 6 icon buttons including Menu */}
          <div className="trainer__mobile-panel-actions">
            <button
              className={`trainer__mobile-act${showArrows ? ' trainer__mobile-act--on' : ''}`}
              type="button"
              onClick={() => setShowArrows((prev) => !prev)}
            >
              <img className="trainer__mobile-act-svg" src={arrowIconUrl} alt="" />
              <span className="trainer__mobile-act-lbl">Hints</span>
            </button>

            <button
              className={`trainer__mobile-act${botMode ? ' trainer__mobile-act--on' : ''}`}
              type="button"
              onClick={() => setBotMode((prev) => !prev)}
              title={botMode ? 'Switch to analysis mode' : 'Play vs Stockfish'}
            >
              <img className="trainer__mobile-act-svg" src={botIconUrl} alt="" />
              <span className="trainer__mobile-act-lbl">vs Bot</span>
            </button>

            <button
              className="trainer__mobile-act"
              type="button"
              onClick={handleReset}
            >
              <img className="trainer__mobile-act-svg" src={resetIconUrl} alt="" />
              <span className="trainer__mobile-act-lbl">Reset</span>
            </button>

            <button
              className={`trainer__mobile-act${isSaved ? ' trainer__mobile-act--on' : ''}`}
              type="button"
              onClick={handleSaveFavorite}
              disabled={isSaved}
              title={isSaved ? 'Already saved' : 'Save position'}
            >
              <span className="trainer__mobile-act-ic">{isSaved ? '★' : '☆'}</span>
              <span className="trainer__mobile-act-lbl">Save</span>
            </button>

            <button
              className="trainer__mobile-act trainer__mobile-act--share"
              type="button"
              onClick={handleShare}
              title="Share position"
            >
              <img
                className="trainer__mobile-act-share-ic"
                src={shareIconUrl}
                alt="Share"
              />
              <span className="trainer__mobile-act-lbl">Share</span>
            </button>

            <button
              className="trainer__mobile-act"
              type="button"
              onClick={reset}
              title="Back to menu"
            >
              <span className="trainer__mobile-act-menu-bars">
                <i /><i /><i />
              </span>
              <span className="trainer__mobile-act-lbl">Menu</span>
            </button>
          </div>

          {/* Skip / Next / Finish — full-width row below the icon buttons */}
          <div className="trainer__mobile-panel-skip">
            <button
              className={`trainer__mobile-skip-btn${mobileActionPrimary ? ' trainer__mobile-skip-btn--primary' : ''}`}
              type="button"
              onClick={mobileActionHandler}
            >
              <span className="trainer__mobile-skip-ic">▶▶</span>
              {mobileActionLabel}
            </button>
          </div>
        </div>
      </div>

      {currentBlunder && (
        <SaveFavoriteModal
          isOpen={saveModalOpen}
          classification={currentBlunder.classification}
          blunderDescription={`Move ${currentBlunder.move_number} (${currentBlunder.color === 'w' ? 'White' : 'Black'}) — ${currentBlunder.move_san} · ${currentBlunder.cp_loss} cp loss`}
          onConfirm={handleConfirmSave}
          onCancel={handleCancelSave}
        />
      )}
      {currentBlunder && (
        <ShareModal
          isOpen={shareModalOpen}
          url={shareUrl}
          classification={currentBlunder.classification}
          blunderDescription={`Move ${currentBlunder.move_number} (${currentBlunder.color === 'w' ? 'White' : 'Black'}) — ${currentBlunder.move_san} · ${currentBlunder.cp_loss} cp loss`}
          onClose={() => { setShareModalOpen(false); }}
        />
      )}
      </>
    );
  }

  return (
    <>
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
          <img className="trainer__menu-btn-ic" src={menuIconUrl} alt="" />
          Menu
        </button>
      </header>

      <div className="trainer__content">
        <div className="trainer__progress-track">
          <div className="trainer__progress-fill" style={{ width: `${progressPct}%` }} />
        </div>

        <BlunderCard
          moveSan={currentBlunder.move_san}
          cpLoss={currentBlunder.cp_loss}
          category={currentBlunder.category}
          onShowBlunderSequence={() => { void handleShowBlunderSequence(); }}
          onShowBestSequence={() => { void handleShowBestSequence(); }}
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
            interactive={!botThinking && !isPlayingSequence}
            arrowUcis={showArrows ? currentArrows : []}
            lastMoveUci={displayLastMoveUci}
            blunderArrowUci={blunderArrowUci}
          />
        </div>

        <div className="trainer__panel-col" style={sideHeightStyle}>
          <div className="trainer__panel">
            {/* Move log */}
            <MoveLog entries={moveLog.slice(0, Math.max(0, historyIndex - moveLogBaseIdx))} />

            <hr className="trainer__panel-divider" />

            {/* Options */}
            <div className="trainer__panel-header">Options</div>
            <button
              className={`trainer__panel-btn trainer__panel-btn--icon${showArrows ? ' trainer__panel-btn--active' : ''}`}
              type="button"
              onClick={() => setShowArrows((prev) => !prev)}
            >
              <img className="trainer__panel-btn-svg" src={arrowIconUrl} alt="" />
              Hints
            </button>

            <button
              className={`trainer__panel-btn trainer__panel-btn--icon${botMode ? ' trainer__panel-btn--active' : ''}`}
              type="button"
              onClick={() => setBotMode((prev) => !prev)}
              title={botMode ? 'Switch to analysis mode' : 'Play vs Stockfish'}
            >
              <img className="trainer__panel-btn-svg" src={botIconUrl} alt="" />
              vs Bot
            </button>

            {botThinking && (
              <div className="trainer__bot-status">Stockfish thinking…</div>
            )}

            <button
              className="trainer__panel-btn trainer__panel-btn--icon"
              type="button"
              onClick={handleReset}
            >
              <img className="trainer__panel-btn-svg" src={resetIconUrl} alt="" />
              Reset
            </button>

            <hr className="trainer__panel-divider" />

            {/* Actions */}
            <div className="trainer__panel-header">Actions</div>

            <div className="trainer__panel-actions-row">
              <button
                className={`trainer__panel-icon-btn${isSaved ? ' trainer__panel-icon-btn--saved' : ''}`}
                type="button"
                onClick={handleSaveFavorite}
                disabled={isSaved}
                title={isSaved ? 'Already saved' : 'Save position'}
              >
                {isSaved ? '★' : '☆'}
              </button>

              <button
                className="trainer__panel-icon-btn"
                type="button"
                onClick={handleShare}
                title="Share position"
              >
                <img
                  className="trainer__panel-share-ic"
                  src={shareIconUrl}
                  alt="Share"
                />
              </button>

              {actionButton}
            </div>

            {/* History navigation — inside the panel, full width */}
            <div className="trainer__panel-nav-row">
              <button
                className="trainer__nav-btn"
                type="button"
                onClick={handleHistoryBack}
                disabled={historyIndex === 0}
                title="Previous position"
              >
                <img className="trainer__nav-btn-ic" src={arrowLeftIconUrl} alt="Previous" />
              </button>
              <button
                className="trainer__nav-btn"
                type="button"
                onClick={handleHistoryForward}
                disabled={historyIndex === positionHistory.length - 1 || botMode}
                title="Next position"
              >
                <img className="trainer__nav-btn-ic" src={arrowRightIconUrl} alt="Next" />
              </button>
            </div>
          </div>
        </div>
      </div>
      </div>
    </div>

    {currentBlunder && (
      <SaveFavoriteModal
        isOpen={saveModalOpen}
        classification={currentBlunder.classification}
        blunderDescription={`Move ${currentBlunder.move_number} (${currentBlunder.color === 'w' ? 'White' : 'Black'}) — ${currentBlunder.move_san} · ${currentBlunder.cp_loss} cp loss`}
        onConfirm={handleConfirmSave}
        onCancel={handleCancelSave}
      />
    )}
    {currentBlunder && (
      <ShareModal
        isOpen={shareModalOpen}
        url={shareUrl}
        classification={currentBlunder.classification}
        blunderDescription={`Move ${currentBlunder.move_number} (${currentBlunder.color === 'w' ? 'White' : 'Black'}) — ${currentBlunder.move_san} · ${currentBlunder.cp_loss} cp loss`}
        onClose={() => { setShareModalOpen(false); }}
      />
    )}
    </>
  );
}

export default Trainer;
