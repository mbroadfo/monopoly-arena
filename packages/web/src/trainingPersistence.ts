import type { GenerationStat } from "./useTraining";
import type { Genome, Species } from "@monopoly-arena/engine";

// Bumped if the saved shape ever changes incompatibly — a stale/foreign blob under an old key is
// just ignored (treated as "no saved session") rather than crashing on a shape it doesn't expect.
const STORAGE_KEY = "monopoly-arena:training-session:v1";

/** Everything a `TrainingSession` needs to resume, in a plain-data shape `JSON.stringify` can
 * round-trip. Notably absent: `rng` (a closure — can't serialize a function; a resumed run just
 * seeds a fresh one from the same `seedBase`, which is fine for continuing evolution, just not for
 * reproducing the exact prior random sequence) and the innovation tracker's per-generation dedup
 * caches (cleared every generation anyway, so a resumed run starting its next generation fresh has
 * empty caches regardless — only the two monotonic counters, via `InnovationTracker.snapshot()`,
 * actually need to survive). */
export interface PersistedTrainingSession {
  population: Genome[];
  species: Species[];
  trackerSnapshot: { nextInnovation: number; nextNodeId: number };
  seedBase: number;
  gen: number;
  championFitness: number;
  champion: Genome | null;
  championGeneration: number | null;
  history: GenerationStat[];
}

export function saveTrainingSession(data: PersistedTrainingSession): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (err) {
    // Storage can be full, disabled (private browsing in some browsers), or unavailable — losing
    // the ability to resume next time isn't worth crashing the training run over.
    console.warn("Couldn't save training session:", err);
  }
}

export function loadTrainingSession(): PersistedTrainingSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedTrainingSession;
  } catch (err) {
    console.warn("Couldn't load saved training session:", err);
    return null;
  }
}

export function clearTrainingSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}
