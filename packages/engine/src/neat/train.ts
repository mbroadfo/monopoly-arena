import type { BatchPlayer } from "../batch.js";
import { runBatchSimulation } from "../batch.js";
import { createNaiveBot } from "../bots/naive.js";
import { createNeatBot } from "../bots/neatBot.js";
import { createOrangeRushBot } from "../bots/orangeRush.js";
import { createRandomBot } from "../bots/random.js";
import { mulberry32 } from "../dice.js";
import { createCoachedGenome } from "./coaching.js";
import { DECISION_INPUT_COUNT, DECISION_OUTPUT_COUNT } from "./encoding.js";
import { createMinimalGenome } from "./genome.js";
import { InnovationTracker } from "./innovation.js";
import { reproduce, speciate, type Species, type SpeciesMember } from "./reproduction.js";
import type { Genome } from "./types.js";

export interface TrainOptions {
  population: number;
  generations: number;
  /** Games each genome plays per generation. Split in half when `selfPlay` is on and a champion
   * exists yet; otherwise all played against the fixed reference roster (Naive/Random/OrangeRush).
   * A larger number gives a steadier fitness estimate at the cost of more games per generation. */
  gamesPerGenome: number;
  seed?: number;
  maxTurnsPerGame?: number;
  speciesDistanceThreshold?: number;
  /** Seed generation 0 with `createCoachedGenome` (weights biased toward known-sane buy/bid/build
   * judgment, see `coaching.ts`) instead of `createMinimalGenome`'s uniform-random weights.
   * Default true; set false to compare against the uncoached baseline. */
  coaching?: boolean;
  /** Play half of each generation's games against the best genome found so far (once one exists —
   * generation 0 has no champion yet, so it always falls back to the reference roster), instead of
   * only ever facing the fixed heuristic bots. Default false, preserving prior behavior as an
   * explicit opt-in rather than a silent change. See `evaluateFitness` for why this is a
   * "persistent champion" scheme rather than full round-robin self-play. */
  selfPlay?: boolean;
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
// genomeDistance's weight-difference term is an *average* over every connection, so — somewhat
// counterintuitively — a bigger minimal genome doesn't widen typical pairwise distances, it
// narrows them: averaging over more independently-perturbed connections concentrates the result
// more tightly around its expected value (basic variance reduction from a larger sample). At 17
// inputs/1 output (17 connections), 1 reliably produced multiple species; at 21 inputs/5 outputs
// (105 connections), empirically probed thresholds behaved very differently: 1 (and everything
// from 0.5 up) collapsed to a single species every generation, 0.1 fragmented into a
// species-per-genome mess (13-16 species out of a population of 16), and 0.25 produced real,
// gradually growing diversity without fragmenting. Re-probe empirically (see the plan's
// verification steps) rather than assuming either number carries over the next time this changes.
const DEFAULT_DISTANCE_THRESHOLD = 0.25;
const DEFAULT_MAX_TURNS_PER_GAME = 1000;
// netWorth alone gives almost no gradient against wasteful mortgage/unmortgage churn — a cycle
// only costs the 10% unmortgage interest fee (a few dollars), lost in the noise of a game-long net
// worth in the hundreds or thousands. Confirmed directly during this phase: a champion had learned
// to mortgage-then-immediately-unmortgage the same low-value property hundreds of times in a
// single game (regardless of cash on hand — not a marginal, context-sensitive call, just a
// confidently wrong learned pattern for that property's feature profile), winning anyway despite
// the waste, so the implicit cost never showed up as a fitness disadvantage worth selecting
// against. A direct penalty on `PlayerResult.financeActionCount` (batch.ts) makes the waste
// impossible to miss: negligible for a genome that mortgages/unmortgages a handful of times per
// game (as legitimate defensive play does), catastrophic for one that does it hundreds of times.
const FINANCE_CHURN_PENALTY = 10;

const REFERENCE_ROSTER: BatchPlayer[] = [
  { name: "Naive", createBot: () => createNaiveBot() },
  { name: "Random", createBot: () => createRandomBot() },
  { name: "OrangeRush", createBot: () => createOrangeRushBot() },
];

/** A distinct seed offset for the self-play half of a generation's games, so it doesn't replay
 * the exact same dice/card sequence as the reference-roster half within the same generation. */
const SELF_PLAY_SEED_OFFSET = 500_000;

function selfPlayRoster(opponent: Genome): BatchPlayer[] {
  // Drops Random in favor of the persistent champion, rather than growing to a 5-player game —
  // keeps every generation's games at the same player count regardless of whether self-play is on.
  return [{ name: "Champion", createBot: () => createNeatBot(opponent) }, ...REFERENCE_ROSTER.filter((p) => p.name !== "Random")];
}

function averageFitnessAgainst(genome: Genome, roster: BatchPlayer[], seed: number, games: number, maxTurnsPerGame: number): { total: number; count: number } {
  if (games === 0) return { total: 0, count: 0 };
  const players: BatchPlayer[] = [{ name: "Neat", createBot: () => createNeatBot(genome) }, ...roster];
  const result = runBatchSimulation({ players, gameCount: games, seed, maxTurnsPerGame });

  let total = 0;
  for (const game of result.games) {
    const neatResult = game.players.find((p) => p.name === "Neat")!;
    const won = game.winnerName === "Neat";
    total += (won ? WIN_BONUS : 0) + neatResult.netWorth - FINANCE_CHURN_PENALTY * neatResult.financeActionCount;
  }
  return { total, count: result.games.length };
}

/**
 * Average (win bonus if won + net worth at game end) over `gamesPerGenome` games, all played
 * under the same `seed` — common random numbers, so every genome this generation faces identical
 * dice/card sequences and fitness differences reflect the genomes, not who got luckier (the same
 * technique `evaluatePurchase` in lookahead.ts uses).
 *
 * When `selfPlayOpponent` is given (the best genome found in a prior generation — see
 * `trainNeat`), half the games swap one reference bot for that persistent champion instead of
 * playing the fixed roster alone. This is deliberately *not* full round-robin self-play (every
 * genome vs. every other genome each generation, population² games) — that would multiply compute
 * for a population this size. Playing against "the best genome found so far" is the standard,
 * much cheaper simplification: fitness still rewards beating an actually-strong evolving opponent,
 * not just fixed heuristics, without changing the games-per-generation budget at all.
 */
function evaluateFitness(genome: Genome, seed: number, gamesPerGenome: number, maxTurnsPerGame: number, selfPlayOpponent: Genome | null): number {
  if (!selfPlayOpponent) {
    const { total, count } = averageFitnessAgainst(genome, REFERENCE_ROSTER, seed, gamesPerGenome, maxTurnsPerGame);
    return total / count;
  }

  const selfPlayGames = Math.ceil(gamesPerGenome / 2);
  const referenceGames = gamesPerGenome - selfPlayGames;
  const a = averageFitnessAgainst(genome, selfPlayRoster(selfPlayOpponent), seed, selfPlayGames, maxTurnsPerGame);
  const b = averageFitnessAgainst(genome, REFERENCE_ROSTER, seed + SELF_PLAY_SEED_OFFSET, referenceGames, maxTurnsPerGame);
  return (a.total + b.total) / (a.count + b.count);
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
    DECISION_INPUT_COUNT * DECISION_OUTPUT_COUNT, // continues after the minimal genome's own innovation numbers
    DECISION_INPUT_COUNT + DECISION_OUTPUT_COUNT, // continues after the minimal genome's own node ids
  );

  const coaching = options.coaching ?? true;
  const seedGenome = coaching ? createCoachedGenome : createMinimalGenome;
  let population: Genome[] = Array.from({ length: options.population }, () =>
    seedGenome(DECISION_INPUT_COUNT, DECISION_OUTPUT_COUNT, rng),
  );

  const selfPlay = options.selfPlay ?? false;
  let species: Species[] = [];
  const history: GenerationStats[] = [];
  let champion: Genome = population[0];
  let championFitness = -Infinity;
  let selfPlayOpponent: Genome | null = null; // no prior-generation champion to play against yet

  for (let generation = 0; generation < options.generations; generation++) {
    tracker.startGeneration();
    const generationSeed = seed + generation * 100_000; // well spaced so generations' game seeds can't overlap

    const members: SpeciesMember[] = population.map((genome) => ({
      genome,
      fitness: evaluateFitness(genome, generationSeed, options.gamesPerGenome, maxTurnsPerGame, selfPlay ? selfPlayOpponent : null),
    }));

    const best = members.reduce((a, b) => (b.fitness > a.fitness ? b : a));
    if (best.fitness > championFitness) {
      championFitness = best.fitness;
      champion = best.genome;
    }
    if (selfPlay) selfPlayOpponent = champion; // next generation plays against the best genome found so far
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
