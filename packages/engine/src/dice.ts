import type { DiceRoll } from "./types.js";

export type Rng = () => number; // returns [0, 1)

export function rollDice(rng: Rng = Math.random): DiceRoll {
  const d1 = Math.floor(rng() * 6) + 1;
  const d2 = Math.floor(rng() * 6) + 1;
  return { d1, d2, total: d1 + d2, isDouble: d1 === d2 };
}
