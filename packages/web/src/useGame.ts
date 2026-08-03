import { useCallback, useEffect, useRef, useState } from "react";
import {
  Game,
  createNaiveBot,
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
      working = withPlayerPosition(working, move.playerId, move.to);
      onFrame(working);
      onFade(null);
    } else {
      for (const pos of tilePath(move.from, move.to, move.direction)) {
        working = withPlayerPosition(working, move.playerId, pos);
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

export const BOT_CHOICES: BotChoice[] = [
  { label: "Naive (buys + builds within reserve)", create: () => createNaiveBot() },
  { label: "Random (buys everything, builds with thin buffer)", create: () => createRandomBot() },
  { label: "OrangeRush (rushes orange/red, thin reserve)", create: () => createOrangeRushBot() },
  { label: "RailroadBaron (railroads/utilities, big reserve)", create: () => createRailroadBaronBot() },
];

function newGame(botIndices: number[]): Game {
  return new Game({
    playerNames: botIndices.map((b, i) => `${BOT_CHOICES[b].label.split(" ")[0]} ${i + 1}`),
    bots: botIndices.map((b) => BOT_CHOICES[b].create()),
  });
}

export function useGame(initialBotIndices: number[] = [0, 1, 2, 3]) {
  const gameRef = useRef<Game>(newGame(initialBotIndices));
  const [state, setState] = useState<GameState>(() => gameRef.current.getSnapshot());
  const [history, setHistory] = useState<BankrollPoint[]>(() => [historyPoint(state)]);
  const [playing, setPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(400);
  const [animating, setAnimating] = useState(false);
  const [fadingPlayerId, setFadingPlayerId] = useState<string | null>(null);
  const isAnimatingRef = useRef(false);

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

    const timings = animationTimings(speedMs);
    if (timings && after.turn !== before.turn && after.moves.length > 0) {
      isAnimatingRef.current = true;
      setAnimating(true);
      await animateTurn(
        before,
        after,
        timings,
        (snapshot) => {
          if (gameRef.current === game) setState(snapshot); // bail if reset() swapped games mid-animation
        },
        (playerId) => {
          if (gameRef.current === game) setFadingPlayerId(playerId);
        },
      );
      isAnimatingRef.current = false;
      setAnimating(false);
    }
    if (gameRef.current === game) {
      setState(after);
      setHistory((h) => [...h, historyPoint(after)]);
    }
  }, [speedMs]);

  const reset = useCallback((botIndices: number[]) => {
    gameRef.current = newGame(botIndices);
    isAnimatingRef.current = false;
    setAnimating(false);
    setFadingPlayerId(null);
    const snapshot = gameRef.current.getSnapshot();
    setState(snapshot);
    setHistory([historyPoint(snapshot)]);
    setPlaying(false);
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(step, speedMs);
    return () => clearInterval(id);
  }, [playing, speedMs, step]);

  return { state, history, step, reset, playing, setPlaying, speedMs, setSpeedMs, animating, fadingPlayerId };
}
