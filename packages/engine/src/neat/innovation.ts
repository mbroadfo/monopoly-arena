/**
 * Tracks two kinds of identity that must stay stable for the *entire* training run, plus a
 * dedup cache that resets every generation. See the plan's Context/Approach for the full
 * reasoning — the short version: innovation numbers and node ids are compared *across*
 * generations (species representatives and champions persist), so the counters that hand them
 * out must never restart; only the "have I seen this exact mutation yet this generation" lookup
 * should reset, so the same structural mutation arising independently in different genomes within
 * one generation is recognized as the same historical event.
 */
export class InnovationTracker {
  private nextInnovation: number;
  private nextNodeId: number;
  private connectionCache = new Map<string, number>();
  private splitCache = new Map<number, { nodeId: number; inInnovation: number; outInnovation: number }>();

  constructor(startingInnovation: number, startingNodeId: number) {
    this.nextInnovation = startingInnovation;
    this.nextNodeId = startingNodeId;
  }

  /** Call once at the start of every generation — clears only the dedup cache, not the counters. */
  startGeneration(): void {
    this.connectionCache.clear();
    this.splitCache.clear();
  }

  /** Innovation number for an add-connection mutation between two existing node ids. */
  forConnection(from: number, to: number): number {
    const key = `${from}->${to}`;
    const cached = this.connectionCache.get(key);
    if (cached !== undefined) return cached;
    const innovation = this.nextInnovation++;
    this.connectionCache.set(key, innovation);
    return innovation;
  }

  /** New node id + the two new connections' innovation numbers for splitting an existing
   * connection (identified by its own innovation number) via an add-node mutation. */
  forNodeSplit(splitInnovation: number): { nodeId: number; inInnovation: number; outInnovation: number } {
    const cached = this.splitCache.get(splitInnovation);
    if (cached) return cached;
    const created = {
      nodeId: this.nextNodeId++,
      inInnovation: this.nextInnovation++,
      outInnovation: this.nextInnovation++,
    };
    this.splitCache.set(splitInnovation, created);
    return created;
  }
}
