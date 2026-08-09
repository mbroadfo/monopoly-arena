import { useCallback, useEffect, useRef, useState } from "react";
import {
  Game,
  createMonteCarloBot,
  createNaiveBot,
  createNeatBot,
  createOrangeRushBot,
  createRailroadBaronBot,
  createRandomBot,
  type Bot,
  type GameState,
} from "@monopoly-arena/engine";

// Animation timings scale with speedMs (the user's chosen ms-per-turn) rather than being fixed,
// so cranking up playback speed visibly speeds up the token's movement too, not just the pause
// between turns. Each is `speedMs * fraction`, clamped to a sensible visible range.
const HOP_FRACTION = 0.2;
const HOP_MIN_MS = 20;
const HOP_MAX_MS = 130;
const PAUSE_FRACTION = 0.75;
const PAUSE_MIN_MS = 40;
const PAUSE_MAX_MS = 500;
const FADE_FRACTION = 0.3;
const FADE_MIN_MS = 20;
const FADE_MAX_MS = 160;
// Below this, even the fastest visible hop (HOP_MIN_MS) would take longer than the fraction of
// speedMs it's allotted — animating at all would necessarily hold the simulation back below the
// speed the user asked for, so skip it entirely and apply the turn's final state instantly.
const ANIMATION_MIN_SPEED_MS = HOP_MIN_MS / HOP_FRACTION;

interface AnimationTimings {
  hopMs: number;
  pauseMs: number;
  fadeMs: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Returns null when speedMs is too fast for animation to keep up — the caller should skip
 * straight to the final state instead of playing back the turn's movements. */
function animationTimings(speedMs: number): AnimationTimings | null {
  if (speedMs < ANIMATION_MIN_SPEED_MS) return null;
  return {
    hopMs: clamp(speedMs * HOP_FRACTION, HOP_MIN_MS, HOP_MAX_MS),
    pauseMs: clamp(speedMs * PAUSE_FRACTION, PAUSE_MIN_MS, PAUSE_MAX_MS),
    fadeMs: clamp(speedMs * FADE_FRACTION, FADE_MIN_MS, FADE_MAX_MS),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withPlayerPosition(snapshot: GameState, playerId: string, position: number): GameState {
  return { ...snapshot, players: snapshot.players.map((p) => (p.id === playerId ? { ...p, position } : p)) };
}

/** Patches in ownership as it stood right after a move's landing resolved (see MoveEvent.ownershipAfter)
 * so property outlines, monopoly badges, and house/hotel markers update in step with the token's
 * hop animation instead of only once the whole turn finishes. */
function withOwnership(snapshot: GameState, ownership: GameState["ownership"]): GameState {
  return { ...snapshot, ownership };
}

/** Every "teleport" MoveEvent the engine produces is a jail send (see sendToJail in game.ts —
 * the only place that pushes one), so the reveal frame needs inJail patched to true alongside
 * the position, not just position alone — otherwise the board briefly renders the token in the
 * Jail tile's "Just Visiting" zone instead of the jail cell for one frame, since Board.tsx picks
 * the zone based on inJail. */
function withPlayerJailed(snapshot: GameState, playerId: string, position: number): GameState {
  return { ...snapshot, players: snapshot.players.map((p) => (p.id === playerId ? { ...p, position, inJail: true } : p)) };
}

/** Intermediate tile indices from `from` to `to` (exclusive/inclusive respectively), stepping
 * one space at a time so the token visibly hops around the board rather than jumping straight
 * there. Capped at a full lap so an accidental from === to can't loop forever. */
function tilePath(from: number, to: number, direction: "forward" | "backward"): number[] {
  const path: number[] = [];
  let pos = from;
  const step = direction === "forward" ? 1 : -1;
  for (let i = 0; i < 40 && pos !== to; i++) {
    pos = (pos + step + 40) % 40;
    path.push(pos);
  }
  if (path.length === 0) path.push(to);
  return path;
}

/** Plays back one turn's `MoveEvent`s against `before`, calling `onFrame` after each hop/jump
 * and `onFade` around a teleport, with a pause between distinct movements. Everything besides
 * the moving player's position (cash, ownership, log) stays frozen at `before`'s values until
 * the caller commits the true final state once this resolves. */
async function animateTurn(
  before: GameState,
  after: GameState,
  timings: AnimationTimings,
  onFrame: (snapshot: GameState) => void,
  onFade: (playerId: string | null) => void,
): Promise<void> {
  let working = before;
  for (const move of after.moves) {
    if (move.type === "teleport") {
      onFade(move.playerId);
      await sleep(timings.fadeMs);
      working = withPlayerJailed(working, move.playerId, move.to);
      working = withOwnership(working, move.ownershipAfter);
      onFrame(working);
      onFade(null);
    } else {
      const path = tilePath(move.from, move.to, move.direction);
      for (let i = 0; i < path.length; i++) {
        working = withPlayerPosition(working, move.playerId, path[i]);
        if (i === path.length - 1) working = withOwnership(working, move.ownershipAfter);
        onFrame(working);
        await sleep(timings.hopMs);
      }
    }
    await sleep(timings.pauseMs);
  }
}

export interface BotChoice {
  label: string;
  create: () => Bot;
}

export interface BankrollPoint {
  turn: number;
  cash: number[];
}

function historyPoint(state: GameState): BankrollPoint {
  return { turn: state.turn, cash: state.players.map((p) => p.cash) };
}

/**
 * Everything needed to reconstruct a past turn's display state, minus `spaces` (a constant
 * reference to BOARD, never needs per-turn storage) and `log` (replaced by `logLength` — the
 * engine's log is append-only, so the live state's full log is always a superset of any earlier
 * turn's log; slicing it beats storing a redundant copy of it in every single turn record, which
 * would be O(turns²) memory over a long game).
 */
interface TurnRecord {
  turn: number;
  ownership: GameState["ownership"];
  players: GameState["players"];
  currentPlayerIndex: number;
  housesRemaining: number;
  hotelsRemaining: number;
  winnerId: string | null;
  doublesStreak: number;
  tradeConditions: GameState["tradeConditions"];
  moves: GameState["moves"];
  logLength: number;
}

function toTurnRecord(state: GameState): TurnRecord {
  const { spaces: _spaces, log, ...rest } = state;
  return { ...rest, logLength: log.length };
}

function toDisplayState(record: TurnRecord, live: GameState): GameState {
  return { ...record, spaces: live.spaces, log: live.log.slice(0, record.logLength) };
}

export const BOT_CHOICES: BotChoice[] = [
  { label: "Naive (buys + builds within reserve)", create: () => createNaiveBot() },
  { label: "Random (buys everything, builds with thin buffer)", create: () => createRandomBot() },
  { label: "OrangeRush (rushes orange/red, thin reserve)", create: () => createOrangeRushBot() },
  { label: "RailroadBaron (railroads/utilities, big reserve)", create: () => createRailroadBaronBot() },
  { label: "MonteCarlo (simulates rollouts to buy/bid)", create: () => createMonteCarloBot() },
  { label: "NEAT (evolved network scores buy/bid/build)", create: () => createNeatBot() },
];

function newGame(botIndices: number[]): Game {
  return new Game({
    playerNames: botIndices.map((b, i) => `${BOT_CHOICES[b].label.split(" ")[0]} ${i + 1}`),
    bots: botIndices.map((b) => BOT_CHOICES[b].create()),
  });
}

export function useGame(initialBotIndices: number[] = [0, 1, 2, 3]) {
  const gameRef = useRef<Game>(newGame(initialBotIndices));
  const [liveState, setLiveState] = useState<GameState>(() => gameRef.current.getSnapshot());
  const [history, setHistory] = useState<BankrollPoint[]>(() => [historyPoint(liveState)]);
  const [turnRecords, setTurnRecords] = useState<TurnRecord[]>(() => [toTurnRecord(liveState)]);
  const [scrubTurn, setScrubTurn] = useState(0);
  const [displayOverride, setDisplayOverride] = useState<GameState | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(400);
  const [animating, setAnimating] = useState(false);
  const [animationEnabled, setAnimationEnabled] = useState(true);
  const [fadingPlayerId, setFadingPlayerId] = useState<string | null>(null);
  const isAnimatingRef = useRef(false);

  const isLive = scrubTurn === liveState.turn;
  const state = displayOverride ?? (isLive ? liveState : toDisplayState(turnRecords[scrubTurn], liveState));

  const step = useCallback(async () => {
    if (isAnimatingRef.current) return; // ignore an overlapping auto-play tick or manual double-click
    if (gameRef.current.isGameOver()) {
      setPlaying(false);
      return;
    }
    const game = gameRef.current;
    const before = game.getSnapshot();
    game.playTurn();
    const after = game.getSnapshot();

    const timings = animationEnabled ? animationTimings(speedMs) : null;
    if (timings && after.turn !== before.turn && after.moves.length > 0) {
      isAnimatingRef.current = true;
      setAnimating(true);
      await animateTurn(
        before,
        after,
        timings,
        (snapshot) => {
          if (gameRef.current === game) setDisplayOverride(snapshot); // bail if reset() swapped games mid-animation
        },
        (playerId) => {
          if (gameRef.current === game) setFadingPlayerId(playerId);
        },
      );
      isAnimatingRef.current = false;
      setAnimating(false);
    }
    if (gameRef.current === game) {
      setDisplayOverride(null);
      setLiveState(after);
      setHistory((h) => [...h, historyPoint(after)]);
      if (after.turn !== before.turn) {
        setTurnRecords((records) => [...records, toTurnRecord(after)]);
        setScrubTurn(after.turn); // stay pinned to the live edge as new turns land
      }
    }
  }, [speedMs, animationEnabled]);

  /** Instant jump to any past turn — no animation, so scanning a long game stays snappy. */
  const scrubTo = useCallback(
    (turn: number) => {
      if (isAnimatingRef.current) return; // an in-flight single-step replay owns displayOverride
      setPlaying(false); // dragging the timeline pauses live playback, like a video scrubber
      setDisplayOverride(null);
      setScrubTurn(Math.max(0, Math.min(turn, turnRecords.length - 1)));
    },
    [turnRecords.length],
  );

  /** Moves the scrub position by exactly one turn. Forward replays that turn's actual movement
   * (reusing the same animateTurn used for live play); backward just snaps — there's no
   * meaningful reverse of a dice roll to animate. */
  const stepTurn = useCallback(
    async (delta: 1 | -1) => {
      if (isAnimatingRef.current) return;
      const target = scrubTurn + delta;
      if (target < 0 || target >= turnRecords.length) return;
      setPlaying(false);

      if (delta === 1) {
        const before = toDisplayState(turnRecords[scrubTurn], liveState);
        const after = toDisplayState(turnRecords[target], liveState);
        const timings = animationEnabled ? animationTimings(speedMs) : null;
        if (timings && after.moves.length > 0) {
          isAnimatingRef.current = true;
          setAnimating(true);
          await animateTurn(before, after, timings, setDisplayOverride, setFadingPlayerId);
          isAnimatingRef.current = false;
          setAnimating(false);
          setDisplayOverride(null);
        }
      }
      setScrubTurn(target);
    },
    [scrubTurn, turnRecords, liveState, speedMs, animationEnabled],
  );

  const reset = useCallback((botIndices: number[]) => {
    gameRef.current = newGame(botIndices);
    isAnimatingRef.current = false;
    setAnimating(false);
    setFadingPlayerId(null);
    setDisplayOverride(null);
    const snapshot = gameRef.current.getSnapshot();
    setLiveState(snapshot);
    setHistory([historyPoint(snapshot)]);
    setTurnRecords([toTurnRecord(snapshot)]);
    setScrubTurn(0);
    setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(step, speedMs);
    return () => clearInterval(id);
  }, [playing, speedMs, step]);

  return {
    state,
    history,
    step,
    reset,
    playing,
    setPlaying,
    speedMs,
    setSpeedMs,
    animating,
    animationEnabled,
    setAnimationEnabled,
    fadingPlayerId,
    scrubTurn,
    latestTurn: liveState.turn,
    isLive,
    scrubTo,
    stepTurn,
  };
}
