import { describe, expect, it } from "vitest";
import type { TradeOffer } from "../types.js";
import { baseState } from "../testFixtures.js";
import { createOrangeRushBot } from "./orangeRush.js";

function owned(ownerId: string, overrides: { houses?: number; hotel?: boolean; mortgaged?: boolean } = {}) {
  return { ownerId, houses: overrides.houses ?? 0, hotel: overrides.hotel ?? false, mortgaged: overrides.mortgaged ?? false };
}

const MEDITERRANEAN = 1; // brown group with Baltic, price 60 — not one of OrangeRush's priority groups
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

describe("createOrangeRushBot shouldPayToLeaveJail", () => {
  it("pays early, while most of the board is still unclaimed", () => {
    const bot = createOrangeRushBot();
    const state = baseState();
    state.players[0].cash = 1500;
    expect(bot.shouldPayToLeaveJail(state, "p0")).toBe(true);
  });

  it("stays in jail once the board is mostly claimed, even with cash to spare", () => {
    const bot = createOrangeRushBot();
    const state = baseState();
    state.players[0].cash = 1500;
    // Claim 20 of 28 ownable spaces -> 8/28 (~0.29) unowned, below the 0.3 threshold.
    const indices = Object.keys(state.ownership).map(Number);
    for (const i of indices.slice(0, 20)) state.ownership[i] = owned("p1");
    expect(bot.shouldPayToLeaveJail(state, "p0")).toBe(false);
  });
});

const ST_JAMES = 16; // orange group with Tennessee and New York
const TENNESSEE = 18;
const NEW_YORK = 19;
const ATLANTIC = 26; // yellow group with Ventnor and Marvin Gardens
const VENTNOR = 27;
const MARVIN_GARDENS = 29;

describe("createOrangeRushBot proposeTrade", () => {
  it("offers a straight swap of a non-priority property for a missing orange piece", () => {
    const bot = createOrangeRushBot();
    const state = baseState();
    state.players[0].cash = 1500;
    // p0 is missing New York (p1 owns it) to complete the orange group.
    state.ownership[ST_JAMES] = owned("p0");
    state.ownership[TENNESSEE] = owned("p0");
    state.ownership[NEW_YORK] = owned("p1");
    // p1 is missing Marvin Gardens (p0 owns it) to complete the yellow group.
    state.ownership[ATLANTIC] = owned("p1");
    state.ownership[VENTNOR] = owned("p1");
    state.ownership[MARVIN_GARDENS] = owned("p0");

    const offer = bot.proposeTrade(state, "p0");
    expect(offer).toEqual({
      fromPlayerId: "p0",
      toPlayerId: "p1",
      offeredProperties: [MARVIN_GARDENS],
      offeredCash: 0,
      offeredGetOutOfJailFreeCards: 0,
      requestedProperties: [NEW_YORK],
      requestedCash: 0,
      requestedGetOutOfJailFreeCards: 0,
      conditions: [],
    });
  });
});

describe("createOrangeRushBot evaluateTrade", () => {
  it("accepts a face-value cash offer for a non-priority property that would complete the proposer's monopoly", () => {
    // No monopoly-completion premium outside orange/red — a group it was never going to build on
    // anyway goes at face value, a deliberate "sub-optimal" trade rather than holding out.
    const bot = createOrangeRushBot();
    const state = baseState();
    state.players[0].cash = 1500;
    state.ownership[MEDITERRANEAN] = owned("p1");
    state.ownership[BALTIC] = owned("p0");

    const offer = baseOffer({ offeredCash: 60, requestedProperties: [BALTIC] });
    expect(bot.evaluateTrade(state, "p0", offer)).toBe(true);
  });

  it("refuses to give up an orange/red property regardless of price", () => {
    const bot = createOrangeRushBot();
    const state = baseState();
    state.players[0].cash = 1500;
    state.ownership[ST_JAMES] = owned("p0");
    state.ownership[TENNESSEE] = owned("p0");
    state.ownership[NEW_YORK] = owned("p0");

    const offer = baseOffer({ offeredCash: 10_000, requestedProperties: [NEW_YORK] });
    expect(bot.evaluateTrade(state, "p0", offer)).toBe(false);
  });
});
