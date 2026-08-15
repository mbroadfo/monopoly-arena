import { describe, expect, it } from "vitest";
import { computeFitnessContribution, trainNeat } from "./train.js";

describe("computeFitnessContribution", () => {
  it("adds the win bonus only when won is true", () => {
    const lost = computeFitnessContribution(1000, 0, false);
    const won = computeFitnessContribution(1000, 0, true);
    expect(won - lost).toBe(2000); // WIN_BONUS
  });

  it("subtracts a real, meaningful penalty per finance action", () => {
    const clean = computeFitnessContribution(1000, 0, false);
    const churned = computeFitnessContribution(1000, 50, false);
    expect(clean - churned).toBe(500); // 50 actions * FINANCE_CHURN_PENALTY (10)
  });

  it("matches net worth alone when there's no win and no finance activity", () => {
    expect(computeFitnessContribution(1234, 0, false)).toBe(1234);
  });
});

describe("trainNeat", () => {
  it(
    "runs a tiny population/generation smoke test without throwing, recording fitness per generation",
    () => {
      const { champion, history } = trainNeat({
        population: 4,
        generations: 2,
        gamesPerGenome: 1,
        seed: 1,
        maxTurnsPerGame: 200, // a full ~1000-turn cap isn't needed just to prove the machinery runs
      });

      expect(history).toHaveLength(2);
      for (const generation of history) {
        expect(Number.isFinite(generation.bestFitness)).toBe(true);
        expect(Number.isFinite(generation.averageFitness)).toBe(true);
        expect(generation.speciesCount).toBeGreaterThan(0);
      }
      expect(champion.nodes.length).toBeGreaterThan(0);
      expect(champion.connections.length).toBeGreaterThan(0);
    },
    60_000,
  );

  it(
    "runs with selfPlay enabled without throwing, producing a champion",
    () => {
      const { champion, history } = trainNeat({
        population: 4,
        generations: 3, // needs at least 2 to exercise "play against last generation's champion"
        gamesPerGenome: 1,
        seed: 1,
        maxTurnsPerGame: 200,
        selfPlay: true,
      });

      expect(history).toHaveLength(3);
      for (const generation of history) {
        expect(Number.isFinite(generation.bestFitness)).toBe(true);
        expect(Number.isFinite(generation.averageFitness)).toBe(true);
      }
      expect(champion.nodes.length).toBeGreaterThan(0);
    },
    60_000,
  );
});
