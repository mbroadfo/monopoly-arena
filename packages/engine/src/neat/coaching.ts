import type { Rng } from "../dice.js";
import type { ConnectionGene, Genome, NodeGene } from "./types.js";

const JITTER_STD = 0.15;

/** Box-Muller, matching genome.ts's own `gaussianRandom` — kept as a separate copy since this
 * module is Monopoly-strategy-specific, not generic NEAT mechanics (mirrors encoding.ts's own
 * separation of concerns from genome.ts), and isn't worth coupling to a private helper for one use. */
function gaussianJitter(rng: Rng): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * JITTER_STD;
}

/**
 * Seed weights for `encoding.ts`'s 17-feature `encodePropertyFeatures` vector (indices below match
 * that function's return order) — biasing generation 0 toward roughly sane buy/bid/build judgment
 * instead of literal random weights, so evolution doesn't have to rediscover basic Monopoly
 * economics before it can improve on it. Drawn from a handful of points in
 * `docs/neat-strategy-doctrine.md` that fit today's single-candidate-scoring architecture:
 *
 * - Doctrine #1/#2 ("cash is ammunition; buy aggressively unless it creates insolvency risk") →
 *   strong positive weight on the affordability-margin feature (index 9) — the clearest "can I
 *   afford this without wrecking my position" signal available.
 * - Doctrine #3 ("monopoly completion dominates raw property count") → strong positive weight on
 *   group progress (index 6), with a supporting weight on existing monopoly count (index 2).
 * - Doctrine #9/#10 (income and blocking value) → a modest positive weight on base rent (index 10).
 * - A mild negative weight on price (index 4) keeps expensive purchases from looking automatically
 *   attractive just because "buy aggressively" otherwise dominates.
 * - A mild positive weight on the leading opponent's monopoly count (index 13) and on the
 *   candidate's own current improvement level (index 11) reflect competitive pressure and
 *   "finish developing what's already started."
 *
 * Every weight — coached or not — still gets independent random jitter, so generation 0 keeps
 * enough diversity for speciation and mutation to actually explore from; a population seeded
 * identically at every weight would defeat the point of an evolutionary population.
 */
const COACHED_WEIGHTS: Record<number, number> = {
  0: 0.2, // own cash
  2: 0.8, // monopoly count
  4: -0.3, // price
  6: 1.2, // group progress
  9: 1.5, // affordability margin (cash - price)
  10: 0.6, // base rent
  11: 0.3, // improvement level
  13: 0.4, // leading opponent's monopoly count
};

/**
 * Same minimal topology as `createMinimalGenome` (every input wired directly to every output, no
 * hidden nodes) but weights start biased toward `COACHED_WEIGHTS` instead of uniform-random —
 * "taught, not learned," per the strategy doctrine's framing. Only the first output gets the
 * coaching bias — today's only real usage is `PROPERTY_SCORE_OUTPUT_COUNT === 1` (the shared
 * property-scoring function); any additional outputs get pure jitter, since the bias above is
 * specifically about that one function, not a second, unrelated decision.
 */
export function createCoachedGenome(inputCount: number, outputCount: number, rng: Rng): Genome {
  const nodes: NodeGene[] = [];
  for (let i = 0; i < inputCount; i++) nodes.push({ id: i, kind: "input" });
  for (let o = 0; o < outputCount; o++) nodes.push({ id: inputCount + o, kind: "output" });

  const connections: ConnectionGene[] = [];
  let innovation = 0;
  for (let i = 0; i < inputCount; i++) {
    for (let o = 0; o < outputCount; o++) {
      const bias = o === 0 ? (COACHED_WEIGHTS[i] ?? 0) : 0;
      connections.push({
        innovation: innovation++,
        from: i,
        to: inputCount + o,
        weight: bias + gaussianJitter(rng),
        enabled: true,
      });
    }
  }
  return { nodes, connections };
}
