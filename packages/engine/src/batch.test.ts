import { describe, expect, it } from "vitest";
import { runBatchSimulation, type BatchPlayer } from "./batch.js";
import { createNaiveBot } from "./bots/naive.js";
import { createRandomBot } from "./bots/random.js";

const players: BatchPlayer[] = [
  { name: "Naive 1", createBot: () => createNaiveBot() },
  { name: "Random 2", createBot: () => createRandomBot() },
];

describe("runBatchSimulation", () => {
  it("runs the requested number of games with sane per-game results", () => {
    const result = runBatchSimulation({ players, gameCount: 5, seed: 1, maxTurnsPerGame: 1000 });

    expect(result.games).toHaveLength(5);
    for (const game of result.games) {
      expect(game.turns).toBeGreaterThan(0);
      expect(game.turns).toBeLessThanOrEqual(1000);
      if (game.winnerName === null) {
        // hit the turn cap with no winner — a legitimate outcome, not a broken one
        expect(game.winnerProperties).toBe(0);
        expect(game.winnerMonopolies).toBe(0);
      } else {
        expect(players.map((p) => p.name)).toContain(game.winnerName);
        expect(game.winnerProperties).toBeGreaterThanOrEqual(0);
        expect(game.winnerMonopolies).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("is reproducible given the same seed", () => {
    const a = runBatchSimulation({ players, gameCount: 5, seed: 42, maxTurnsPerGame: 1000 });
    const b = runBatchSimulation({ players, gameCount: 5, seed: 42, maxTurnsPerGame: 1000 });
    expect(a).toEqual(b);
  });

  it("calls onGameComplete once per game, in order, with matching results", () => {
    const seenIndexes: number[] = [];
    const seenResults: unknown[] = [];
    const result = runBatchSimulation({
      players,
      gameCount: 4,
      seed: 7,
      maxTurnsPerGame: 1000,
      onGameComplete: (gameIndex, gameResult) => {
        seenIndexes.push(gameIndex);
        seenResults.push(gameResult);
      },
    });

    expect(seenIndexes).toEqual([0, 1, 2, 3]);
    expect(seenResults).toEqual(result.games);
  });
});
