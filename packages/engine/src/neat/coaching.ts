import type { Rng } from "../dice.js";
import { OUTPUT_JAIL, OUTPUT_MORTGAGE, OUTPUT_PROPERTY, OUTPUT_SELL_HOUSE, OUTPUT_UNMORTGAGE } from "./encoding.js";
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
 * Seed weights for `encoding.ts`'s unified 21-feature `encodeDecisionFeatures` vector (indices
 * below match that function's return order — see its doc comment) — biasing generation 0 toward
 * roughly sane judgment on every decision instead of literal random weights, so evolution doesn't
 * have to rediscover basic Monopoly economics before it can improve on it. Keyed by output head
 * (`encoding.ts`'s `OUTPUT_*` constants), drawn from `docs/neat-strategy-doctrine.md`:
 *
 * - `property` (unchanged from the single-output phase): doctrine #1/#2 ("buy aggressively unless
 *   it risks insolvency") → strong positive on affordability margin (19); doctrine #3 (monopoly
 *   completion dominates) → strong positive on group progress (14), supported by monopoly count
 *   (2); doctrine #9/#10 (income/blocking value) → modest positive on base rent (16); mild negative
 *   on price (12) so "buy aggressively" doesn't mean "buy anything regardless of cost"; mild
 *   positive on the leading opponent's monopoly count (4) and the candidate's own improvement
 *   level (17) for competitive pressure and "finish what's started."
 * - `jail` (doctrine #7, "jail's value flips over the game"): positive on own cash (0) — pay when
 *   comfortable; negative on `maxOpponentRentThreat` (9) — lean toward staying when the board looks
 *   dangerous; positive on unowned properties remaining (11) — worth circulating for while there's
 *   still free property to grab.
 * - `mortgage` (doctrine #8/#11, protect income and near-complete monopolies): negative on
 *   `isRailroadOrUtility` (15) and on group progress (14) — the fuller a group already is, or the
 *   more it scales with count owned, the less willing to give up a piece of it.
 * - `unmortgage` (doctrine #11, reinvest when it restores a monopoly): positive on group progress
 *   (14) and affordability margin (19).
 * - `sellHouse`: negative on own cash (0) — a last resort reached for when cash is tight, not a
 *   default instinct when flush.
 *
 * **Primary vs. secondary actions**: the game's objective is acquiring and developing property —
 * that's what the rules of Monopoly open with, and what the property head's biases point the bot
 * toward. Mortgaging, unmortgaging, and selling houses are *secondary*: tools reached for
 * deliberately, defensively or offensively, to change the game — never routine moves. That
 * posture is seeded as a negative weight on `hasCandidate` (index 20) for each secondary head:
 * since that input is always exactly 1 whenever these heads are consulted, the weight acts as a
 * true bias term (NEAT genomes have no explicit bias node otherwise), so at generation 0 the
 * default answer to "should I mortgage/unmortgage/sell right now?" is *no* — a secondary action
 * has to be argued for by the rest of the feature vector, not merely not-argued-against. Without
 * this, a fresh population treats all five heads as equally casual, and evolution has been
 * observed wandering into pathologies like mortgage/unmortgage churn loops on a single property.
 *
 * Every weight — coached or not — still gets independent random jitter, so generation 0 keeps
 * enough diversity for speciation and mutation to actually explore from; a population seeded
 * identically at every weight would defeat the point of an evolutionary population.
 */
const COACHED_WEIGHTS: Record<number, Record<number, number>> = {
  [OUTPUT_PROPERTY]: {
    0: 0.2, // own cash
    2: 0.8, // monopoly count
    4: 0.4, // leading opponent's monopoly count
    12: -0.3, // price
    14: 1.2, // group progress
    16: 0.6, // base rent
    17: 0.3, // improvement level
    19: 1.5, // affordability margin
  },
  [OUTPUT_JAIL]: {
    0: 0.5, // own cash
    9: -0.6, // max opponent rent threat
    11: 0.4, // unowned properties remaining
  },
  [OUTPUT_MORTGAGE]: {
    14: -0.6, // group progress
    15: -0.8, // is railroad/utility
    20: -0.4, // hasCandidate — secondary-action inaction bias (see doc comment)
  },
  [OUTPUT_UNMORTGAGE]: {
    14: 0.5, // group progress
    19: 0.8, // affordability margin
    20: -0.3, // hasCandidate — secondary-action inaction bias
  },
  [OUTPUT_SELL_HOUSE]: {
    0: -0.5, // own cash
    20: -0.6, // hasCandidate — secondary-action inaction bias (the most disruptive secondary action)
  },
};

/**
 * Same minimal topology as `createMinimalGenome` (every input wired directly to every output, no
 * hidden nodes) but weights start biased toward `COACHED_WEIGHTS` instead of uniform-random —
 * "taught, not learned," per the strategy doctrine's framing. Each output head gets its own bias
 * set (or pure jitter, for any input/head pair not named above).
 */
export function createCoachedGenome(inputCount: number, outputCount: number, rng: Rng): Genome {
  const nodes: NodeGene[] = [];
  for (let i = 0; i < inputCount; i++) nodes.push({ id: i, kind: "input" });
  for (let o = 0; o < outputCount; o++) nodes.push({ id: inputCount + o, kind: "output" });

  const connections: ConnectionGene[] = [];
  let innovation = 0;
  for (let i = 0; i < inputCount; i++) {
    for (let o = 0; o < outputCount; o++) {
      const bias = COACHED_WEIGHTS[o]?.[i] ?? 0;
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
