import { GROUP_MEMBERS } from "./board.js";
import { mulberry32, type Rng } from "./dice.js";
import { Game } from "./game.js";
import type { Bot, GameState } from "./types.js";

export interface BatchPlayer {
  name: string;
  /** Given a seeded Rng, returns a fresh Bot for one game — the Rng matters for bots that do their
   * own internal randomness (e.g. MonteCarloBot's rollouts), so a batch run stays reproducible
   * instead of quietly falling back to Math.random for just that one seat. */
  createBot: (rng: Rng) => Bot;
}

export interface BatchOptions {
  players: BatchPlayer[];
  gameCount: number;
  /** Base seed; each game derives its own seed from this, so a batch run is reproducible end to end. */
  seed?: number;
  /** Safety cap per game, matching the convention used throughout the test suite. */
  maxTurnsPerGame?: number;
  /** Called after each game finishes — purely for progress reporting (e.g. the CLI), not part of
   * the simulation itself. */
  onGameComplete?: (gameIndex: number, result: GameResult) => void;
}

export interface GameResult {
  winnerName: string | null; // null if maxTurnsPerGame was hit with no winner
  turns: number;
  winnerProperties: number;
  winnerMonopolies: number;
}

export interface BatchResult {
  games: GameResult[];
}

function countOwnedProperties(state: GameState, playerId: string): number {
  return Object.values(state.ownership).filter((r) => r.ownerId === playerId).length;
}

/** Same pattern used in `lookahead.ts`, `bots/naive.ts`, and the web's `PlayerPanel.tsx` — railroads/
 * utilities excluded, since they scale with count owned rather than a single completed set. */
function countMonopolies(state: GameState, playerId: string): number {
  return Object.entries(GROUP_MEMBERS)
    .filter(([group]) => group !== "railroad" && group !== "utility")
    .filter(([, indices]) => indices.every((i) => state.ownership[i].ownerId === playerId)).length;
}

/**
 * Plays `gameCount` independent games headless (no UI, no animation) and reports each one's
 * winner, length, and the winner's board presence at game end. The reusable core behind the batch
 * CLI (`batch-cli.ts`) — also intended for direct, programmatic reuse later, e.g. NEAT's fitness
 * evaluation (Phase 3 of the bot-types roadmap), which needs to run many games per generation
 * without going through a CLI at all.
 */
export function runBatchSimulation(options: BatchOptions): BatchResult {
  const seed = options.seed ?? 1;
  const maxTurnsPerGame = options.maxTurnsPerGame ?? 1000;
  const games: GameResult[] = [];

  for (let gameIndex = 0; gameIndex < options.gameCount; gameIndex++) {
    // Spaced well apart so each game's rng stream (and each bot seat's own stream) can't overlap.
    const gameSeed = seed + gameIndex * 1000;
    const bots = options.players.map((p, i) => p.createBot(mulberry32(gameSeed + i + 1)));
    const game = new Game({
      playerNames: options.players.map((p) => p.name),
      bots,
      rng: mulberry32(gameSeed),
    });

    let turns = 0;
    while (!game.isGameOver() && turns < maxTurnsPerGame) {
      game.playTurn();
      turns++;
    }

    const winner = game.state.winnerId ? game.state.players.find((p) => p.id === game.state.winnerId)! : null;
    const result: GameResult = {
      winnerName: winner?.name ?? null,
      turns,
      winnerProperties: winner ? countOwnedProperties(game.state, winner.id) : 0,
      winnerMonopolies: winner ? countMonopolies(game.state, winner.id) : 0,
    };
    games.push(result);
    options.onGameComplete?.(gameIndex, result);
  }

  return { games };
}
