import type { BatchPlayer } from "../batch.js";
import { runBatchSimulation } from "../batch.js";
import { createNaiveBot } from "../bots/naive.js";
import { createNeatBot } from "../bots/neatBot.js";
import { createOrangeRushBot } from "../bots/orangeRush.js";
import { createRandomBot } from "../bots/random.js";
import { mulberry32 } from "../dice.js";
import { createCoachedGenome } from "./coaching.js";
import { PROPERTY_SCORE_INPUT_COUNT, PROPERTY_SCORE_OUTPUT_COUNT } from "./encoding.js";
import { createMinimalGenome } from "./genome.js";
import { InnovationTracker } from "./innovation.js";
import { reproduce, speciate, type Species, type SpeciesMember } from "./reproduction.js";
import type { Genome } from "./types.js";

export interface TrainOptions {
  population: number;
  generations: number;
  /** Games each genome plays per generation, against a fixed reference roster (Naive/Random/
   * OrangeRush) — not self-play. A larger number gives a steadier fitness estimate at the cost of
   * more games per generation; see the plan's "known limitations" for why this stays modest. */
  gamesPerGenome: number;
  seed?: number;
  maxTurnsPerGame?: number;
  speciesDistanceThreshold?: number;
  /** Seed generation 0 with `createCoachedGenome` (weights biased toward known-sane buy/bid/build
   * judgment, see `coaching.ts`) instead of `createMinimalGenome`'s uniform-random weights.
   * Default true; set false to compare against the uncoached baseline. */
  coaching?: boolean;
  onGeneration?: (stats: GenerationStats) => void;
}

export interface GenerationStats {
  generation: number;
  bestFitness: number;
  averageFitness: number;
  speciesCount: number;
}

export interface TrainResult {
  champion: Genome;
  history: GenerationStats[];
}

// Dwarfs a typical net-worth score so winning always outranks merely doing well but losing —
// without this, a genome that plays it safe and loses slowly could out-select a genome that
// actually wins, since a long, cautious game can accumulate more net worth along the way.
const WIN_BONUS = 2000;
// Lower than early NEAT literature's typical ~3 default: at 17 inputs (all-input-to-output, no
// hidden nodes yet in a fresh population), genomeDistance's disjoint/excess terms are usually 0
// (little structural divergence this early), so distance is dominated by average weight
// difference alone — a threshold of 3 let the *entire* population collapse into a single species
// every generation in practice (observed empirically while training this phase's champion),
// defeating speciation's actual purpose of protecting a lineage that's drifted from the rest long
// enough to prove itself. 1 reliably produces multiple species instead.
const DEFAULT_DISTANCE_THRESHOLD = 1;
const DEFAULT_MAX_TURNS_PER_GAME = 1000;

const REFERENCE_ROSTER: BatchPlayer[] = [
  { name: "Naive", createBot: () => createNaiveBot() },
  { name: "Random", createBot: () => createRandomBot() },
  { name: "OrangeRush", createBot: () => createOrangeRushBot() },
];

/** Average (win bonus if won + net worth at game end) over `gamesPerGenome` games against the
 * fixed reference roster, all played under the same `seed` — common random numbers, so every
 * genome this generation faces identical dice/card sequences and fitness differences reflect the
 * genomes, not who got luckier (the same technique `evaluatePurchase` in lookahead.ts uses). */
function evaluateFitness(genome: Genome, seed: number, gamesPerGenome: number, maxTurnsPerGame: number): number {
  const players: BatchPlayer[] = [{ name: "Neat", createBot: () => createNeatBot(genome) }, ...REFERENCE_ROSTER];
  const result = runBatchSimulation({ players, gameCount: gamesPerGenome, seed, maxTurnsPerGame });

  let total = 0;
  for (const game of result.games) {
    const neatResult = game.players.find((p) => p.name === "Neat")!;
    const won = game.winnerName === "Neat";
    total += (won ? WIN_BONUS : 0) + neatResult.netWorth;
  }
  return total / result.games.length;
}

/**
 * The evolutionary loop: each generation, every genome in the population is scored by
 * `evaluateFitness`, grouped into species, and bred into the next generation (see
 * `reproduction.ts`'s `speciate`/`reproduce`). Returns the best genome seen across the whole run
 * (not just the final generation's best — elitism makes losing it unlikely, but tracking it
 * independently costs nothing and removes any doubt) plus per-generation stats for the caller
 * (the training CLI) to report progress with.
 */
export function trainNeat(options: TrainOptions): TrainResult {
  const seed = options.seed ?? 1;
  const maxTurnsPerGame = options.maxTurnsPerGame ?? DEFAULT_MAX_TURNS_PER_GAME;
  const distanceThreshold = options.speciesDistanceThreshold ?? DEFAULT_DISTANCE_THRESHOLD;
  const rng = mulberry32(seed);
  const tracker = new InnovationTracker(
    PROPERTY_SCORE_INPUT_COUNT * PROPERTY_SCORE_OUTPUT_COUNT, // continues after the minimal genome's own innovation numbers
    PROPERTY_SCORE_INPUT_COUNT + PROPERTY_SCORE_OUTPUT_COUNT, // continues after the minimal genome's own node ids
  );

  const coaching = options.coaching ?? true;
  const seedGenome = coaching ? createCoachedGenome : createMinimalGenome;
  let population: Genome[] = Array.from({ length: options.population }, () =>
    seedGenome(PROPERTY_SCORE_INPUT_COUNT, PROPERTY_SCORE_OUTPUT_COUNT, rng),
  );

  let species: Species[] = [];
  const history: GenerationStats[] = [];
  let champion: Genome = population[0];
  let championFitness = -Infinity;

  for (let generation = 0; generation < options.generations; generation++) {
    tracker.startGeneration();
    const generationSeed = seed + generation * 100_000; // well spaced so generations' game seeds can't overlap

    const members: SpeciesMember[] = population.map((genome) => ({
      genome,
      fitness: evaluateFitness(genome, generationSeed, options.gamesPerGenome, maxTurnsPerGame),
    }));

    const best = members.reduce((a, b) => (b.fitness > a.fitness ? b : a));
    if (best.fitness > championFitness) {
      championFitness = best.fitness;
      champion = best.genome;
    }
    const averageFitness = members.reduce((sum, m) => sum + m.fitness, 0) / members.length;

    species = speciate(members, species, distanceThreshold);
    const stats: GenerationStats = { generation, bestFitness: best.fitness, averageFitness, speciesCount: species.length };
    history.push(stats);
    options.onGeneration?.(stats);

    if (generation < options.generations - 1) {
      population = reproduce(species, options.population, rng, tracker);
    }
  }

  return { champion, history };
}
