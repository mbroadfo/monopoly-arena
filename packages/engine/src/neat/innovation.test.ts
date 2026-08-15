import { describe, expect, it } from "vitest";
import { InnovationTracker } from "./innovation.js";

describe("InnovationTracker", () => {
  it("snapshots the counters as constructed, before anything is assigned", () => {
    const tracker = new InnovationTracker(10, 5);
    expect(tracker.snapshot()).toEqual({ nextInnovation: 10, nextNodeId: 5 });
  });

  it("reflects connection and node-split assignments in the snapshot", () => {
    const tracker = new InnovationTracker(10, 5);
    tracker.forConnection(1, 2); // consumes innovation 10
    tracker.forNodeSplit(10); // consumes node id 5, innovations 11 and 12
    expect(tracker.snapshot()).toEqual({ nextInnovation: 13, nextNodeId: 6 });
  });

  it("resuming a tracker from a snapshot continues the same counter sequence, not a fresh one", () => {
    const original = new InnovationTracker(10, 5);
    original.forConnection(1, 2);
    original.forNodeSplit(10);
    const snapshot = original.snapshot();

    const resumed = new InnovationTracker(snapshot.nextInnovation, snapshot.nextNodeId);
    expect(resumed.forConnection(3, 4)).toBe(13); // continues from where the original left off
  });

  it("a fresh generation's dedup cache doesn't need to survive resuming — the counters alone are sufficient", () => {
    const original = new InnovationTracker(10, 5);
    original.forConnection(1, 2); // innovation 10, cached under "1->2" this generation
    const snapshot = original.snapshot();

    const resumed = new InnovationTracker(snapshot.nextInnovation, snapshot.nextNodeId);
    // A resumed tracker has no memory of "1->2" already being seen this generation — correct,
    // since startGeneration() would have cleared that cache at the same point anyway, so it
    // assigns the next available number (11) rather than recognizing a dedup hit.
    expect(resumed.forConnection(1, 2)).toBe(11);
  });
});
