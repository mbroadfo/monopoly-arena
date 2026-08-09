import type { Rng } from "../dice.js";
import { InnovationTracker } from "./innovation.js";
import type { ConnectionGene, Genome, NodeGene } from "./types.js";

const INITIAL_WEIGHT_SCALE = 1;
const WEIGHT_PERTURB_CHANCE = 0.9; // vs. a full reset the other 10% of the time
const WEIGHT_PERTURB_STD = 0.5;
const WEIGHT_RESET_SCALE = 1;

/** Box-Muller — Rng is uniform [0,1), weight perturbation wants a roughly gaussian step. */
function gaussianRandom(rng: Rng): number {
  const u1 = Math.max(rng(), 1e-9); // avoid log(0)
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * NEAT's standard starting point: every input connected directly to every output, no hidden
 * nodes — evolution grows structure from here rather than starting from an arbitrary size.
 * Input node ids are 0..inputCount-1, output node ids are inputCount..inputCount+outputCount-1,
 * matching the id ranges `InnovationTracker` should be constructed to continue from.
 */
export function createMinimalGenome(inputCount: number, outputCount: number, rng: Rng): Genome {
  const nodes: NodeGene[] = [];
  for (let i = 0; i < inputCount; i++) nodes.push({ id: i, kind: "input" });
  for (let o = 0; o < outputCount; o++) nodes.push({ id: inputCount + o, kind: "output" });

  const connections: ConnectionGene[] = [];
  let innovation = 0;
  for (let i = 0; i < inputCount; i++) {
    for (let o = 0; o < outputCount; o++) {
      connections.push({
        innovation: innovation++,
        from: i,
        to: inputCount + o,
        weight: (rng() * 2 - 1) * INITIAL_WEIGHT_SCALE,
        enabled: true,
      });
    }
  }
  return { nodes, connections };
}

/** Nodes in dependency order over *enabled* connections only — safe because mutateAddConnection
 * never introduces a cycle, so this graph is guaranteed a DAG. Nodes unreachable from any input
 * (e.g. freshly-disconnected by a would-be future mutation) still appear, just wherever Kahn's
 * algorithm's zero-in-degree frontier happens to reach them. */
function topologicalOrder(genome: Genome): number[] {
  const inDegree = new Map<number, number>();
  const adjacency = new Map<number, number[]>();
  for (const node of genome.nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }
  for (const c of genome.connections) {
    if (!c.enabled) continue;
    adjacency.get(c.from)?.push(c.to);
    inDegree.set(c.to, (inDegree.get(c.to) ?? 0) + 1);
  }

  const queue = genome.nodes.map((n) => n.id).filter((id) => inDegree.get(id) === 0);
  const order: number[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const next of adjacency.get(id) ?? []) {
      const remaining = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }
  return order;
}

/** A single feedforward pass: inputs in node-id order, tanh activation on hidden/output nodes,
 * outputs returned in node-id order. */
export function evaluate(genome: Genome, inputs: number[]): number[] {
  const inputNodes = genome.nodes.filter((n) => n.kind === "input").sort((a, b) => a.id - b.id);
  if (inputs.length !== inputNodes.length) {
    throw new Error(`evaluate: expected ${inputNodes.length} inputs, got ${inputs.length}`);
  }

  const incomingByNode = new Map<number, ConnectionGene[]>();
  for (const c of genome.connections) {
    if (!c.enabled) continue;
    if (!incomingByNode.has(c.to)) incomingByNode.set(c.to, []);
    incomingByNode.get(c.to)!.push(c);
  }

  const values = new Map<number, number>();
  inputNodes.forEach((node, i) => values.set(node.id, inputs[i]));

  for (const nodeId of topologicalOrder(genome)) {
    if (values.has(nodeId)) continue; // input node, already seeded
    const incoming = incomingByNode.get(nodeId) ?? [];
    let sum = 0;
    for (const c of incoming) sum += (values.get(c.from) ?? 0) * c.weight;
    values.set(nodeId, Math.tanh(sum));
  }

  const outputNodes = genome.nodes.filter((n) => n.kind === "output").sort((a, b) => a.id - b.id);
  return outputNodes.map((n) => values.get(n.id) ?? 0);
}

export function mutateWeights(genome: Genome, rng: Rng): Genome {
  const connections = genome.connections.map((c) => {
    const weight =
      rng() < WEIGHT_PERTURB_CHANCE ? c.weight + gaussianRandom(rng) * WEIGHT_PERTURB_STD : (rng() * 2 - 1) * WEIGHT_RESET_SCALE;
    return { ...c, weight };
  });
  return { nodes: genome.nodes, connections };
}

/** Adding edge from->to would create a cycle iff `to` can already reach `from` via existing
 * enabled connections (including from === to itself). */
function wouldCreateCycle(genome: Genome, from: number, to: number): boolean {
  if (from === to) return true;
  const stack = [to];
  const visited = new Set<number>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === from) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const c of genome.connections) {
      if (c.enabled && c.from === current) stack.push(c.to);
    }
  }
  return false;
}

export function mutateAddConnection(genome: Genome, rng: Rng, tracker: InnovationTracker): Genome {
  const existing = new Set(genome.connections.map((c) => `${c.from}->${c.to}`));
  const candidates: [number, number][] = [];
  for (const a of genome.nodes) {
    if (a.kind === "output") continue; // nothing feeds forward from an output in this design
    for (const b of genome.nodes) {
      if (b.kind === "input" || a.id === b.id) continue;
      if (existing.has(`${a.id}->${b.id}`)) continue;
      if (wouldCreateCycle(genome, a.id, b.id)) continue;
      candidates.push([a.id, b.id]);
    }
  }
  if (candidates.length === 0) return genome;

  const [from, to] = candidates[Math.floor(rng() * candidates.length)];
  const newConnection: ConnectionGene = {
    innovation: tracker.forConnection(from, to),
    from,
    to,
    weight: (rng() * 2 - 1) * INITIAL_WEIGHT_SCALE,
    enabled: true,
  };
  return { nodes: genome.nodes, connections: [...genome.connections, newConnection] };
}

export function mutateAddNode(genome: Genome, rng: Rng, tracker: InnovationTracker): Genome {
  const enabled = genome.connections.filter((c) => c.enabled);
  if (enabled.length === 0) return genome;

  const target = enabled[Math.floor(rng() * enabled.length)];
  const { nodeId, inInnovation, outInnovation } = tracker.forNodeSplit(target.innovation);

  const nodes: NodeGene[] = [...genome.nodes, { id: nodeId, kind: "hidden" }];
  const connections: ConnectionGene[] = genome.connections.map((c) =>
    c.innovation === target.innovation ? { ...c, enabled: false } : c,
  );
  // Weight-preserving split: the new in-connection carries weight 1 and the new out-connection
  // carries the original weight — the standard NEAT convention for minimizing disruption at the
  // instant of mutation. This is an approximation, not an exact invariant: since tanh is applied
  // at the new hidden node too (see `evaluate`), the split still composes an extra tanh into the
  // path (tanh(tanh(x)) != tanh(x)), so the network's output shifts slightly even before any
  // subsequent weight mutation — smallest for inputs near 0, where tanh is closest to linear.
  connections.push(
    { innovation: inInnovation, from: target.from, to: nodeId, weight: 1, enabled: true },
    { innovation: outInnovation, from: nodeId, to: target.to, weight: target.weight, enabled: true },
  );
  return { nodes, connections };
}
