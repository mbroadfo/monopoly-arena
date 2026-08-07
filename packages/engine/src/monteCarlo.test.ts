import { describe, expect, it } from "vitest";
import { createMonteCarloBot } from "./bots/monteCarlo.js";
import { createNaiveBot } from "./bots/naive.js";
import { createOrangeRushBot } from "./bots/orangeRush.js";
import { createRailroadBaronBot } from "./bots/railroadBaron.js";
import { createRandomBot } from "./bots/random.js";
import { Game } from "./game.js";
import { baseState, mulberry32 } from "./testFixtures.js";

describe("Game.fromState", () => {
  it("resumes a mid-game snapshot and keeps bot identity correct per player", () => {
    const state = baseState();
    state.ownership[1] = { ownerId: "p0", houses: 0, hotel: false, mortgaged: false };
    state.players[0].cash = 2000;

    // Deliberately pass bots in the same order as state.players, keyed by their real IDs —
    // exercises the fix for the fragile "fresh-init IDs happen to match" assumption.
    const game = Game.fromState(state, [createNaiveBot(), createRandomBot()], mulberry32(7));

    expect(() => game.playTurn()).not.toThrow();
    expect(game.state.ownership[1].ownerId).toBe("p0"); // resumed state preserved, not reset
  });
});

describe("createMonteCarloBot", () => {
  it("buys a property that completes a monopoly with cash to spare", () => {
    const bot = createMonteCarloBot({ rolloutCount: 20, horizonTurns: 5, rng: mulberry32(42) });
    const state = baseState();
    // Light blue group is Oriental(6)/Vermont(8)/Connecticut(9); Hero owns the first two and is
    // now landing on the third, completing the set, with plenty of cash in hand.
    state.ownership[6] = { ownerId: "p0", houses: 0, hotel: false, mortgaged: false };
    state.ownership[8] = { ownerId: "p0", houses: 0, hotel: false, mortgaged: false };
    state.players[0].cash = 1500;

    expect(bot.shouldBuyProperty(state, "p0", 9)).toBe(true);
  });

  it("declines a purchase that would leave it dangerously cash-short with no upside", () => {
    const bot = createMonteCarloBot({ rolloutCount: 20, horizonTurns: 5, rng: mulberry32(42) });
    const state = baseState();
    // Boardwalk (39, price 400) — Hero has just enough to afford it but nothing else, and owns
    // no other dark blue property, so there's no monopoly upside to offset the risk.
    state.players[0].cash = 420;

    expect(bot.shouldBuyProperty(state, "p0", 39)).toBe(false);
  });
});

describe("MonteCarloBot vs. reference bots", () => {
  // Smaller than createMonteCarloBot's defaults, purely to keep this sanity check fast — not a
  // recommendation for real play. Comprehensive win-rate comparison across many seeds is Phase 2's
  // job (the headless batch runner + stats dashboard), not this test.
  const opponents = [
    ["NaiveBot", () => createNaiveBot()],
    ["RandomBot", () => createRandomBot()],
    ["OrangeRushBot", () => createOrangeRushBot()],
    ["RailroadBaronBot", () => createRailroadBaronBot()],
  ] as const;

  it.each(opponents)("plays a full game against %s without throwing", (_label, createOpponent) => {
    for (let seed = 1; seed <= 5; seed++) {
      const game = new Game({
        playerNames: ["MonteCarlo", "Opponent"],
        bots: [createMonteCarloBot({ rolloutCount: 6, horizonTurns: 3, rng: mulberry32(seed * 1000) }), createOpponent()],
        rng: mulberry32(seed),
      });

      let turns = 0;
      while (!game.isGameOver() && turns < 1000) {
        game.playTurn();
        turns += 1;
      }

      expect(turns).toBeLessThan(1000); // didn't throw, and didn't obviously hang
    }
  });
});
