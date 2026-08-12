import { describe, expect, it } from "vitest";
import {
  DECISION_INPUT_COUNT,
  DECISION_OUTPUT_COUNT,
  OUTPUT_JAIL,
  OUTPUT_MORTGAGE,
  OUTPUT_PROPERTY,
  OUTPUT_SELL_HOUSE,
  OUTPUT_UNMORTGAGE,
} from "../neat/encoding.js";
import type { Genome } from "../neat/types.js";
import { baseState } from "../testFixtures.js";
import { createNeatBot } from "./neatBot.js";

const MEDITERRANEAN = 1; // price 60, houseCost 50
const BALTIC = 3; // brown group with Mediterranean

function owned(ownerId: string, overrides: { houses?: number; hotel?: boolean; mortgaged?: boolean } = {}) {
  return { ownerId, houses: overrides.houses ?? 0, hotel: overrides.hotel ?? false, mortgaged: overrides.mortgaged ?? false };
}

/** A genome with exactly one live connection (inputIndex -> outputIndex) — isolates a single
 * output head's behavior from a single feature, matching encoding.test.ts's own style. */
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

// hasCandidate (index 20) is 1 for every candidate-bearing decision (buy/build/mortgage/
// unmortgage/sell-house) and 0 for jail — a convenient single input to drive any one head
// positive or negative regardless of board state specifics.
const HAS_CANDIDATE_INDEX = 20;
const OWN_CASH_INDEX = 0;

describe("createNeatBot", () => {
  describe("shouldPayToLeaveJail", () => {
    it("pays when the jail head scores positive", () => {
      const bot = createNeatBot(genomeWithWeight(OUTPUT_JAIL, OWN_CASH_INDEX, 5));
      const state = baseState();
      state.players[0].cash = 1500;
      expect(bot.shouldPayToLeaveJail(state, "p0")).toBe(true);
    });

    it("stays in jail when the jail head scores non-positive", () => {
      const bot = createNeatBot(genomeWithWeight(OUTPUT_JAIL, OWN_CASH_INDEX, -5));
      const state = baseState();
      state.players[0].cash = 1500;
      expect(bot.shouldPayToLeaveJail(state, "p0")).toBe(false);
    });
  });

  describe("raiseCash", () => {
    it("returns null when nothing is mortgageable", () => {
      const bot = createNeatBot(genomeWithWeight(OUTPUT_MORTGAGE, HAS_CANDIDATE_INDEX, 5));
      const state = baseState();
      expect(bot.raiseCash(state, "p0", 100)).toBeNull();
    });

    it("picks the highest-scoring eligible property rather than refusing when candidates exist", () => {
      // Positive weight on price (index 12) — the mortgage head prefers the pricier candidate.
      const bot = createNeatBot(genomeWithWeight(OUTPUT_MORTGAGE, 12, 1));
      const state = baseState();
      state.ownership[MEDITERRANEAN] = owned("p0"); // price 60
      state.ownership[BALTIC] = owned("p0"); // price 60, same group — tie broken by first-seen since equal price
      state.ownership[39] = owned("p0"); // Boardwalk, price 400 — should win
      expect(bot.raiseCash(state, "p0", 100)).toBe(39);
    });
  });

  describe("chooseFinanceAction", () => {
    it("returns null when nothing scores positive", () => {
      const bot = createNeatBot(genomeWithWeight(OUTPUT_MORTGAGE, HAS_CANDIDATE_INDEX, -5));
      const state = baseState();
      state.ownership[MEDITERRANEAN] = owned("p0");
      expect(bot.chooseFinanceAction(state, "p0")).toBeNull();
    });

    it("proposes mortgaging when the mortgage head is the only one scoring positive", () => {
      const bot = createNeatBot(genomeWithWeight(OUTPUT_MORTGAGE, HAS_CANDIDATE_INDEX, 5));
      const state = baseState();
      state.ownership[MEDITERRANEAN] = owned("p0");
      expect(bot.chooseFinanceAction(state, "p0")).toEqual({ action: "mortgage", spaceIndex: MEDITERRANEAN });
    });

    it("declines to act on a property the mortgage and unmortgage heads contradict each other about", () => {
      // Both heads confidently positive for the same property — the exact genome shape that used
      // to produce endless mortgage/unmortgage churn (hundreds of cycles per game, each paying the
      // 10% unmortgage interest for nothing). The self-consistency guard must leave it alone.
      const nodes: Genome["nodes"] = [
        ...Array.from({ length: DECISION_INPUT_COUNT }, (_, i) => ({ id: i, kind: "input" as const })),
        ...Array.from({ length: DECISION_OUTPUT_COUNT }, (_, o) => ({ id: DECISION_INPUT_COUNT + o, kind: "output" as const })),
      ];
      const contradictory: Genome = {
        nodes,
        connections: [
          { innovation: 0, from: HAS_CANDIDATE_INDEX, to: DECISION_INPUT_COUNT + OUTPUT_MORTGAGE, weight: 5, enabled: true },
          { innovation: 1, from: HAS_CANDIDATE_INDEX, to: DECISION_INPUT_COUNT + OUTPUT_UNMORTGAGE, weight: 5, enabled: true },
        ],
      };
      const bot = createNeatBot(contradictory);
      const state = baseState();
      state.ownership[MEDITERRANEAN] = owned("p0");
      expect(bot.chooseFinanceAction(state, "p0")).toBeNull();

      state.ownership[MEDITERRANEAN] = owned("p0", { mortgaged: true });
      expect(bot.chooseFinanceAction(state, "p0")).toBeNull();
    });

    it("proposes unmortgaging when the unmortgage head is the only one scoring positive", () => {
      const bot = createNeatBot(genomeWithWeight(OUTPUT_UNMORTGAGE, HAS_CANDIDATE_INDEX, 5));
      const state = baseState();
      state.players[0].cash = 1500;
      state.ownership[MEDITERRANEAN] = owned("p0", { mortgaged: true });
      expect(bot.chooseFinanceAction(state, "p0")).toEqual({ action: "unmortgage", spaceIndex: MEDITERRANEAN });
    });

    it("proposes selling a house when the sell-house head is the only one scoring positive", () => {
      const bot = createNeatBot(genomeWithWeight(OUTPUT_SELL_HOUSE, HAS_CANDIDATE_INDEX, 5));
      const state = baseState();
      state.ownership[MEDITERRANEAN] = owned("p0", { houses: 1 });
      state.ownership[BALTIC] = owned("p0", { houses: 1 });
      expect(bot.chooseFinanceAction(state, "p0")).toEqual({ action: "sell-house", spaceIndex: MEDITERRANEAN });
    });
  });

  describe("shouldBuyProperty / auctionBid / chooseHouseToBuild", () => {
    it("buys when the property head scores positive", () => {
      const bot = createNeatBot(genomeWithWeight(OUTPUT_PROPERTY, HAS_CANDIDATE_INDEX, 5));
      const state = baseState();
      state.players[0].cash = 1500;
      expect(bot.shouldBuyProperty(state, "p0", MEDITERRANEAN)).toBe(true);
    });

    it("declines when the property head scores non-positive", () => {
      const bot = createNeatBot(genomeWithWeight(OUTPUT_PROPERTY, HAS_CANDIDATE_INDEX, -5));
      const state = baseState();
      state.players[0].cash = 1500;
      expect(bot.shouldBuyProperty(state, "p0", MEDITERRANEAN)).toBe(false);
    });

    it("builds on an owned monopoly when the property head scores positive and cash is well above reserve", () => {
      const bot = createNeatBot(genomeWithWeight(OUTPUT_PROPERTY, HAS_CANDIDATE_INDEX, 5));
      const state = baseState();
      state.players[0].cash = 1500;
      state.ownership[MEDITERRANEAN] = owned("p0");
      state.ownership[BALTIC] = owned("p0");
      expect(bot.chooseHouseToBuild(state, "p0")).not.toBeNull();
    });
  });
});
