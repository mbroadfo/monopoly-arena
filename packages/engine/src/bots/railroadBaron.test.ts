import { describe, expect, it } from "vitest";
import type { TradeOffer } from "../types.js";
import { baseState } from "../testFixtures.js";
import { createRailroadBaronBot } from "./railroadBaron.js";

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

describe("createRailroadBaronBot shouldPayToLeaveJail", () => {
  it("still pays very early, while almost nothing on the board is owned yet", () => {
    const bot = createRailroadBaronBot();
    const state = baseState();
    state.players[0].cash = 1500;
    expect(bot.shouldPayToLeaveJail(state, "p0")).toBe(true);
  });

  it("stays in jail once any real share of the board is claimed, even with cash to spare", () => {
    const bot = createRailroadBaronBot();
    const state = baseState();
    state.players[0].cash = 1500;
    // Claim 8 of 28 ownable spaces -> 20/28 (~0.71) unowned, below the 0.75 threshold.
    const indices = Object.keys(state.ownership).map(Number);
    for (const i of indices.slice(0, 8)) state.ownership[i] = owned("p1");
    expect(bot.shouldPayToLeaveJail(state, "p0")).toBe(false);
  });
});

const READING = 5; // railroad group with Pennsylvania, B&O, Short Line
const PENNSYLVANIA = 15;
const B_AND_O = 25;
const SHORT_LINE = 35;
const ORIENTAL = 6; // light-blue group with Vermont and Connecticut
const VERMONT = 8;
const CONNECTICUT = 9;

describe("createRailroadBaronBot proposeTrade", () => {
  it("offers a straight swap of a color property for a missing railroad", () => {
    const bot = createRailroadBaronBot();
    const state = baseState();
    state.players[0].cash = 1500;
    // p0 is missing Short Line (p1 owns it) to complete the railroad group.
    state.ownership[READING] = owned("p0");
    state.ownership[PENNSYLVANIA] = owned("p0");
    state.ownership[B_AND_O] = owned("p0");
    state.ownership[SHORT_LINE] = owned("p1");
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
      requestedProperties: [SHORT_LINE],
      requestedCash: 0,
      requestedGetOutOfJailFreeCards: 0,
      conditions: [],
    });
  });
});

describe("createRailroadBaronBot evaluateTrade", () => {
  it("accepts a face-value cash offer for a color property that would complete the proposer's monopoly", () => {
    // No monopoly-completion premium for color groups at all — they were never the plan, so it
    // lets them go at face value rather than holding out for value it was never going to realize.
    const bot = createRailroadBaronBot();
    const state = baseState();
    state.players[0].cash = 1500;
    state.ownership[MEDITERRANEAN] = owned("p1");
    state.ownership[BALTIC] = owned("p0");

    const offer = baseOffer({ offeredCash: 60, requestedProperties: [BALTIC] });
    expect(bot.evaluateTrade(state, "p0", offer)).toBe(true);
  });

  it("refuses to give up a railroad/utility regardless of price", () => {
    const bot = createRailroadBaronBot();
    const state = baseState();
    state.players[0].cash = 1500;
    state.ownership[READING] = owned("p0");
    state.ownership[PENNSYLVANIA] = owned("p0");
    state.ownership[B_AND_O] = owned("p0");
    state.ownership[SHORT_LINE] = owned("p0");

    const offer = baseOffer({ offeredCash: 10_000, requestedProperties: [SHORT_LINE] });
    expect(bot.evaluateTrade(state, "p0", offer)).toBe(false);
  });
});
