import type { DiceRoll } from "./types.js";

export type Rng = () => number; // returns [0, 1)

export function rollDice(rng: Rng = Math.random): DiceRoll {
  const d1 = Math.floor(rng() * 6) + 1;
  const d2 = Math.floor(rng() * 6) + 1;
  return { d1, d2, total: d1 + d2, isDouble: d1 === d2 };
}

/**
 * Small deterministic seedable generator matching the `Rng` shape — used wherever reproducible
 * randomness is needed: tests, `lookahead.ts`'s paired rollout comparisons, and the batch runner's
 * per-game/per-bot seeding.
 */
export function mulberry32(seed: number): Rng {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
