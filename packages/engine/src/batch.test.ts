import { describe, expect, it } from "vitest";
import { countFinanceActions, runBatchSimulation, type BatchPlayer } from "./batch.js";
import { createNaiveBot } from "./bots/naive.js";
import { createRandomBot } from "./bots/random.js";
import { baseState } from "./testFixtures.js";

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

describe("countFinanceActions", () => {
  it("counts mortgage, unmortgage, and sell-house/hotel lines for the named player only", () => {
    const state = baseState({
      log: [
        "Neat buys Boardwalk for $400.",
        "Neat mortgages Baltic Avenue for $30.",
        "Rival mortgages Park Place for $175.", // a different player — must not be counted
        "Neat pays off the mortgage on Baltic Avenue for $33.",
        "Neat sells a house on Ventnor Avenue (2/4) for $75.",
        "Neat sells the hotel on Boardwalk for $100.",
        "Neat owes Rival $50 rent for Reading Railroad.", // not a finance action
      ],
    });
    expect(countFinanceActions(state, "Neat")).toBe(4);
    expect(countFinanceActions(state, "Rival")).toBe(1);
  });

  it("is 0 when the player never touched mortgages or houses", () => {
    const state = baseState({ log: ["Neat buys Boardwalk for $400."] });
    expect(countFinanceActions(state, "Neat")).toBe(0);
  });
});
