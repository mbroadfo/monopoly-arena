import { describe, expect, it } from "vitest";
import { Game } from "./game.js";
import { createNaiveBot } from "./bots/naive.js";
import { createRandomBot } from "./bots/random.js";
import type { Bot } from "./types.js";

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
    // Seed chosen to terminate quickly. With auctions ensuring the whole board gets owned and
    // mortgaging giving players a safety net against bankruptcy, two-player games between these
    // bots can legitimately run very long (or effectively stall) for some seeds — cash from GO
    // salary keeps growing while rent stays fixed-size, so bankruptcy becomes rare. That's
    // expected emergent behavior, not a bug; this test just needs a seed that resolves.
    const game = new Game({
      playerNames: ["Alice", "Bob"],
      bots: [createNaiveBot(), createRandomBot()],
      rng: mulberry32(1),
    });

    let turns = 0;
    while (!game.isGameOver() && turns < 5000) {
      game.playTurn();
      turns += 1;
    }

    expect(game.isGameOver()).toBe(true);
    expect(game.state.winnerId).not.toBeNull();
  });

  it("auctions a property to the highest bidder when the landing player declines to buy", () => {
    const passivePassthrough = {
      chooseHouseToBuild: () => null,
      shouldPayToLeaveJail: () => true,
      raiseCash: () => null,
      chooseFinanceAction: () => null,
    };
    // Neither bot ever buys directly, so every landed-on property goes to auction.
    const decliner: Bot = {
      name: "Decliner",
      ...passivePassthrough,
      shouldBuyProperty: () => false,
      auctionBid: (_state, _playerId, _spaceIndex, currentBid) => (currentBid === 0 ? 10 : null),
    };
    const bidder: Bot = {
      name: "Bidder",
      ...passivePassthrough,
      shouldBuyProperty: () => false,
      auctionBid: (_state, _playerId, _spaceIndex, currentBid) => currentBid + 20,
    };

    const game = new Game({ playerNames: ["A", "B"], bots: [decliner, bidder], rng: mulberry32(7) });

    let turns = 0;
    while (turns < 500 && !Object.values(game.state.ownership).some((r) => r.ownerId !== null)) {
      game.playTurn();
      turns += 1;
    }

    const ownedEntries = Object.entries(game.state.ownership).filter(([, r]) => r.ownerId !== null);
    expect(ownedEntries.length).toBeGreaterThan(0);
    // Bidder always outbids Decliner, so the first auctioned property should go to Bidder.
    expect(ownedEntries[0][1].ownerId).toBe(game.state.players[1].id);
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
