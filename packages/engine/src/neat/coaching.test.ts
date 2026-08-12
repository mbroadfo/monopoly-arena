import { describe, expect, it } from "vitest";
import { mulberry32 } from "../dice.js";
import { baseState } from "../testFixtures.js";
import { createCoachedGenome } from "./coaching.js";
import {
  DECISION_INPUT_COUNT,
  DECISION_OUTPUT_COUNT,
  encodeDecisionFeatures,
  OUTPUT_JAIL,
  OUTPUT_MORTGAGE,
  OUTPUT_PROPERTY,
  OUTPUT_SELL_HOUSE,
  OUTPUT_UNMORTGAGE,
  scoreProperty,
} from "./encoding.js";
import { evaluate } from "./genome.js";

const MEDITERRANEAN = 1; // price 60
const BOARDWALK = 39; // price 400
const RAILROAD = 5;
const TRIALS = 40;

/** Average output at `outputIndex` across `TRIALS` independently-seeded coached genomes, for the
 * given input vector — smooths out per-genome jitter to check the underlying seeded bias's sign. */
function averageOutput(inputs: number[], outputIndex: number): number {
  let total = 0;
  for (let seed = 1; seed <= TRIALS; seed++) {
    const genome = createCoachedGenome(DECISION_INPUT_COUNT, DECISION_OUTPUT_COUNT, mulberry32(seed));
    total += evaluate(genome, inputs)[outputIndex];
  }
  return total / TRIALS;
}

describe("createCoachedGenome", () => {
  it("produces a genome evaluate() can run, with the expected topology", () => {
    const genome = createCoachedGenome(DECISION_INPUT_COUNT, DECISION_OUTPUT_COUNT, mulberry32(1));
    expect(genome.nodes).toHaveLength(DECISION_INPUT_COUNT + DECISION_OUTPUT_COUNT);
    expect(genome.connections).toHaveLength(DECISION_INPUT_COUNT * DECISION_OUTPUT_COUNT);
    const output = evaluate(genome, new Array(DECISION_INPUT_COUNT).fill(0));
    expect(output).toHaveLength(DECISION_OUTPUT_COUNT);
  });

  it("still varies genome to genome (jitter keeps generation 0 diverse)", () => {
    const state = baseState();
    const genomeA = createCoachedGenome(DECISION_INPUT_COUNT, DECISION_OUTPUT_COUNT, mulberry32(1));
    const genomeB = createCoachedGenome(DECISION_INPUT_COUNT, DECISION_OUTPUT_COUNT, mulberry32(2));
    expect(scoreProperty(genomeA, state, "p0", MEDITERRANEAN)).not.toBe(scoreProperty(genomeB, state, "p0", MEDITERRANEAN));
  });

  describe("property head", () => {
    it("leans toward buying an easily affordable, group-progressing property, on average across seeds", () => {
      const state = baseState();
      state.players[0].cash = 1500;
      state.ownership[3] = { ownerId: "p0", houses: 0, hotel: false, mortgaged: false }; // owns Baltic already
      const inputs = encodeDecisionFeatures(state, "p0", MEDITERRANEAN); // completes the brown group, cheap
      expect(averageOutput(inputs, OUTPUT_PROPERTY)).toBeGreaterThan(0);
    });

    it("leans away from a purchase that would eat deeply into cash on hand, on average across seeds", () => {
      const state = baseState();
      state.players[0].cash = 420; // Boardwalk (price 400) would leave almost nothing
      const inputs = encodeDecisionFeatures(state, "p0", BOARDWALK);
      expect(averageOutput(inputs, OUTPUT_PROPERTY)).toBeLessThan(0);
    });
  });

  describe("jail head", () => {
    it("leans toward paying when cash is healthy and no opponent threat exists", () => {
      const state = baseState();
      state.players[0].cash = 1500;
      const inputs = encodeDecisionFeatures(state, "p0", null);
      expect(averageOutput(inputs, OUTPUT_JAIL)).toBeGreaterThan(0);
    });

    it("leans away from paying when an opponent's holdings look dangerous", () => {
      const safeState = baseState();
      safeState.players[0].cash = 1500;

      const dangerousState = baseState();
      dangerousState.players[0].cash = 1500;
      dangerousState.ownership[BOARDWALK] = { ownerId: "p1", houses: 0, hotel: true, mortgaged: false }; // top-tier rent threat

      const safe = averageOutput(encodeDecisionFeatures(safeState, "p0", null), OUTPUT_JAIL);
      const dangerous = averageOutput(encodeDecisionFeatures(dangerousState, "p0", null), OUTPUT_JAIL);
      expect(dangerous).toBeLessThan(safe);
    });
  });

  describe("mortgage head", () => {
    it("leans away from mortgaging a railroad/utility versus an equally-placed color property", () => {
      const state = baseState();
      const railroadInputs = encodeDecisionFeatures(state, "p0", RAILROAD);
      const colorInputs = encodeDecisionFeatures(state, "p0", MEDITERRANEAN);
      expect(averageOutput(railroadInputs, OUTPUT_MORTGAGE)).toBeLessThan(averageOutput(colorInputs, OUTPUT_MORTGAGE));
    });
  });

  describe("unmortgage head", () => {
    it("leans toward reinvesting in a property that would restore a monopoly, when affordable", () => {
      const state = baseState();
      state.players[0].cash = 1500;
      state.ownership[3] = { ownerId: "p0", houses: 0, hotel: false, mortgaged: false }; // owns Baltic already
      const inputs = encodeDecisionFeatures(state, "p0", MEDITERRANEAN);
      expect(averageOutput(inputs, OUTPUT_UNMORTGAGE)).toBeGreaterThan(0);
    });
  });

  describe("sellHouse head", () => {
    it("leans away from selling houses by default when cash is healthy (a last resort, not a first instinct)", () => {
      const state = baseState();
      state.players[0].cash = 1500;
      const inputs = encodeDecisionFeatures(state, "p0", MEDITERRANEAN);
      expect(averageOutput(inputs, OUTPUT_SELL_HOUSE)).toBeLessThan(0);
    });
  });
});
