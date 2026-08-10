import { describe, expect, it } from "vitest";
import { mulberry32 } from "../dice.js";
import { baseState } from "../testFixtures.js";
import { createCoachedGenome } from "./coaching.js";
import { encodePropertyFeatures, PROPERTY_SCORE_INPUT_COUNT, PROPERTY_SCORE_OUTPUT_COUNT, scoreProperty } from "./encoding.js";
import { evaluate } from "./genome.js";

const MEDITERRANEAN = 1; // price 60

describe("createCoachedGenome", () => {
  it("produces a genome evaluate() can run, with the expected topology", () => {
    const genome = createCoachedGenome(PROPERTY_SCORE_INPUT_COUNT, PROPERTY_SCORE_OUTPUT_COUNT, mulberry32(1));
    expect(genome.nodes).toHaveLength(PROPERTY_SCORE_INPUT_COUNT + PROPERTY_SCORE_OUTPUT_COUNT);
    expect(genome.connections).toHaveLength(PROPERTY_SCORE_INPUT_COUNT * PROPERTY_SCORE_OUTPUT_COUNT);
    const output = evaluate(genome, new Array(PROPERTY_SCORE_INPUT_COUNT).fill(0));
    expect(output).toHaveLength(PROPERTY_SCORE_OUTPUT_COUNT);
  });

  it("leans toward buying an easily affordable, group-progressing property, on average across seeds", () => {
    const state = baseState();
    state.players[0].cash = 1500;
    state.ownership[3] = { ownerId: "p0", houses: 0, hotel: false, mortgaged: false }; // owns Baltic already
    // Mediterranean (price 60) completes the brown group and costs almost nothing relative to cash.
    const inputs = encodePropertyFeatures(state, "p0", MEDITERRANEAN);

    let total = 0;
    const trials = 40;
    for (let seed = 1; seed <= trials; seed++) {
      const genome = createCoachedGenome(PROPERTY_SCORE_INPUT_COUNT, PROPERTY_SCORE_OUTPUT_COUNT, mulberry32(seed));
      total += evaluate(genome, inputs)[0];
    }
    expect(total / trials).toBeGreaterThan(0);
  });

  it("leans away from a purchase that would eat deeply into cash on hand, on average across seeds", () => {
    const state = baseState();
    state.players[0].cash = 420; // Boardwalk (price 400) would leave almost nothing
    const inputs = encodePropertyFeatures(state, "p0", 39);

    let total = 0;
    const trials = 40;
    for (let seed = 1; seed <= trials; seed++) {
      const genome = createCoachedGenome(PROPERTY_SCORE_INPUT_COUNT, PROPERTY_SCORE_OUTPUT_COUNT, mulberry32(seed));
      total += evaluate(genome, inputs)[0];
    }
    expect(total / trials).toBeLessThan(0);
  });

  it("still varies genome to genome (jitter keeps generation 0 diverse)", () => {
    const state = baseState();
    const genomeA = createCoachedGenome(PROPERTY_SCORE_INPUT_COUNT, PROPERTY_SCORE_OUTPUT_COUNT, mulberry32(1));
    const genomeB = createCoachedGenome(PROPERTY_SCORE_INPUT_COUNT, PROPERTY_SCORE_OUTPUT_COUNT, mulberry32(2));
    const scoreA = scoreProperty(genomeA, state, "p0", MEDITERRANEAN);
    const scoreB = scoreProperty(genomeB, state, "p0", MEDITERRANEAN);
    expect(scoreA).not.toBe(scoreB);
  });
});
