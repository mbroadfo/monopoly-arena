import { describe, expect, it } from "vitest";
import { Game } from "./game.js";
import { createNaiveBot } from "./bots/naive.js";
import { createRandomBot } from "./bots/random.js";

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("Game", () => {
  it("plays to completion without throwing", () => {
    const game = new Game({
      playerNames: ["Alice", "Bob"],
      bots: [createNaiveBot(), createRandomBot()],
      rng: mulberry32(42),
    });

    let turns = 0;
    while (!game.isGameOver() && turns < 5000) {
      game.playTurn();
      turns += 1;
    }

    expect(game.isGameOver()).toBe(true);
    expect(game.state.winnerId).not.toBeNull();
  });

  it("starts every player with $1500 and no properties owned", () => {
    const game = new Game({
      playerNames: ["Alice", "Bob"],
      bots: [createRandomBot(), createRandomBot()],
      rng: mulberry32(1),
    });
    for (const player of game.state.players) {
      expect(player.cash).toBe(1500);
    }
    for (const record of Object.values(game.state.ownership)) {
      expect(record.ownerId).toBeNull();
    }
  });
});
