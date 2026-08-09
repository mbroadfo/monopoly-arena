import { describe, expect, it } from "vitest";
import { mulberry32 } from "../dice.js";
import { InnovationTracker } from "./innovation.js";
import { crossover, genomeDistance, reproduce, type Species } from "./reproduction.js";
import type { Genome } from "./types.js";

describe("genomeDistance", () => {
  it("is 0 for identical genomes", () => {
    const genome: Genome = {
      nodes: [
        { id: 0, kind: "input" },
        { id: 1, kind: "output" },
      ],
      connections: [{ innovation: 0, from: 0, to: 1, weight: 0.5, enabled: true }],
    };
    expect(genomeDistance(genome, genome)).toBe(0);
  });

  it("reflects only weight difference when topology matches exactly", () => {
    const base: Genome["nodes"] = [
      { id: 0, kind: "input" },
      { id: 1, kind: "output" },
    ];
    const a: Genome = { nodes: base, connections: [{ innovation: 0, from: 0, to: 1, weight: 1, enabled: true }] };
    const b: Genome = { nodes: base, connections: [{ innovation: 0, from: 0, to: 1, weight: 1.5, enabled: true }] };
    const distance = genomeDistance(a, b, { excess: 1, disjoint: 1, weight: 1 });
    expect(distance).toBeCloseTo(0.5, 10);
  });

  it("counts genes present in only one genome as disjoint (within the other's range) or excess (beyond it)", () => {
    const nodes: Genome["nodes"] = [
      { id: 0, kind: "input" },
      { id: 1, kind: "input" },
      { id: 2, kind: "output" },
    ];
    // a: innovations 0, 1, 5 — b: innovations 0, 2. lowerMax = min(5, 2) = 2.
    // innovation 0: matching. 1: a-only, 1<=2 -> disjoint. 2: b-only, 2<=2 -> disjoint. 5: a-only, 5>2 -> excess.
    const a: Genome = {
      nodes,
      connections: [
        { innovation: 0, from: 0, to: 2, weight: 1, enabled: true },
        { innovation: 1, from: 1, to: 2, weight: 1, enabled: true },
        { innovation: 5, from: 0, to: 1, weight: 1, enabled: true },
      ],
    };
    const b: Genome = {
      nodes,
      connections: [
        { innovation: 0, from: 0, to: 2, weight: 1, enabled: true },
        { innovation: 2, from: 1, to: 2, weight: 1, enabled: true },
      ],
    };
    const distance = genomeDistance(a, b, { excess: 1, disjoint: 1, weight: 0 });
    expect(distance).toBeCloseTo(3, 10); // 2 disjoint + 1 excess, weight coefficient 0 ignores the matching gene
  });
});

describe("crossover", () => {
  const nodes: Genome["nodes"] = [
    { id: 0, kind: "input" },
    { id: 1, kind: "input" },
    { id: 2, kind: "output" },
  ];

  it("only inherits disjoint/excess genes from the fitter parent", () => {
    const fitter: Genome = {
      nodes,
      connections: [
        { innovation: 0, from: 0, to: 2, weight: 1, enabled: true },
        { innovation: 5, from: 1, to: 2, weight: 2, enabled: true }, // unique to fitter
      ],
    };
    const lessFit: Genome = {
      nodes: [...nodes, { id: 3, kind: "hidden" }],
      connections: [
        { innovation: 0, from: 0, to: 2, weight: 1, enabled: true },
        { innovation: 3, from: 0, to: 3, weight: 9, enabled: true }, // unique to lessFit
      ],
    };

    const child = crossover(fitter, lessFit, 10, 1, mulberry32(1));
    const innovations = child.connections.map((c) => c.innovation).sort((a, b) => a - b);
    expect(innovations).toEqual([0, 5]);
    expect(child.nodes.find((n) => n.id === 3)).toBeUndefined(); // only referenced by the excluded gene
  });

  it("inherits a matching gene's weight from either parent, never a third value", () => {
    const a: Genome = { nodes, connections: [{ innovation: 0, from: 0, to: 2, weight: 1, enabled: true }] };
    const b: Genome = { nodes, connections: [{ innovation: 0, from: 0, to: 2, weight: 2, enabled: true }] };

    const seenWeights = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) {
      const child = crossover(a, b, 5, 5, mulberry32(seed)); // tied fitness
      seenWeights.add(child.connections[0].weight);
    }
    expect([...seenWeights].every((w) => w === 1 || w === 2)).toBe(true);
  });

  it("breaks fitness ties by coin flip rather than favoring a fixed side", () => {
    // b has a unique gene; if crossover always favored "a" on ties, this gene would never appear.
    const a: Genome = { nodes, connections: [{ innovation: 0, from: 0, to: 2, weight: 1, enabled: true }] };
    const b: Genome = {
      nodes,
      connections: [
        { innovation: 0, from: 0, to: 2, weight: 1, enabled: true },
        { innovation: 7, from: 1, to: 2, weight: 1, enabled: true },
      ],
    };
    let sawBsUniqueGene = false;
    for (let seed = 1; seed <= 40 && !sawBsUniqueGene; seed++) {
      const child = crossover(a, b, 5, 5, mulberry32(seed));
      if (child.connections.some((c) => c.innovation === 7)) sawBsUniqueGene = true;
    }
    expect(sawBsUniqueGene).toBe(true);
  });
});

describe("reproduce", () => {
  const genome: Genome = {
    nodes: [
      { id: 0, kind: "input" },
      { id: 1, kind: "output" },
    ],
    connections: [{ innovation: 0, from: 0, to: 1, weight: 1, enabled: true }],
  };

  it("always returns exactly populationSize genomes even when every fitness is negative", () => {
    // Regression test: an early population of untrained genomes typically goes bankrupt against
    // real opponents, so *every* fitness is negative — this used to make every species' offspring
    // share round to 0, producing an empty next generation and crashing training at generation 1.
    const species: Species[] = [
      { representative: genome, members: [{ genome, fitness: -900_000 }, { genome, fitness: -950_000 }] },
      { representative: genome, members: [{ genome, fitness: -800_000 }, { genome, fitness: -850_000 }] },
    ];
    const tracker = new InnovationTracker(1, 2);
    const next = reproduce(species, 10, mulberry32(1), tracker);
    expect(next).toHaveLength(10);
  });

  it("gives the better-fitness species more offspring, even when both are negative", () => {
    // Two structurally distinct genomes (different connection counts) so each species' elite —
    // carried into the next generation unmutated, since both species meet ELITE_MIN_SPECIES_SIZE
    // — is identifiable by shape in the output, letting this verify the *proportional* share
    // directly rather than just the total count.
    const worseGenome: Genome = genome; // 1 connection
    const betterGenome: Genome = {
      nodes: genome.nodes,
      connections: [...genome.connections, { innovation: 1, from: 0, to: 1, weight: 0.5, enabled: false }],
    }; // 2 connections — deliberately distinguishable from worseGenome

    const worseSpecies: Species = {
      representative: worseGenome,
      members: Array.from({ length: 5 }, () => ({ genome: worseGenome, fitness: -1000 })),
    };
    const betterSpecies: Species = {
      representative: betterGenome,
      members: Array.from({ length: 5 }, () => ({ genome: betterGenome, fitness: -10 })),
    };
    const tracker = new InnovationTracker(2, 2);
    const next = reproduce([worseSpecies, betterSpecies], 100, mulberry32(1), tracker);

    expect(next).toHaveLength(100);
    // Elites are exact, unmutated copies — count offspring whose shape still matches each
    // species' starting genome (a generous proxy for "descended mostly from this species", since
    // crossover/mutation quickly diverges everything else).
    const worseCount = next.filter((g) => g.connections.length === 1).length;
    const betterCount = next.filter((g) => g.connections.length === 2).length;
    expect(betterCount).toBeGreaterThan(worseCount);
  });

  it("returns exactly populationSize genomes when every genome is tied at the same fitness", () => {
    const species: Species[] = [
      { representative: genome, members: [{ genome, fitness: 5 }, { genome, fitness: 5 }] },
      { representative: genome, members: [{ genome, fitness: 5 }] },
    ];
    const tracker = new InnovationTracker(1, 2);
    const next = reproduce(species, 12, mulberry32(1), tracker);
    expect(next).toHaveLength(12);
  });
});
