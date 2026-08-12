import { describe, expect, it } from "vitest";
import { baseState } from "../testFixtures.js";
import {
  DECISION_INPUT_COUNT,
  DECISION_OUTPUT_COUNT,
  encodeDecisionFeatures,
  OUTPUT_JAIL,
  OUTPUT_MORTGAGE,
  OUTPUT_PROPERTY,
  OUTPUT_SELL_HOUSE,
  OUTPUT_UNMORTGAGE,
  scoreJail,
  scoreMortgage,
  scoreProperty,
  scoreSellHouse,
  scoreUnmortgage,
  sellableCandidates,
} from "./encoding.js";
import type { Genome } from "./types.js";

const MEDITERRANEAN = 1; // brown, price 60, rent [2,10,30,90,160,250], group size 2
const BOARDWALK = 39; // darkblue, price 400
const READING_RAILROAD = 5;
const PENNSYLVANIA_RAILROAD = 15;
const B_AND_O_RAILROAD = 25;

function player(id: string, overrides: Partial<{ cash: number; bankrupt: boolean; inJail: boolean; jailTurns: number }> = {}) {
  return {
    id,
    name: id,
    cash: overrides.cash ?? 1500,
    position: 0,
    inJail: overrides.inJail ?? false,
    jailTurns: overrides.jailTurns ?? 0,
    bankrupt: overrides.bankrupt ?? false,
    getOutOfJailFreeCards: 0,
  };
}

describe("encodeDecisionFeatures", () => {
  it("returns exactly DECISION_INPUT_COUNT features for a candidate space", () => {
    const state = baseState();
    expect(encodeDecisionFeatures(state, "p0", MEDITERRANEAN)).toHaveLength(DECISION_INPUT_COUNT);
    expect(DECISION_INPUT_COUNT).toBe(21);
  });

  it("returns the same length with a zeroed candidate block when there's no candidate (jail)", () => {
    const state = baseState();
    const features = encodeDecisionFeatures(state, "p0", null);
    expect(features).toHaveLength(DECISION_INPUT_COUNT);
    expect(features.slice(12)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]); // candidate block + hasCandidate all zero
  });

  it("flags hasCandidate (index 20) only when a real candidate is given", () => {
    const state = baseState();
    expect(encodeDecisionFeatures(state, "p0", MEDITERRANEAN)[20]).toBe(1);
    expect(encodeDecisionFeatures(state, "p0", null)[20]).toBe(0);
  });

  it("computes the affordability-margin feature (19) as (cash - price) / 1500", () => {
    const state = baseState();
    state.players[0].cash = 1000;
    const features = encodeDecisionFeatures(state, "p0", MEDITERRANEAN); // price 60
    expect(features[19]).toBeCloseTo((1000 - 60) / 1500, 10);
  });

  it("uses the space's base rent, normalized, for color properties (index 16)", () => {
    const state = baseState();
    const features = encodeDecisionFeatures(state, "p0", MEDITERRANEAN);
    expect(features[16]).toBeCloseTo(2 / 250, 10); // Mediterranean's base rent is 2
  });

  it("projects railroad rent from actual ownership count, not a flat placeholder (index 16)", () => {
    const state = baseState();
    // No railroads owned yet — this would be the 1st: 25 * 2^0 = 25.
    expect(encodeDecisionFeatures(state, "p0", READING_RAILROAD)[16]).toBeCloseTo(25 / 250, 10);

    // Owns 2 already; a 3rd candidate railroad should reflect 25 * 2^2 = 100, not the flat 25.
    state.ownership[READING_RAILROAD] = { ownerId: "p0", houses: 0, hotel: false, mortgaged: false };
    state.ownership[PENNSYLVANIA_RAILROAD] = { ownerId: "p0", houses: 0, hotel: false, mortgaged: false };
    expect(encodeDecisionFeatures(state, "p0", B_AND_O_RAILROAD)[16]).toBeCloseTo(100 / 250, 10);
  });

  it("reflects current improvement level (houses/hotel) of the candidate space (index 17)", () => {
    const state = baseState();
    state.ownership[BOARDWALK] = { ownerId: "p0", houses: 3, hotel: false, mortgaged: false };
    expect(encodeDecisionFeatures(state, "p0", BOARDWALK)[17]).toBeCloseTo(3 / 5, 10);

    state.ownership[BOARDWALK] = { ownerId: "p0", houses: 0, hotel: true, mortgaged: false };
    expect(encodeDecisionFeatures(state, "p0", BOARDWALK)[17]).toBeCloseTo(5 / 5, 10);
  });

  it("flags whether the candidate space is currently mortgaged (index 18)", () => {
    const state = baseState();
    state.ownership[MEDITERRANEAN].mortgaged = true;
    expect(encodeDecisionFeatures(state, "p0", MEDITERRANEAN)[18]).toBe(1);
  });

  it("tracks the leading opponent's monopoly count, not just the first opponent's (index 4)", () => {
    const state = baseState({ players: [player("p0"), player("p1"), player("p2")] });
    // p2 owns the entire brown group (Mediterranean + Baltic).
    state.ownership[1] = { ownerId: "p2", houses: 0, hotel: false, mortgaged: false };
    state.ownership[3] = { ownerId: "p2", houses: 0, hotel: false, mortgaged: false };
    const features = encodeDecisionFeatures(state, "p0", 6); // Oriental Ave, an uninvolved candidate space
    expect(features[4]).toBeCloseTo(1 / 8, 10);
  });

  it("computes the active-player fraction, excluding bankrupt players (index 5)", () => {
    const state = baseState({ players: [player("p0"), player("p1", { bankrupt: true, cash: 0 })] });
    expect(encodeDecisionFeatures(state, "p0", MEDITERRANEAN)[5]).toBeCloseTo(0.5, 10);
  });

  it("reflects house/hotel scarcity from the bank (indices 7, 8)", () => {
    const state = baseState({ housesRemaining: 8, hotelsRemaining: 2 });
    const features = encodeDecisionFeatures(state, "p0", MEDITERRANEAN);
    expect(features[7]).toBeCloseTo(8 / 32, 10);
    expect(features[8]).toBeCloseTo(2 / 12, 10);
  });

  it("computes the worst-case opponent rent threat (index 9)", () => {
    const state = baseState({ players: [player("p0"), player("p1")] });
    state.ownership[BOARDWALK] = { ownerId: "p1", houses: 0, hotel: false, mortgaged: false }; // base rent 50
    expect(encodeDecisionFeatures(state, "p0", MEDITERRANEAN)[9]).toBeCloseTo(50 / 2000, 10);
  });

  it("reflects turns already spent in jail, 0 when not in jail (index 10)", () => {
    const state = baseState();
    expect(encodeDecisionFeatures(state, "p0", null)[10]).toBe(0);

    state.players[0].inJail = true;
    state.players[0].jailTurns = 2;
    expect(encodeDecisionFeatures(state, "p0", null)[10]).toBeCloseTo(2 / 3, 10);
  });

  it("counts unowned properties remaining on the board (index 11)", () => {
    const state = baseState();
    const totalOwnable = Object.keys(state.ownership).length;
    expect(encodeDecisionFeatures(state, "p0", null)[11]).toBeCloseTo(totalOwnable / 28, 10);

    state.ownership[MEDITERRANEAN] = { ownerId: "p1", houses: 0, hotel: false, mortgaged: false };
    expect(encodeDecisionFeatures(state, "p0", null)[11]).toBeCloseTo((totalOwnable - 1) / 28, 10);
  });
});

/** A genome with exactly one live connection (inputIndex -> outputIndex), everything else absent
 * — isolates a single output head's reading from a single feature, matching genome.test.ts's own
 * hand-built-genome style. */
function genomeWithWeight(outputIndex: number, inputIndex: number, weight: number): Genome {
  const nodes: Genome["nodes"] = [
    ...Array.from({ length: DECISION_INPUT_COUNT }, (_, i) => ({ id: i, kind: "input" as const })),
    ...Array.from({ length: DECISION_OUTPUT_COUNT }, (_, o) => ({ id: DECISION_INPUT_COUNT + o, kind: "output" as const })),
  ];
  return {
    nodes,
    connections: [{ innovation: 0, from: inputIndex, to: DECISION_INPUT_COUNT + outputIndex, weight, enabled: true }],
  };
}

describe("output heads", () => {
  it("scoreProperty reads the property head (index 0), unaffected by other heads' weights", () => {
    const state = baseState();
    // Weight lives on the mortgage head, not the property head — scoreProperty must read 0.
    const genome = genomeWithWeight(OUTPUT_MORTGAGE, 0, 5);
    expect(scoreProperty(genomeWithWeight(OUTPUT_PROPERTY, 12, 5), state, "p0", MEDITERRANEAN)).not.toBe(0);
    expect(scoreProperty(genome, state, "p0", MEDITERRANEAN)).toBe(0);
  });

  it("scoreJail reads the jail head from the candidate-less feature vector", () => {
    const state = baseState();
    state.players[0].cash = 1500;
    // Positive weight on own cash (index 0) — plenty of cash should score positive.
    const genome = genomeWithWeight(OUTPUT_JAIL, 0, 2);
    expect(scoreJail(genome, state, "p0")).toBeGreaterThan(0);
  });

  it("scoreMortgage/scoreUnmortgage/scoreSellHouse each read their own head", () => {
    const state = baseState();
    state.ownership[MEDITERRANEAN] = { ownerId: "p0", houses: 0, hotel: false, mortgaged: false };
    // Positive weight on hasCandidate (index 20) for each head in turn.
    expect(scoreMortgage(genomeWithWeight(OUTPUT_MORTGAGE, 20, 3), state, "p0", MEDITERRANEAN)).toBeGreaterThan(0);
    expect(scoreUnmortgage(genomeWithWeight(OUTPUT_UNMORTGAGE, 20, 3), state, "p0", MEDITERRANEAN)).toBeGreaterThan(0);
    expect(scoreSellHouse(genomeWithWeight(OUTPUT_SELL_HOUSE, 20, 3), state, "p0", MEDITERRANEAN)).toBeGreaterThan(0);
  });
});

describe("sellableCandidates", () => {
  it("is empty when nothing is developed", () => {
    const state = baseState();
    state.ownership[MEDITERRANEAN] = { ownerId: "p0", houses: 0, hotel: false, mortgaged: false };
    expect(sellableCandidates(state, "p0")).toEqual([]);
  });

  it("only offers the group's most-developed member(s), the reverse of the even-building rule", () => {
    const state = baseState();
    state.ownership[1] = { ownerId: "p0", houses: 2, hotel: false, mortgaged: false }; // Mediterranean
    state.ownership[3] = { ownerId: "p0", houses: 1, hotel: false, mortgaged: false }; // Baltic, behind
    expect(sellableCandidates(state, "p0")).toEqual([1]);
  });

  it("withholds a hotel-to-houses conversion when the bank doesn't have 4 houses to return", () => {
    const state = baseState({ housesRemaining: 2 });
    state.ownership[1] = { ownerId: "p0", houses: 0, hotel: true, mortgaged: false };
    state.ownership[3] = { ownerId: "p0", houses: 0, hotel: true, mortgaged: false };
    expect(sellableCandidates(state, "p0")).toEqual([]);
  });

  it("only includes properties this player actually owns", () => {
    const state = baseState();
    state.ownership[1] = { ownerId: "p1", houses: 3, hotel: false, mortgaged: false };
    state.ownership[3] = { ownerId: "p0", houses: 0, hotel: false, mortgaged: false };
    expect(sellableCandidates(state, "p0")).toEqual([]);
  });
});
