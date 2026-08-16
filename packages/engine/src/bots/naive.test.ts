import { describe, expect, it } from "vitest";
import type { TradeOffer } from "../types.js";
import { baseState } from "../testFixtures.js";
import { createNaiveBot } from "./naive.js";

function owned(ownerId: string, overrides: { houses?: number; hotel?: boolean; mortgaged?: boolean } = {}) {
  return { ownerId, houses: overrides.houses ?? 0, hotel: overrides.hotel ?? false, mortgaged: overrides.mortgaged ?? false };
}

const MEDITERRANEAN = 1; // brown group with Baltic, price 60
const BALTIC = 3; // price 60

function baseOffer(overrides: Partial<TradeOffer> = {}): TradeOffer {
  return {
    fromPlayerId: "p1",
    toPlayerId: "p0",
    offeredProperties: [],
    offeredCash: 0,
    offeredGetOutOfJailFreeCards: 0,
    requestedProperties: [],
    requestedCash: 0,
    requestedGetOutOfJailFreeCards: 0,
    conditions: [],
    ...overrides,
  };
}

describe("createNaiveBot shouldPayToLeaveJail", () => {
  it("pays early, while most of the board is still unclaimed", () => {
    const bot = createNaiveBot();
    const state = baseState();
    state.players[0].cash = 1500;
    expect(bot.shouldPayToLeaveJail(state, "p0")).toBe(true);
  });

  it("stays in jail once the board is mostly claimed, even with cash to spare", () => {
    const bot = createNaiveBot();
    const state = baseState();
    state.players[0].cash = 1500;
    // Claim 20 of 28 ownable spaces -> 8/28 (~0.29) unowned, below the 0.5 threshold.
    const indices = Object.keys(state.ownership).map(Number);
    for (const i of indices.slice(0, 20)) state.ownership[i] = owned("p1");
    expect(bot.shouldPayToLeaveJail(state, "p0")).toBe(false);
  });
});

const ORIENTAL = 6; // light-blue group with Vermont and Connecticut
const VERMONT = 8;
const CONNECTICUT = 9;

describe("createNaiveBot proposeTrade", () => {
  it("offers a straight property swap when both sides would complete a monopoly", () => {
    const bot = createNaiveBot();
    const state = baseState();
    state.players[0].cash = 1500;
    // p0 is missing Baltic (p1 owns it) to complete the brown group.
    state.ownership[MEDITERRANEAN] = owned("p0");
    state.ownership[BALTIC] = owned("p1");
    // p1 is missing Connecticut (p0 owns it) to complete the light-blue group.
    state.ownership[ORIENTAL] = owned("p1");
    state.ownership[VERMONT] = owned("p1");
    state.ownership[CONNECTICUT] = owned("p0");

    const offer = bot.proposeTrade(state, "p0");
    expect(offer).toEqual({
      fromPlayerId: "p0",
      toPlayerId: "p1",
      offeredProperties: [CONNECTICUT],
      offeredCash: 0,
      offeredGetOutOfJailFreeCards: 0,
      requestedProperties: [BALTIC],
      requestedCash: 0,
      requestedGetOutOfJailFreeCards: 0,
      conditions: [],
    });
  });

  it("falls back to a cash offer when no mutual swap is available", () => {
    const bot = createNaiveBot();
    const state = baseState();
    state.players[0].cash = 1500;
    state.ownership[MEDITERRANEAN] = owned("p0");
    state.ownership[BALTIC] = owned("p1");

    const offer = bot.proposeTrade(state, "p0");
    expect(offer?.offeredProperties).toEqual([]);
    expect(offer?.offeredCash).toBe(90); // 1.5x Baltic's $60 price
    expect(offer?.requestedProperties).toEqual([BALTIC]);
  });

  it("sweetens its own cash offer the further behind the leader it is", () => {
    const bot = createNaiveBot();
    const state = baseState();
    state.ownership[MEDITERRANEAN] = owned("p0");
    state.ownership[BALTIC] = owned("p1");
    state.players[0].cash = 1500; // worth 1560 (cash + Mediterranean)
    state.players[1].cash = 100_000; // far ahead -> p0 is deep in desperation territory

    const offer = bot.proposeTrade(state, "p0");
    expect(offer?.offeredCash).toBeGreaterThan(90); // more than the baseline 1.5x Baltic's $60 price
  });
});

const PACIFIC = 31; // green group (this bot's default preferredGroup) with North Carolina/Pennsylvania, price 300
const NORTH_CAROLINA = 32; // price 300
const PENNSYLVANIA = 34; // price 320

describe("createNaiveBot evaluateTrade", () => {
  it("declines a face-value cash offer for a home-turf property that would complete the proposer's monopoly", () => {
    const bot = createNaiveBot();
    const state = baseState();
    state.players[0].cash = 1500;
    state.ownership[PACIFIC] = owned("p1"); // proposer already owns the other two green pieces
    state.ownership[NORTH_CAROLINA] = owned("p1");
    state.ownership[PENNSYLVANIA] = owned("p0"); // this bot owns the missing piece being requested

    const offer = baseOffer({ offeredCash: 320, requestedProperties: [PENNSYLVANIA] }); // Pennsylvania's face price
    expect(bot.evaluateTrade(state, "p0", offer)).toBe(false);
  });

  it("accepts the same trade once the cash covers the monopoly-completion premium", () => {
    const bot = createNaiveBot();
    const state = baseState();
    state.players[0].cash = 1500;
    state.ownership[PACIFIC] = owned("p1");
    state.ownership[NORTH_CAROLINA] = owned("p1");
    state.ownership[PENNSYLVANIA] = owned("p0");

    const offer = baseOffer({ offeredCash: 480, requestedProperties: [PENNSYLVANIA] }); // 1.5x face price
    expect(bot.evaluateTrade(state, "p0", offer)).toBe(true);
  });

  it("accepts a face-value cash offer for a property that doesn't complete anyone's monopoly", () => {
    const bot = createNaiveBot();
    const state = baseState();
    state.players[0].cash = 1500;
    state.ownership[BALTIC] = owned("p0"); // proposer owns nothing else in the brown group

    const offer = baseOffer({ offeredCash: 60, requestedProperties: [BALTIC] });
    expect(bot.evaluateTrade(state, "p0", offer)).toBe(true);
  });

  it("accepts a face-value cash offer for a monopoly-completing property outside its home turf", () => {
    // Only defends its preferred (green) group hard — a group it was never going to build on
    // anyway goes at face value, a deliberate "sub-optimal" trade rather than holding out for
    // full monopoly value on something it doesn't personally care about.
    const bot = createNaiveBot();
    const state = baseState();
    state.players[0].cash = 1500;
    state.ownership[MEDITERRANEAN] = owned("p1"); // proposer already owns the other brown piece
    state.ownership[BALTIC] = owned("p0"); // this bot owns the missing piece being requested

    const offer = baseOffer({ offeredCash: 60, requestedProperties: [BALTIC] }); // Baltic's face price
    expect(bot.evaluateTrade(state, "p0", offer)).toBe(true);
  });

  it("accepts a discounted premium for its home-turf monopoly-completing piece when far behind the leader", () => {
    const bot = createNaiveBot();
    const state = baseState();
    state.ownership[PACIFIC] = owned("p1");
    state.ownership[NORTH_CAROLINA] = owned("p1");
    state.ownership[PENNSYLVANIA] = owned("p0");
    state.players[0].cash = 0; // net worth 320 (just Pennsylvania)
    state.players[1].cash = 100_000; // far ahead -> p0 is deep in desperation territory

    // Full premium would be $480 (1.5x Pennsylvania's $320); $300 fails that bar but clears the
    // desperation-discounted one.
    const offer = baseOffer({ offeredCash: 300, requestedProperties: [PENNSYLVANIA] });
    expect(bot.evaluateTrade(state, "p0", offer)).toBe(true);
  });
});
