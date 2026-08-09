import { describe, expect, it } from "vitest";
import { mulberry32 } from "../dice.js";
import { evaluate, mutateAddConnection, mutateAddNode } from "./genome.js";
import { InnovationTracker } from "./innovation.js";
import type { Genome } from "./types.js";

describe("evaluate", () => {
  it("computes a known forward pass for a hand-built genome", () => {
    const genome: Genome = {
      nodes: [
        { id: 0, kind: "input" },
        { id: 1, kind: "input" },
        { id: 2, kind: "output" },
      ],
      connections: [
        { innovation: 0, from: 0, to: 2, weight: 0.5, enabled: true },
        { innovation: 1, from: 1, to: 2, weight: -0.25, enabled: true },
      ],
    };
    const [output] = evaluate(genome, [1, 2]);
    expect(output).toBeCloseTo(Math.tanh(1 * 0.5 + 2 * -0.25), 10);
  });

  it("ignores disabled connections", () => {
    const genome: Genome = {
      nodes: [
        { id: 0, kind: "input" },
        { id: 1, kind: "output" },
      ],
      connections: [{ innovation: 0, from: 0, to: 1, weight: 5, enabled: false }],
    };
    const [output] = evaluate(genome, [1]);
    expect(output).toBe(Math.tanh(0));
  });

  it("propagates through a hidden node", () => {
    const genome: Genome = {
      nodes: [
        { id: 0, kind: "input" },
        { id: 1, kind: "hidden" },
        { id: 2, kind: "output" },
      ],
      connections: [
        { innovation: 0, from: 0, to: 1, weight: 1, enabled: true },
        { innovation: 1, from: 1, to: 2, weight: 1, enabled: true },
      ],
    };
    const [output] = evaluate(genome, [0.3]);
    expect(output).toBeCloseTo(Math.tanh(Math.tanh(0.3)), 10);
  });

  it("throws when the input vector length doesn't match the genome's input count", () => {
    const genome: Genome = {
      nodes: [
        { id: 0, kind: "input" },
        { id: 1, kind: "output" },
      ],
      connections: [{ innovation: 0, from: 0, to: 1, weight: 1, enabled: true }],
    };
    expect(() => evaluate(genome, [1, 2])).toThrow();
  });
});

describe("mutateAddNode", () => {
  it("splits a connection: disables it, inserts a hidden node with a weight-preserving split", () => {
    const genome: Genome = {
      nodes: [
        { id: 0, kind: "input" },
        { id: 1, kind: "output" },
      ],
      connections: [{ innovation: 0, from: 0, to: 1, weight: 0.7, enabled: true }],
    };
    const tracker = new InnovationTracker(1, 2);
    const mutated = mutateAddNode(genome, mulberry32(1), tracker);

    expect(mutated.nodes).toHaveLength(3);
    const hidden = mutated.nodes.find((n) => n.kind === "hidden")!;
    expect(hidden).toBeDefined();

    const original = mutated.connections.find((c) => c.innovation === 0)!;
    expect(original.enabled).toBe(false);

    const inConn = mutated.connections.find((c) => c.to === hidden.id)!;
    const outConn = mutated.connections.find((c) => c.from === hidden.id)!;
    expect(inConn.weight).toBe(1); // weight-preserving split convention
    expect(outConn.weight).toBe(0.7);
  });

  it("approximately preserves the network's output near 0, where tanh is closest to linear", () => {
    // Not an exact invariant — see genome.ts's comment on mutateAddNode: tanh at the new hidden
    // node still composes an extra nonlinearity in. It's a close approximation for small inputs.
    const genome: Genome = {
      nodes: [
        { id: 0, kind: "input" },
        { id: 1, kind: "output" },
      ],
      connections: [{ innovation: 0, from: 0, to: 1, weight: 0.7, enabled: true }],
    };
    const tracker = new InnovationTracker(1, 2);
    const mutated = mutateAddNode(genome, mulberry32(1), tracker);

    const before = evaluate(genome, [0.05]);
    const after = evaluate(mutated, [0.05]);
    expect(after[0]).toBeCloseTo(before[0], 3);
  });

  it("does nothing to a genome with no enabled connections", () => {
    const genome: Genome = {
      nodes: [
        { id: 0, kind: "input" },
        { id: 1, kind: "output" },
      ],
      connections: [{ innovation: 0, from: 0, to: 1, weight: 1, enabled: false }],
    };
    const tracker = new InnovationTracker(1, 2);
    const mutated = mutateAddNode(genome, mulberry32(1), tracker);
    expect(mutated).toEqual(genome);
  });
});

function hasCycle(genome: Genome): boolean {
  const adjacency = new Map<number, number[]>();
  for (const n of genome.nodes) adjacency.set(n.id, []);
  for (const c of genome.connections) {
    if (c.enabled) adjacency.get(c.from)?.push(c.to);
  }
  const visiting = new Set<number>();
  const visited = new Set<number>();
  function visit(id: number): boolean {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  }
  return genome.nodes.some((n) => visit(n.id));
}

describe("mutateAddConnection", () => {
  it("adds a new connection between previously unconnected nodes", () => {
    const genome: Genome = {
      nodes: [
        { id: 0, kind: "input" },
        { id: 1, kind: "input" },
        { id: 2, kind: "output" },
      ],
      connections: [{ innovation: 0, from: 0, to: 2, weight: 1, enabled: true }],
    };
    const tracker = new InnovationTracker(1, 3);
    const mutated = mutateAddConnection(genome, mulberry32(1), tracker);
    expect(mutated.connections).toHaveLength(2);
  });

  it("never introduces a cycle, across many attempts", () => {
    const genome: Genome = {
      nodes: [
        { id: 0, kind: "input" },
        { id: 1, kind: "hidden" },
        { id: 2, kind: "hidden" },
        { id: 3, kind: "output" },
      ],
      connections: [
        { innovation: 0, from: 0, to: 1, weight: 1, enabled: true },
        { innovation: 1, from: 1, to: 2, weight: 1, enabled: true },
        { innovation: 2, from: 2, to: 3, weight: 1, enabled: true },
      ],
    };
    const tracker = new InnovationTracker(3, 4);
    for (let seed = 1; seed <= 50; seed++) {
      const mutated = mutateAddConnection(genome, mulberry32(seed), tracker);
      expect(hasCycle(mutated)).toBe(false);
    }
  });

  it("does nothing once the graph is fully connected (no legal candidates left)", () => {
    // 1 input, 1 output — already the only possible connection.
    const genome: Genome = {
      nodes: [
        { id: 0, kind: "input" },
        { id: 1, kind: "output" },
      ],
      connections: [{ innovation: 0, from: 0, to: 1, weight: 1, enabled: true }],
    };
    const tracker = new InnovationTracker(1, 2);
    const mutated = mutateAddConnection(genome, mulberry32(1), tracker);
    expect(mutated).toEqual(genome);
  });
});

describe("InnovationTracker", () => {
  it("gives the same innovation number to the same structural mutation arising independently within a generation", () => {
    const tracker = new InnovationTracker(10, 5);
    expect(tracker.forConnection(1, 2)).toBe(tracker.forConnection(1, 2));
  });

  it("gives a fresh innovation number to the same mutation recurring in a later generation", () => {
    const tracker = new InnovationTracker(10, 5);
    const firstGen = tracker.forConnection(1, 2);
    tracker.startGeneration();
    const laterGen = tracker.forConnection(1, 2);
    expect(laterGen).not.toBe(firstGen);
  });

  it("node splits get a consistent node id and innovation numbers within a generation", () => {
    const tracker = new InnovationTracker(10, 5);
    expect(tracker.forNodeSplit(3)).toEqual(tracker.forNodeSplit(3));
  });

  it("never reuses an innovation number across the run, even after a generation reset", () => {
    const tracker = new InnovationTracker(0, 0);
    const seen = new Set<number>();
    for (let gen = 0; gen < 5; gen++) {
      tracker.startGeneration();
      const n = tracker.forConnection(gen, gen + 100); // a distinct mutation every generation
      expect(seen.has(n)).toBe(false);
      seen.add(n);
    }
  });
});
