import type { Rng } from "../dice.js";
import { InnovationTracker } from "./innovation.js";
import { mutateAddConnection, mutateAddNode, mutateWeights } from "./genome.js";
import type { ConnectionGene, Genome, NodeGene } from "./types.js";

/**
 * Standard NEAT crossover: connection genes are aligned by innovation number. A gene both
 * parents share ("matching") is inherited from a random parent; a gene only one parent has
 * ("disjoint" if within the other parent's innovation range, "excess" if beyond it) is inherited
 * only from the fitter parent — the less-fit parent's unique structure isn't carried forward.
 * Ties are broken by coin flip (need to pick *a* "fitter" parent either way, to know whose unique
 * genes to keep).
 */
export function crossover(a: Genome, b: Genome, fitnessA: number, fitnessB: number, rng: Rng): Genome {
  let fitter: Genome;
  let other: Genome;
  if (fitnessA > fitnessB) {
    fitter = a;
    other = b;
  } else if (fitnessB > fitnessA) {
    fitter = b;
    other = a;
  } else {
    [fitter, other] = rng() < 0.5 ? [a, b] : [b, a];
  }

  const otherByInnovation = new Map(other.connections.map((c) => [c.innovation, c]));
  const connections: ConnectionGene[] = fitter.connections.map((gene) => {
    const matching = otherByInnovation.get(gene.innovation);
    if (!matching) return { ...gene }; // disjoint/excess — only the fitter parent has it
    const chosen = rng() < 0.5 ? gene : matching;
    // If either parent has this connection disabled, there's a chance the child does too —
    // standard NEAT behavior, since a disabled connection may represent an evolutionarily
    // important "turned off for now" state worth sometimes preserving.
    const enabled = gene.enabled && matching.enabled ? true : rng() < 0.75 ? false : true;
    return { ...chosen, enabled };
  });

  const nodeById = new Map<number, NodeGene>();
  for (const n of [...fitter.nodes, ...other.nodes]) nodeById.set(n.id, n);
  const referencedIds = new Set<number>();
  for (const c of connections) {
    referencedIds.add(c.from);
    referencedIds.add(c.to);
  }
  const nodes = [...referencedIds].map((id) => nodeById.get(id)!);

  return { nodes, connections };
}

export interface DistanceCoefficients {
  excess: number;
  disjoint: number;
  weight: number;
}

export const DEFAULT_DISTANCE_COEFFICIENTS: DistanceCoefficients = { excess: 1, disjoint: 1, weight: 0.4 };

/** The standard NEAT compatibility-distance formula: (weighted disjoint + weighted excess genes,
 * normalized by genome size) + (average weight difference of matching genes). Small genomes
 * (as in a fresh population) use an unnormalized count, matching common NEAT practice of only
 * normalizing once genomes exceed a handful of genes. */
export function genomeDistance(a: Genome, b: Genome, coefficients: DistanceCoefficients = DEFAULT_DISTANCE_COEFFICIENTS): number {
  const aByInnovation = new Map(a.connections.map((c) => [c.innovation, c]));
  const bByInnovation = new Map(b.connections.map((c) => [c.innovation, c]));
  const maxInnovationA = a.connections.reduce((max, c) => Math.max(max, c.innovation), 0);
  const maxInnovationB = b.connections.reduce((max, c) => Math.max(max, c.innovation), 0);
  const lowerMax = Math.min(maxInnovationA, maxInnovationB);

  let disjoint = 0;
  let excess = 0;
  let matching = 0;
  let weightDiffSum = 0;
  const allInnovations = new Set([...aByInnovation.keys(), ...bByInnovation.keys()]);
  for (const innovation of allInnovations) {
    const geneA = aByInnovation.get(innovation);
    const geneB = bByInnovation.get(innovation);
    if (geneA && geneB) {
      matching++;
      weightDiffSum += Math.abs(geneA.weight - geneB.weight);
    } else if (innovation > lowerMax) {
      excess++;
    } else {
      disjoint++;
    }
  }

  const n = Math.max(a.connections.length, b.connections.length, 1);
  const normalizer = n < 20 ? 1 : n; // small-genome convention: don't over-normalize early genomes
  const avgWeightDiff = matching > 0 ? weightDiffSum / matching : 0;
  return (coefficients.excess * excess) / normalizer + (coefficients.disjoint * disjoint) / normalizer + coefficients.weight * avgWeightDiff;
}

export interface SpeciesMember {
  genome: Genome;
  fitness: number;
}

export interface Species {
  representative: Genome;
  members: SpeciesMember[];
}

/** Assigns each genome to the first species (carried over from the previous generation, if any)
 * whose representative it's within `distanceThreshold` of, or founds a new species. Species with
 * no matching members this generation are dropped. */
export function speciate(population: SpeciesMember[], previousSpecies: Species[], distanceThreshold: number): Species[] {
  const species: Species[] = previousSpecies.map((s) => ({ representative: s.representative, members: [] }));

  for (const individual of population) {
    const home = species.find((s) => genomeDistance(individual.genome, s.representative) < distanceThreshold);
    if (home) {
      home.members.push(individual);
    } else {
      species.push({ representative: individual.genome, members: [individual] });
    }
  }
  return species.filter((s) => s.members.length > 0);
}

const ELITE_MIN_SPECIES_SIZE = 5;
const SURVIVAL_FRACTION = 0.5;

export interface MutationRates {
  weights: number;
  addConnection: number;
  addNode: number;
}

export const DEFAULT_MUTATION_RATES: MutationRates = { weights: 0.8, addConnection: 0.08, addNode: 0.03 };

/**
 * Produces the next generation: each species' offspring count is proportional to its total
 * fitness-shared ("adjusted") fitness — fitness divided by species size, so a large species
 * doesn't automatically dominate just by having more members, protecting smaller/newer species
 * long enough for topological novelty to prove itself. A species above `ELITE_MIN_SPECIES_SIZE`
 * carries its unmutated champion forward unchanged, so it can't regress purely from mutation bad
 * luck. Breeding parents are drawn from the top `SURVIVAL_FRACTION` of each species.
 */
export function reproduce(
  species: Species[],
  populationSize: number,
  rng: Rng,
  tracker: InnovationTracker,
  mutationRates: MutationRates = DEFAULT_MUTATION_RATES,
): Genome[] {
  const allMembers = species.flatMap((s) => s.members);
  // Raw fitness is very often negative in early generations — an untrained genome usually goes
  // bankrupt against the reference roster, and bankruptcy is a large fixed penalty (netWorth's
  // BANKRUPTCY_PENALTY). Clamping negative fitness straight to 0 (rather than shifting) would
  // erase all relative signal exactly when it's needed most: if *every* genome is negative, every
  // species' adjusted fitness collapses to 0, every offspring share rounds to 0, and the next
  // generation would be empty. Shifting everyone up by the population's minimum (only when that
  // minimum is actually negative) keeps the worst genome at 0 and everyone else's *relative*
  // standing intact, which is what fitness-proportional selection actually needs.
  const minFitness = Math.min(...allMembers.map((m) => m.fitness));
  const shift = minFitness < 0 ? -minFitness : 0;

  const adjustedFitness = species.map((s) => s.members.reduce((sum, m) => sum + (m.fitness + shift), 0) / s.members.length);
  const totalAdjusted = adjustedFitness.reduce((a, b) => a + b, 0);
  // Degenerate case: every genome tied at exactly the same fitness (totalAdjusted still 0 even
  // after shifting). Fitness gives no signal to select on, so fall back to splitting offspring
  // proportional to species size instead of fitness share — still guarantees a full population.
  const shareOf = (i: number) => (totalAdjusted > 0 ? adjustedFitness[i] / totalAdjusted : species[i].members.length / allMembers.length);

  const nextGeneration: Genome[] = [];
  species.forEach((s, i) => {
    const sorted = [...s.members].sort((a, b) => b.fitness - a.fitness);
    let offspringCount = Math.round(shareOf(i) * populationSize);

    // Elite carryover is a claim on the species' own offspring budget, not conditional on that
    // budget already being positive — a qualifying species always keeps its champion.
    if (s.members.length >= ELITE_MIN_SPECIES_SIZE) {
      nextGeneration.push(sorted[0].genome);
      offspringCount = Math.max(0, offspringCount - 1);
    }

    const breedingPool = sorted.slice(0, Math.max(1, Math.ceil(sorted.length * SURVIVAL_FRACTION)));
    for (let i2 = 0; i2 < offspringCount; i2++) {
      const parentA = breedingPool[Math.floor(rng() * breedingPool.length)];
      const parentB = breedingPool[Math.floor(rng() * breedingPool.length)];
      let child = crossover(parentA.genome, parentB.genome, parentA.fitness, parentB.fitness, rng);
      if (rng() < mutationRates.weights) child = mutateWeights(child, rng);
      if (rng() < mutationRates.addConnection) child = mutateAddConnection(child, rng, tracker);
      if (rng() < mutationRates.addNode) child = mutateAddNode(child, rng, tracker);
      nextGeneration.push(child);
    }
  });

  // Rounding each species' share independently can drift from populationSize — top up or trim.
  // Tops up from the full original population (always non-empty if populationSize > 0), not just
  // whatever's already in nextGeneration — so this can bootstrap even if the loop above produced
  // nothing at all (e.g. a single, tiny species below the elite threshold with a rounded-to-zero share).
  while (nextGeneration.length < populationSize) {
    const donor = allMembers[Math.floor(rng() * allMembers.length)];
    nextGeneration.push(mutateWeights(donor.genome, rng));
  }
  if (nextGeneration.length > populationSize) nextGeneration.length = populationSize;

  return nextGeneration;
}
