export type NodeKind = "input" | "hidden" | "output";

export interface NodeGene {
  id: number;
  kind: NodeKind;
}

export interface ConnectionGene {
  /** Identifies this connection's historical origin — the basis for aligning genes between two
   * genomes during crossover/distance comparison, even when their topologies have diverged. See
   * innovation.ts for how these are assigned. */
  innovation: number;
  from: number;
  to: number;
  weight: number;
  enabled: boolean;
}

export interface Genome {
  nodes: NodeGene[];
  connections: ConnectionGene[];
}
