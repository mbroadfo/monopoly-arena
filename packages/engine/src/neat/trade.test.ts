import { describe, expect, it } from "vitest";
import { baseState } from "../testFixtures.js";
import { DECISION_INPUT_COUNT, DECISION_OUTPUT_COUNT, OUTPUT_PROPERTY } from "./encoding.js";
import { cashPressure, generateTradeCandidates, scoreTradeCandidate } from "./trade.js";
import type { Genome } from "./types.js";

const MEDITERRANEAN = 1;
const BALTIC = 3; // brown group: [1, 3]
const ORIENTAL = 6;
const VERMONT = 8;
const CONNECTICUT = 9; // lightblue group: [6, 8, 9]
const READING_RAILROAD = 5;
const PENNSYLVANIA_RAILROAD = 15;
const BOARDWALK = 39;

function owned(ownerId: string, overrides: { houses?: number; hotel?: boolean } = {}) {
  return { ownerId, houses: overrides.houses ?? 0, hotel: overrides.hotel ?? false, mortgaged: false };
}

/** All nodes, zero connections — every scoreProperty output is exactly tanh(0) = 0, isolating the
 * cash/leverage terms of scoreTradeCandidate from any property valuation. */
function zeroGenome(): Genome {
  return {
    nodes: [
      ...Array.from({ length: DECISION_INPUT_COUNT }, (_, i) => ({ id: i, kind: "input" as const })),
      ...Array.from({ length: DECISION_OUTPUT_COUNT }, (_, o) => ({ id: DECISION_INPUT_COUNT + o, kind: "output" as const })),
    ],
    connections: [],
  };
}

describe("generateTradeCandidates", () => {
  it("proposes a property-for-property swap when both players are each missing one piece the other holds", () => {
    const state = baseState();
    // p0 is missing Baltic (owned by p1) to complete brown.
    state.ownership[MEDITERRANEAN] = owned("p0");
    state.ownership[BALTIC] = owned("p1");
    // p1 is missing Connecticut (owned by p0) to complete lightblue.
    state.ownership[ORIENTAL] = owned("p1");
    state.ownership[VERMONT] = owned("p1");
    state.ownership[CONNECTICUT] = owned("p0");

    const candidates = generateTradeCandidates(state, "p0");
    const swap = candidates.find(
      (c) => c.offeredProperties.includes(CONNECTICUT) && c.requestedProperties.includes(BALTIC) && c.offeredCash === 0,
    );
    expect(swap).toBeDefined();
    expect(swap!.toPlayerId).toBe("p1");
  });

  it("proposes cash-only offers scaled to the completed group's real value, capped by cash on hand", () => {
    const state = baseState();
    state.ownership[MEDITERRANEAN] = owned("p0");
    state.ownership[BALTIC] = owned("p1"); // price 60; brown group total value = 60 + 60 = 120
    state.players[0].cash = 100; // rules out the largest offer: 60 + 0.5*120 = 120

    const candidates = generateTradeCandidates(state, "p0");
    const cashOffers = candidates.filter((c) => c.offeredProperties.length === 0 && c.requestedProperties.includes(BALTIC));
    expect(cashOffers.some((c) => c.offeredCash === 72)).toBe(true); // 60 + 0.1*120
    expect(cashOffers.some((c) => c.offeredCash === 90)).toBe(true); // 60 + 0.25*120
    expect(cashOffers.some((c) => c.offeredCash === 120)).toBe(false); // 60 + 0.5*120, exceeds cash
  });

  it("offers a bigger cash premium for a more valuable group, not just a flat multiple of the missing piece", () => {
    // Dark blue: Park Place (350) + Boardwalk (400) = 750 total — a much richer prize than brown's
    // 120, so the premium on top of Park Place's own price should be correspondingly larger.
    const state = baseState();
    state.ownership[37] = owned("p0"); // Park Place
    state.ownership[39] = owned("p1"); // Boardwalk, price 400
    state.players[0].cash = 2000;

    const candidates = generateTradeCandidates(state, "p0");
    const cashOffers = candidates
      .filter((c) => c.offeredProperties.length === 0 && c.requestedProperties.includes(39))
      .map((c) => c.offeredCash);
    expect(Math.max(...cashOffers)).toBe(775); // 400 + 0.5*750
  });

  it("returns nothing when the player isn't one property short of any group", () => {
    const state = baseState();
    const candidates = generateTradeCandidates(state, "p0");
    expect(candidates).toEqual([]);
  });

  it("proposes cash offers for an opponent's railroad once the player owns at least one railroad", () => {
    const state = baseState();
    state.ownership[READING_RAILROAD] = owned("p0");
    state.ownership[PENNSYLVANIA_RAILROAD] = owned("p1");
    state.players[0].cash = 2000;

    const candidates = generateTradeCandidates(state, "p0");
    const railroadOffers = candidates.filter((c) => c.requestedProperties.includes(PENNSYLVANIA_RAILROAD));
    expect(railroadOffers.length).toBeGreaterThan(0);
    expect(railroadOffers.every((c) => c.toPlayerId === "p1" && c.offeredCash > 0)).toBe(true);
  });

  it("does not chase railroads it has no stake in yet (owns zero of the group)", () => {
    const state = baseState();
    state.ownership[PENNSYLVANIA_RAILROAD] = owned("p1");
    state.players[0].cash = 2000;

    const candidates = generateTradeCandidates(state, "p0");
    expect(candidates.filter((c) => c.requestedProperties.includes(PENNSYLVANIA_RAILROAD))).toEqual([]);
  });
});

describe("cashPressure", () => {
  it("is 0 when no opponent poses any rent threat", () => {
    const state = baseState();
    expect(cashPressure(state, "p0")).toBe(0);
  });

  it("approaches 1 for a nearly-broke player facing a hotel, and 0 for a comfortable one", () => {
    const state = baseState();
    state.ownership[BOARDWALK] = owned("p1", { hotel: true }); // threat: Boardwalk hotel rent $2000
    state.players[0].cash = 20;
    expect(cashPressure(state, "p0")).toBeGreaterThan(0.99);

    state.players[0].cash = 5000; // covers two worst-case landings with room to spare
    expect(cashPressure(state, "p0")).toBe(0);
  });
});

describe("scoreTradeCandidate", () => {
  // A hand-built genome that only cares about feature index 14 (group progress) on the property
  // head — isolates the effect under test from every other feature/head so the expected sign is
  // unambiguous.
  function groupProgressOnlyGenome(): Genome {
    const nodes: Genome["nodes"] = [
      ...Array.from({ length: DECISION_INPUT_COUNT }, (_, i) => ({ id: i, kind: "input" as const })),
      ...Array.from({ length: DECISION_OUTPUT_COUNT }, (_, o) => ({ id: DECISION_INPUT_COUNT + o, kind: "output" as const })),
    ];
    return {
      nodes,
      connections: [{ innovation: 0, from: 14, to: DECISION_INPUT_COUNT + OUTPUT_PROPERTY, weight: 1, enabled: true }],
    };
  }

  it("scores giving away a piece of an already-completed monopoly for a token cash sum as a bad deal (myGain < 0)", () => {
    const state = baseState();
    state.ownership[MEDITERRANEAN] = owned("p0");
    state.ownership[BALTIC] = owned("p0"); // p0 already owns the whole brown group

    const offer = {
      fromPlayerId: "p0",
      toPlayerId: "p1",
      offeredProperties: [MEDITERRANEAN],
      offeredCash: 0,
      offeredGetOutOfJailFreeCards: 0,
      requestedProperties: [],
      requestedCash: 10,
      requestedGetOutOfJailFreeCards: 0,
      conditions: [],
    };

    const score = scoreTradeCandidate(groupProgressOnlyGenome(), state, offer);
    expect(score.myGain).toBeLessThan(0);
  });

  it("is symmetric: the receiving player's counterpartyGain matches their own gain from accepting", () => {
    const state = baseState();
    state.ownership[MEDITERRANEAN] = owned("p1");
    state.ownership[BALTIC] = owned("p1"); // p1 owns the whole brown group

    // p0 proposes buying Mediterranean off p1 for a token sum — bad for p1 to accept, symmetric
    // to the case above from p1's side.
    const offer = {
      fromPlayerId: "p0",
      toPlayerId: "p1",
      offeredProperties: [],
      offeredCash: 10,
      offeredGetOutOfJailFreeCards: 0,
      requestedProperties: [MEDITERRANEAN],
      requestedCash: 0,
      requestedGetOutOfJailFreeCards: 0,
      conditions: [],
    };

    const score = scoreTradeCandidate(groupProgressOnlyGenome(), state, offer);
    expect(score.counterpartyGain).toBeLessThan(0);
  });

  it("values the same cash offer more highly to a cash-desperate counterparty than a comfortable one (leverage)", () => {
    const makeState = (counterpartyCash: number) => {
      const state = baseState();
      state.ownership[MEDITERRANEAN] = owned("p1"); // the property p0 wants to buy
      state.ownership[BOARDWALK] = owned("p0", { hotel: true }); // p0's hotel puts p1 under real rent threat
      state.players[1].cash = counterpartyCash;
      return state;
    };
    const offer = {
      fromPlayerId: "p0",
      toPlayerId: "p1",
      offeredProperties: [],
      offeredCash: 100,
      offeredGetOutOfJailFreeCards: 0,
      requestedProperties: [MEDITERRANEAN],
      requestedCash: 0,
      requestedGetOutOfJailFreeCards: 0,
      conditions: [],
    };

    // zeroGenome makes every property worth exactly 0 to everyone, so the only difference between
    // the two scores is how much the $100 is worth to the receiver — which is the leverage claim.
    const desperate = scoreTradeCandidate(zeroGenome(), makeState(20), offer);
    const comfortable = scoreTradeCandidate(zeroGenome(), makeState(5000), offer);
    expect(desperate.counterpartyGain).toBeGreaterThan(comfortable.counterpartyGain);
  });
});
