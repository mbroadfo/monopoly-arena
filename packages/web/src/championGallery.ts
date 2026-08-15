import type { Genome } from "@monopoly-arena/engine";

// Separate from trainingPersistence.ts's single auto-resumed session on purpose: this is a
// user-curated list of individually-named saves ("keep this one around"), not "don't lose
// progress if the tab closes." A champion here survives resetting the training run, starting a
// new one, or the auto-saved session itself being cleared — the two are independent by design.
const STORAGE_KEY = "monopoly-arena:champions:v1";

export interface SavedChampion {
  id: string;
  name: string;
  genome: Genome;
  fitness: number;
  generation: number;
  savedAt: number;
}

export function listChampions(): SavedChampion[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedChampion[];
    // Newest first — the one you just saved (almost always the one you want to compare against
    // next) shouldn't require scrolling past every older entry to find.
    return parsed.sort((a, b) => b.savedAt - a.savedAt);
  } catch (err) {
    console.warn("Couldn't load saved champions:", err);
    return [];
  }
}

function persist(champions: SavedChampion[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(champions));
  } catch (err) {
    console.warn("Couldn't save champion:", err);
  }
}

export function saveChampion(genome: Genome, name: string, fitness: number, generation: number): SavedChampion {
  const entry: SavedChampion = {
    id: crypto.randomUUID(),
    name,
    genome,
    fitness,
    generation,
    savedAt: Date.now(),
  };
  persist([...listChampions(), entry]);
  return entry;
}

export function deleteChampion(id: string): void {
  persist(listChampions().filter((c) => c.id !== id));
}
