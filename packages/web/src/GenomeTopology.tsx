import { useMemo, useState } from "react";
import type { Genome } from "@monopoly-arena/engine";

// Mirrors encodeDecisionFeatures' exact field order (neat/encoding.ts) — the 12 always-present
// "global" features followed by the 9 "candidate" features (zeroed, not omitted, for the one
// candidate-less decision: jail). Kept here rather than exported from the engine since this is
// purely a display concern, not something engine logic depends on.
const INPUT_LABELS = [
  "Cash",
  "Owned %",
  "Monopolies",
  "Opponent cash",
  "Opponent monopolies",
  "Active players",
  "Turn",
  "Houses left",
  "Hotels left",
  "Rent threat",
  "Jail progress",
  "Unowned %",
  "Price",
  "Group size",
  "Group progress",
  "Is RR/utility",
  "Base rent",
  "Improvement",
  "Mortgaged",
  "Affordability",
  "Has candidate",
];
// Order matches OUTPUT_PROPERTY/OUTPUT_JAIL/OUTPUT_MORTGAGE/OUTPUT_UNMORTGAGE/OUTPUT_SELL_HOUSE.
const OUTPUT_LABELS = ["Buy / bid", "Pay to leave jail", "Mortgage", "Unmortgage", "Sell house"];

// Wide and short — this sits beneath the mini-board grid, using the boards' own column width
// (up to 1360px) rather than the sidebar's narrow 440px, so it needs comfortable horizontal room
// but as little height as the 21 (hover-revealed, not permanently labeled) input rows can spare.
const VIEW_WIDTH = 1200;
const VIEW_HEIGHT = 210;
const OUTPUT_LABEL_COL = 118;
const LEFT_MARGIN = 10;
const NODE_R = 3;

/**
 * Each node's horizontal position: longest path from any input, in enabled-connection hops —
 * exactly the quantity `topologicalOrder` (genome.ts) already relies on for evaluation order,
 * recomputed here layer-by-layer instead of node-by-node since the diagram wants nodes grouped
 * into columns, not just *an* order. Outputs are pinned to the rightmost column regardless of
 * their own longest path, so that column stays a straight line even when one output happens to be
 * "closer" to the inputs than another.
 */
function computeLayers(genome: Genome): { layer: Map<number, number>; maxLayer: number } {
  const layer = new Map<number, number>();
  for (const n of genome.nodes) if (n.kind === "input") layer.set(n.id, 0);

  let changed = true;
  for (let guard = 0; changed && guard < 200; guard++) {
    changed = false;
    for (const c of genome.connections) {
      if (!c.enabled) continue;
      const toNode = genome.nodes.find((n) => n.id === c.to);
      if (toNode?.kind === "output") continue; // outputs get their own fixed column below
      const fromLayer = layer.get(c.from);
      if (fromLayer === undefined) continue;
      if ((layer.get(c.to) ?? -1) < fromLayer + 1) {
        layer.set(c.to, fromLayer + 1);
        changed = true;
      }
    }
  }

  const hiddenLayers = genome.nodes.filter((n) => n.kind === "hidden").map((n) => layer.get(n.id) ?? 1);
  const outputLayer = (hiddenLayers.length > 0 ? Math.max(...hiddenLayers) : 0) + 1;
  for (const n of genome.nodes) {
    if (n.kind === "output") layer.set(n.id, outputLayer);
    else if (n.kind === "hidden" && !layer.has(n.id)) layer.set(n.id, 1); // unreached — no live input path
  }
  return { layer, maxLayer: outputLayer };
}

function labelFor(kind: "input" | "hidden" | "output", index: number): string {
  if (kind === "input") return INPUT_LABELS[index] ?? `Input ${index}`;
  if (kind === "output") return OUTPUT_LABELS[index] ?? `Output ${index}`;
  return `Hidden ${index + 1}`;
}

/** Every node feeding into `nodeId`, directly or transitively, via enabled connections — "what
 * it's made of." Walking backward through `to === current` edges. */
function ancestorsOf(nodeId: number, connections: Genome["connections"]): Set<number> {
  const result = new Set<number>();
  const stack = [nodeId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const c of connections) {
      if (!c.enabled || c.to !== current || result.has(c.from)) continue;
      result.add(c.from);
      stack.push(c.from);
    }
  }
  return result;
}

/** Every node `nodeId` feeds into, directly or transitively — "what this leads to." Mirror of
 * `ancestorsOf`, walking forward through `from === current` edges instead. */
function descendantsOf(nodeId: number, connections: Genome["connections"]): Set<number> {
  const result = new Set<number>();
  const stack = [nodeId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const c of connections) {
      if (!c.enabled || c.from !== current || result.has(c.to)) continue;
      result.add(c.to);
      stack.push(c.to);
    }
  }
  return result;
}

/**
 * Renders a genome's actual evolved structure — literally what the network looks like, not just
 * how well it scores. A coached/early genome is close to fully-connected input-to-output (every
 * input feeding every output directly, since there's no hidden layer yet to route through) — that's
 * a genuinely dense mesh no static layout makes tidy, so hovering any node traces its full
 * ancestry (what feeds it, transitively — "what it's made of") and descent (what it feeds into),
 * highlighting that whole subgraph and revealing the name of every node caught up in it, while
 * fading everything unrelated. Watch successive champions to see `addNode`/`addConnection`
 * mutations actually sparsify and deepen the topology.
 */
export function GenomeTopology({ genome }: { genome: Genome }) {
  const [hoverId, setHoverId] = useState<number | null>(null);

  const { positions, maxLayer } = useMemo(() => {
    const { layer, maxLayer } = computeLayers(genome);
    const plotLeft = LEFT_MARGIN;
    const plotRight = VIEW_WIDTH - OUTPUT_LABEL_COL;
    const layerX = (l: number) => (maxLayer === 0 ? (plotLeft + plotRight) / 2 : plotLeft + (l / maxLayer) * (plotRight - plotLeft));

    const byLayer = new Map<number, typeof genome.nodes>();
    for (const n of genome.nodes) {
      const l = layer.get(n.id) ?? 0;
      if (!byLayer.has(l)) byLayer.set(l, []);
      byLayer.get(l)!.push(n);
    }
    // Stable across re-renders — a genome's node array only ever grows (new ids appended), never
    // reorders, so sorting by id keeps a given node in the same vertical slot generation to
    // generation instead of visually jumping around as the population evolves.
    for (const nodes of byLayer.values()) nodes.sort((a, b) => a.id - b.id);

    const positions = new Map<number, { x: number; y: number }>();
    for (const [l, nodes] of byLayer) {
      const x = layerX(l);
      nodes.forEach((n, i) => {
        const y = nodes.length === 1 ? VIEW_HEIGHT / 2 : 10 + (i / (nodes.length - 1)) * (VIEW_HEIGHT - 20);
        positions.set(n.id, { x, y });
      });
    }
    return { positions, maxLayer };
  }, [genome]);

  const nodeKind = useMemo(() => new Map(genome.nodes.map((n) => [n.id, n.kind])), [genome]);
  const nodeIndexWithinKind = useMemo(() => {
    const counters = { input: 0, hidden: 0, output: 0 };
    const map = new Map<number, number>();
    for (const n of [...genome.nodes].sort((a, b) => a.id - b.id)) {
      map.set(n.id, counters[n.kind]);
      counters[n.kind]++;
    }
    return map;
  }, [genome]);

  const outputNodes = useMemo(() => genome.nodes.filter((n) => n.kind === "output").sort((a, b) => a.id - b.id), [genome]);
  const maxWeight = Math.max(0.001, ...genome.connections.filter((c) => c.enabled).map((c) => Math.abs(c.weight)));
  const plotRight = VIEW_WIDTH - OUTPUT_LABEL_COL;
  const hiddenCount = genome.nodes.filter((n) => n.kind === "hidden").length;
  const activeCount = genome.connections.filter((c) => c.enabled).length;

  // The whole subgraph "made of" (ancestors) and "leading to" (descendants) the hovered node —
  // recomputed only on hover, not per render of the idle diagram.
  const related = useMemo(() => {
    if (hoverId === null) return null;
    const ancestors = ancestorsOf(hoverId, genome.connections);
    const descendants = descendantsOf(hoverId, genome.connections);
    return new Set([hoverId, ...ancestors, ...descendants]);
  }, [hoverId, genome]);

  return (
    <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} className="genome-topology-svg">
      {genome.connections.map((c) => {
        const from = positions.get(c.from);
        const to = positions.get(c.to);
        if (!from || !to) return null;
        const touches = related !== null && related.has(c.from) && related.has(c.to);
        return (
          <line
            key={c.innovation}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            className={`genome-topology-conn ${c.weight >= 0 ? "positive" : "negative"} ${c.enabled ? "" : "disabled"} ${
              related === null ? "" : touches ? "touched" : "dimmed"
            }`}
            strokeWidth={(c.enabled ? Math.max(0.5, (Math.abs(c.weight) / maxWeight) * 2.2) : 0.5) * (touches ? 1.6 : 1)}
          />
        );
      })}

      {Array.from(positions.entries()).map(([id, pos]) => (
        <circle
          key={id}
          cx={pos.x}
          cy={pos.y}
          r={hoverId === id ? NODE_R * 1.7 : NODE_R}
          className={`genome-topology-node ${nodeKind.get(id)} ${related?.has(id) ? "related" : ""}`}
          onMouseEnter={() => setHoverId(id)}
          onMouseLeave={() => setHoverId((current) => (current === id ? null : current))}
        />
      ))}

      {outputNodes.map((n) => {
        const pos = positions.get(n.id);
        if (!pos) return null;
        return (
          <text
            key={n.id}
            x={plotRight + 6}
            y={pos.y + 3}
            className={`genome-topology-label output ${hoverId === n.id ? "active" : ""}`}
            onMouseEnter={() => setHoverId(n.id)}
            onMouseLeave={() => setHoverId((current) => (current === n.id ? null : current))}
          >
            {labelFor("output", nodeIndexWithinKind.get(n.id)!)}
          </text>
        );
      })}

      {/* Every input/hidden node caught up in the hover trace gets its name revealed here — not
          just the hovered node itself — so hovering a hidden node visibly names every input "it's
          made of," not just highlights anonymous dots. Outputs are excluded: they already always
          show their own permanent label (above), so this would just draw a duplicate on top. */}
      {related !== null &&
        Array.from(related)
          .filter((id) => nodeKind.get(id) !== "output")
          .map((id) => {
            const pos = positions.get(id);
            const kind = nodeKind.get(id);
            if (!pos || !kind) return null;
            const text = labelFor(kind, nodeIndexWithinKind.get(id)!);
            return (
              <g key={id} className={`genome-topology-tooltip ${id === hoverId ? "primary" : ""}`}>
                <rect x={pos.x + 7} y={pos.y - 10} width={text.length * 5.1 + 8} height={14} rx={3} />
                <text x={pos.x + 11} y={pos.y + 0.5}>
                  {text}
                </text>
              </g>
            );
          })}

      <text x={VIEW_WIDTH / 2} y={VIEW_HEIGHT - 4} textAnchor="middle" className="genome-topology-caption">
        {hiddenCount} hidden · {activeCount} connections
        {maxLayer > 1 ? ` · ${maxLayer - 1} deep` : ""} · hover to trace
      </text>
    </svg>
  );
}
