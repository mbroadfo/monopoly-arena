import { describe, expect, it } from "vitest";
import type { TradeOffer } from "../types.js";
import { baseState } from "../testFixtures.js";
import { createRandomBot } from "./random.js";

function owned(ownerId: string, overrides: { houses?: number; hotel?: boolean; mortgaged?: boolean } = {}) {
  return { ownerId, houses: overrides.houses ?? 0, hotel: overrides.hotel ?? false, mortgaged: overrides.mortgaged ?? false };
}

const MEDITERRANEAN = 1; // brown group with Baltic, price 60
const BALTIC = 3; // price 60
const BOARDWALK = 39; // dark blue group with Park Place, price 400

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

describe("createRandomBot evaluateTrade", () => {
  it("declines a lopsided offer with no monopoly upside — a clear face-value net loss", () => {
    const bot = createRandomBot();
    const state = baseState();
    state.players[0].cash = 1500;
    state.ownership[BOARDWALK] = owned("p0");

    // Offering Vermont Ave ($100) for Boardwalk ($400) — no monopoly completion for anyone here.
    const offer = baseOffer({ offeredProperties: [8], requestedProperties: [BOARDWALK] });
    expect(bot.evaluateTrade(state, "p0", offer)).toBe(false);
  });

  it("recognizes when the offered property would complete its own monopoly, even if face value looks lopsided", () => {
    const bot = createRandomBot();
    const state = baseState();
    state.players[0].cash = 1500;
    state.ownership[MEDITERRANEAN] = owned("p0"); // missing only Baltic to complete brown
    state.ownership[BALTIC] = owned("p1"); // proposer currently holds the missing piece

    // $80 cash for Baltic ($60 face price) looks like a bad deal by face value alone, but Baltic
    // completes this bot's own brown monopoly — worth far more than its sticker price (1.5x here,
    // $90, clears the $80 ask; without that recognition it would decline a genuinely great deal).
    const offer = baseOffer({ offeredProperties: [BALTIC], requestedCash: 80 });
    expect(bot.evaluateTrade(state, "p0", offer)).toBe(true);
  });

  it("accepts a more lopsided deal the further behind the leader it is", () => {
    const bot = createRandomBot();
    const state = baseState();
    state.ownership[BOARDWALK] = owned("p0");
    state.players[0].cash = 100; // net worth 100 + Boardwalk's $400 = 500
    state.players[1].cash = 2000; // leader, no properties -> desperation (2000-500)/2000 = 0.75

    // Selling Boardwalk ($400) for only $300 cash is a real loss at face value, but within the
    // desperation discount (up to 40% off at full desperation; 30% off at 0.75 desperation here).
    const offer = baseOffer({ offeredCash: 300, requestedProperties: [BOARDWALK] });
    expect(bot.evaluateTrade(state, "p0", offer)).toBe(true);
  });
});
