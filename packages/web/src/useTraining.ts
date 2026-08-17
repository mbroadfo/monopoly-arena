import { useCallback, useEffect, useRef, useState } from "react";
import {
  computeFitnessContribution,
  countFinanceActions,
  createCoachedGenome,
  createNaiveBot,
  createNeatBot,
  createOrangeRushBot,
  createRandomBot,
  DECISION_INPUT_COUNT,
  DECISION_OUTPUT_COUNT,
  Game,
  InnovationTracker,
  mulberry32,
  netWorth,
  reproduce,
  speciate,
  type GameState,
  type Genome,
  type MutationRates,
  type Species,
  type SpeciesMember,
} from "@monopoly-arena/engine";
import { clearTrainingSession, loadTrainingSession, saveTrainingSession, type PersistedTrainingSession } from "./trainingPersistence";

// One genome per visible mini-board slot — a UI constraint (see MiniBoard/TrainingScreen), not an
// engine one. Small and watchable rather than the CLI trainer's usual 16-24: this is meant to be
// seen, not maximized for evolutionary throughput.
const POPULATION = 8;
const GAMES_PER_GENOME = 2;
// The CLI's DEFAULT_MUTATION_RATES (reproduction.ts: weights 0.8, addConnection 0.08, addNode
// 0.03) are tuned for converging to the single best bot over a long unwatched run — structural
// mutations stay rare so a large, mature population isn't constantly destabilized by half-tested
// topology. This is a different goal: a small (8-genome), *watched* population where the whole
// point is seeing structure actually emerge in a session, not squeezing out the last few points of
// fitness. Higher addConnection/addNode rates trade some convergence stability for a real chance of
// a hidden node appearing — and surviving to become champion — within a turbo-accelerated run.
const WEB_MUTATION_RATES: MutationRates = { weights: 0.8, addConnection: 0.25, addNode: 0.12 };
// Shorter than the CLI's default 1000 — a generation here is watched live, not left to run
// headless, so games that would otherwise drag on for the sake of a rare comeback get cut off
// sooner in exchange for the population actually finishing a generation in a reasonable time.
const MAX_TURNS_PER_GAME = 300;
// Mirrors neat/train.ts's own empirically-tuned DEFAULT_DISTANCE_THRESHOLD for this genome shape
// (21 inputs x 5 outputs) — not exported (it's a private constant there), so duplicated here the
// same way neatBot.ts already mirrors a couple of the engine's own private constants.
const DISTANCE_THRESHOLD = 0.25;
// Default pause between rounds of the round-robin scheduler so React actually gets to render each
// mini board's move before the next one happens — without this the games would still finish (the
// loop still awaits *something* every round), just invisibly, defeating the entire point. User-
// adjustable at runtime via the returned `speedMs`/`setSpeedMs` (see the speedRef comment below).
const DEFAULT_STEP_PAUSE_MS = 150;
export const MIN_STEP_PAUSE_MS = 30;
export const MAX_STEP_PAUSE_MS = 500;
// Real evolutionary progress (a hidden node actually appearing, fitness climbing meaningfully)
// needs dozens-to-hundreds of generations — the CLI trainer's own default run (16 population, 15
// generations, 4 games/genome — train-cli.ts) finishes unwatched in well under a minute, because
// nothing throttles it for human eyes. Paced for watching at even the fastest speed setting, the
// same generation count can take many minutes to hours, since long games commonly run 150-300+
// turns. Turbo mode is the escape hatch: skip pacing and stop pushing a board/leaderboard update
// every single round, so a session can actually reach the generation counts evolution needs,
// trading "watch every turn" for "watch the numbers climb fast" — still updating the UI often
// enough to feel alive, just not every round.
export const TURBO_UPDATE_EVERY_ROUNDS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One genome's fresh opponent lineup for a single game — same composition as neat/train.ts's
 * REFERENCE_ROSTER, just instantiated directly rather than through BatchPlayer/runBatchSimulation
 * (which plays a game to completion synchronously, incompatible with round-robin visualization). */
function makeGame(genome: Genome, seed: number): Game {
  const bots = [createNeatBot(genome), createNaiveBot(), createRandomBot(), createOrangeRushBot()];
  return new Game({ playerNames: ["Neat", "Naive", "Random", "OrangeRush"], bots, rng: mulberry32(seed) });
}

export interface GenerationStat {
  generation: number;
  bestFitness: number;
  averageFitness: number;
  speciesCount: number;
}

export interface LeaderboardEntry {
  slot: number;
  averageFitnessSoFar: number;
  gamesCompleted: number;
}

export interface TrainingSlot {
  slot: number;
  state: GameState | null; // null only before this slot's first game has produced a snapshot
  done: boolean; // this slot finished its games for the generation and is holding on its last state, waiting on the others
}

/** Everything a run needs to pick back up where it left off — held across pause/resume (and, via
 * `saveTrainingSession`, across closing the tab entirely) in a ref, not React state, since none of
 * it needs to trigger a re-render on its own. `champion`/`championGeneration`/`history` are the
 * single source of truth this session actually persists from — mirrored into React state
 * separately (see `start()`) purely for rendering, so persistence never depends on reading back a
 * `setState` call's result out of a stale closure. */
interface TrainingSession {
  population: Genome[];
  species: Species[];
  tracker: InnovationTracker;
  rng: () => number;
  seedBase: number;
  gen: number;
  championFitness: number;
  champion: Genome | null;
  championGeneration: number | null;
  history: GenerationStat[];
}

function freshSession(): TrainingSession {
  const seedBase = Date.now() % 1_000_000;
  const rng = mulberry32(seedBase);
  return {
    population: Array.from({ length: POPULATION }, () => createCoachedGenome(DECISION_INPUT_COUNT, DECISION_OUTPUT_COUNT, rng)),
    species: [],
    tracker: new InnovationTracker(DECISION_INPUT_COUNT * DECISION_OUTPUT_COUNT, DECISION_INPUT_COUNT + DECISION_OUTPUT_COUNT),
    rng,
    seedBase,
    gen: 0,
    championFitness: -Infinity,
    champion: null,
    championGeneration: null,
    history: [],
  };
}

/** Reconstructs a session from a previous run's saved state — `rng` restarts fresh from the same
 * `seedBase` (not a perfect resume of the exact prior random sequence, since a closure can't be
 * serialized, but a perfectly good one for continuing evolution forward) and the innovation
 * tracker's counters pick up exactly where they left off (see `InnovationTracker.snapshot()`).
 *
 * The three champion fields fall back the same way `freshSession()` initializes them, rather than
 * trusting `saved` to have them: a blob from before champion tracking existed (or any other
 * partial/incompatible save) would otherwise leave `championFitness` as `undefined`, and
 * `stats.bestFitness > undefined` is `false` in JS for *every* future generation — a resumed run
 * would silently stop ever recording a new champion, no matter how high fitness climbed
 * afterward, with nothing in the UI to explain why "Champion's network" stayed empty forever.
 */
function resumedSession(saved: PersistedTrainingSession): TrainingSession {
  return {
    population: saved.population,
    species: saved.species,
    tracker: new InnovationTracker(saved.trackerSnapshot.nextInnovation, saved.trackerSnapshot.nextNodeId),
    rng: mulberry32(saved.seedBase),
    seedBase: saved.seedBase,
    gen: saved.gen,
    championFitness: saved.championFitness ?? -Infinity,
    champion: saved.champion ?? null,
    championGeneration: saved.championGeneration ?? null,
    history: saved.history ?? [],
  };
}

/**
 * A from-scratch training orchestrator, deliberately separate from `trainNeat` (`neat/train.ts`).
 * `trainNeat` stays fast and fully synchronous for the CLI, which has no reason to slow down for
 * visualization — this hook instead composes the same lower-level, already-exported primitives
 * `trainNeat` itself uses internally (`Game`, `createNeatBot`, `speciate`/`reproduce`,
 * `InnovationTracker`, `createCoachedGenome`) with its own round-robin, `sleep`-paced scheduler, the
 * same relationship `useGame.ts` already has with `Game.playTurn()` — the engine does one
 * synchronous step, the web layer adds pacing on top, never the other way around.
 */
export function useTraining() {
  // Read once, on this hook's very first render — a resumed run's starting point for every piece
  // of state below, so the screen shows "you're at generation 192" immediately on load rather than
  // waiting for Start to be pressed. slots/leaderboard deliberately aren't restored from it: those
  // hold live, mid-generation game state that was never persisted (only completed generations are
  // saved — see the comment on the post-generation saveTrainingSession call below), so they start
  // at their normal empty defaults regardless of whether this is a fresh or resumed run.
  const [resumed] = useState(() => loadTrainingSession());
  // Whether a session (fresh or resumed) currently exists to resume — distinct from `running`,
  // which is only true while actively evolving. Drives the Start/Resume button label: "Start
  // training" only when there's truly nothing to pick back up, "Resume training" once paused with
  // a session still intact (see `start()`'s `if (!session.current)` and `reset()`).
  const [hasSession, setHasSession] = useState(() => resumed !== null);

  const [generation, setGeneration] = useState(() => resumed?.gen ?? 0);
  const [slots, setSlots] = useState<TrainingSlot[]>(
    Array.from({ length: POPULATION }, (_, slot) => ({ slot, state: null, done: false })),
  );
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [history, setHistory] = useState<GenerationStat[]>(() => resumed?.history ?? []);
  const [running, setRunning] = useState(false);
  const [champion, setChampion] = useState<Genome | null>(() => resumed?.champion ?? null);
  const [championGeneration, setChampionGeneration] = useState<number | null>(() => resumed?.championGeneration ?? null);
  const [speedMs, setSpeedMsState] = useState(DEFAULT_STEP_PAUSE_MS);

  const stopRequested = useRef(false);
  const runningRef = useRef(false);
  // Lazily built from `resumed` on first render only, same as the useState calls above — mutating
  // a ref during render is fine specifically for this "compute once, on mount" pattern (session.
  // current is only ever null on the very first render of a component instance, so this can't
  // clobber real in-progress training on any later render).
  const session = useRef<TrainingSession | null>(null);
  if (session.current === null && resumed) {
    session.current = resumedSession(resumed);
  }
  // The in-flight round-robin loop reads pacing from this ref, not the `speedMs` state directly —
  // state only updates on the next render, so a loop already mid-`await` wouldn't see a slider
  // drag until its *following* round regardless, but reading through a ref makes that immediate
  // rather than needing a whole extra render to land, and needs no dependency-array churn on
  // `runGeneration`/`start` the way closing over `speedMs` state directly would.
  const speedRef = useRef(DEFAULT_STEP_PAUSE_MS);
  const setSpeedMs = useCallback((ms: number) => {
    speedRef.current = ms;
    setSpeedMsState(ms);
  }, []);
  // Same live-mid-loop-mutable pattern as speedRef — toggling turbo takes effect on the very next
  // round of an already-running loop, not just the next time Start is pressed.
  const [turbo, setTurboState] = useState(false);
  const turboRef = useRef(false);
  const setTurbo = useCallback((value: boolean) => {
    turboRef.current = value;
    setTurboState(value);
  }, []);
  // Bumped by reset() so an in-flight start() loop — mid-`await` when reset happens — can tell its
  // own session was discarded and stop touching React state, instead of resurrecting stale data a
  // moment after reset already cleared it.
  const sessionId = useRef(0);

  /** Plays one generation's worth of games for the whole population, round-robin across up to
   * POPULATION concurrently-active `Game`s, pushing a snapshot of every active slot's state to
   * React once per round so all the mini-boards visibly progress together rather than one at a
   * time. Returns the next generation's population plus this generation's stats. */
  const runGeneration = useCallback(
    async (
      population: Genome[],
      species: Species[],
      tracker: InnovationTracker,
      rng: () => number,
      gen: number,
      seedBase: number,
      mySessionId: number,
    ): Promise<{ nextPopulation: Genome[]; nextSpecies: Species[]; stats: GenerationStat; best: Genome }> => {
      tracker.startGeneration();
      const generationSeed = seedBase + gen * 100_000;

      const fitnessSums = population.map(() => 0);
      const gamesCompleted = population.map(() => 0);
      const turnsPlayed = population.map(() => 0);
      const activeGames: (Game | null)[] = population.map((genome, i) => makeGame(genome, generationSeed + i * 7919));
      // Frozen on a slot's final state once its games are done, rather than going back to null —
      // a finished slot still has something worth looking at while it waits on the others.
      const snapshots: GameState[] = activeGames.map((g) => g!.getSnapshot());
      let round = 0;

      while (activeGames.some((g) => g !== null) && !stopRequested.current && sessionId.current === mySessionId) {
        round++;
        for (let i = 0; i < activeGames.length; i++) {
          const game = activeGames[i];
          if (!game) continue; // done for the generation — snapshots[i] stays frozen

          if (!game.isGameOver() && turnsPlayed[i] < MAX_TURNS_PER_GAME) {
            game.playTurn();
            turnsPlayed[i]++;
          }

          if (game.isGameOver() || turnsPlayed[i] >= MAX_TURNS_PER_GAME) {
            const finalState = game.getSnapshot();
            const neatId = finalState.players[0].id; // seat 0 is always this slot's evolving genome
            const won = finalState.winnerId === neatId;
            fitnessSums[i] += computeFitnessContribution(netWorth(finalState, neatId), countFinanceActions(finalState, "Neat"), won);
            gamesCompleted[i]++;

            const nextGame =
              gamesCompleted[i] < GAMES_PER_GENOME ? makeGame(population[i], generationSeed + i * 7919 + gamesCompleted[i] * 104_729) : null;
            activeGames[i] = nextGame;
            snapshots[i] = nextGame ? nextGame.getSnapshot() : finalState;
            turnsPlayed[i] = 0;
          } else {
            snapshots[i] = game.getSnapshot();
          }
        }

        if (sessionId.current !== mySessionId) break; // reset landed mid-round — don't touch state

        const isTurbo = turboRef.current;
        const stillActive = activeGames.some((g) => g !== null);
        // Full pacing skips this in favor of updating every round; turbo only pushes a board/
        // leaderboard update periodically (plus always on the generation's final round, so it
        // never ends looking stale) — the board renders are the expensive, unnecessary-at-speed
        // part, not the game logic itself.
        if (!isTurbo || round % TURBO_UPDATE_EVERY_ROUNDS === 0 || !stillActive) {
          setSlots(activeGames.map((g, i) => ({ slot: i, state: snapshots[i], done: g === null })));
          setLeaderboard(
            population
              .map((_, i) => ({
                slot: i,
                averageFitnessSoFar: gamesCompleted[i] > 0 ? fitnessSums[i] / gamesCompleted[i] : 0,
                gamesCompleted: gamesCompleted[i],
              }))
              .sort((a, b) => b.averageFitnessSoFar - a.averageFitnessSoFar),
          );
        }

        // sleep(0) still yields to the event loop every round (keeping the tab responsive to the
        // Pause button and letting the throttled re-renders above actually paint) without adding
        // real delay — turbo's speed comes from skipping pacing, not from blocking less often.
        await sleep(isTurbo ? 0 : speedRef.current);
      }

      const members: SpeciesMember[] = population.map((genome, i) => ({
        genome,
        fitness: gamesCompleted[i] > 0 ? fitnessSums[i] / gamesCompleted[i] : 0,
      }));
      const best = members.reduce((a, b) => (b.fitness > a.fitness ? b : a));
      const averageFitness = members.reduce((sum, m) => sum + m.fitness, 0) / members.length;
      const nextSpecies = speciate(members, species, DISTANCE_THRESHOLD);
      const stats: GenerationStat = { generation: gen, bestFitness: best.fitness, averageFitness, speciesCount: nextSpecies.length };
      const nextPopulation = reproduce(nextSpecies, population.length, rng, tracker, WEB_MUTATION_RATES);

      return { nextPopulation, nextSpecies, stats, best: best.genome };
    },
    [],
  );

  /** Starts a fresh run, or resumes one paused via `pause()` — `session` survives a pause, so a
   * resumed run picks the population back up mid-evolution instead of starting over from scratch. */
  const start = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    stopRequested.current = false;
    setRunning(true);
    const mySessionId = sessionId.current;

    if (!session.current) {
      session.current = freshSession();
      setHasSession(true);
    }
    const s = session.current;

    while (!stopRequested.current && sessionId.current === mySessionId) {
      const { nextPopulation, nextSpecies, stats, best } = await runGeneration(s.population, s.species, s.tracker, s.rng, s.gen, s.seedBase, mySessionId);
      if (sessionId.current !== mySessionId) break; // reset landed mid-generation — discard

      setHistory((h) => [...h, stats]);
      s.history.push(stats);
      if (stats.bestFitness > s.championFitness) {
        s.championFitness = stats.bestFitness;
        s.champion = best;
        s.championGeneration = s.gen;
        setChampion(best);
        setChampionGeneration(s.gen);
      }
      if (stopRequested.current) break;
      s.population = nextPopulation;
      s.species = nextSpecies;
      s.gen++;
      setGeneration(s.gen);

      // Checkpoint after every completed generation — a crashed tab or a turbo run left going
      // overnight without anyone clicking Pause first loses at most the in-progress generation,
      // never more. Only fully-completed generations are saved (no mid-generation game state), so
      // a resumed run's boards/leaderboard start empty until the next generation actually plays.
      saveTrainingSession({
        population: s.population,
        species: s.species,
        trackerSnapshot: s.tracker.snapshot(),
        seedBase: s.seedBase,
        gen: s.gen,
        championFitness: s.championFitness,
        champion: s.champion,
        championGeneration: s.championGeneration,
        history: s.history,
      });
    }

    if (sessionId.current === mySessionId) {
      runningRef.current = false;
      setRunning(false);
    }
  }, [runGeneration]);

  /** Pauses after the in-progress round finishes — the population/species/innovation-tracker
   * state stays intact in `session`, so `start()` resumes evolution rather than restarting it. */
  const pause = useCallback(() => {
    stopRequested.current = true;
  }, []);

  // Switching to the Play tab unmounts TrainingScreen entirely (App.tsx renders one screen or the
  // other, never both) — without this, an in-flight start() loop isn't tied to the component's
  // lifecycle at all and would keep running invisibly in the background (still playing games,
  // still evolving, still auto-saving) with nothing on screen to show it. Worse: coming back to
  // Train and clicking "Resume training" would then start a *second*, independent loop racing the
  // still-running original for the same localStorage key. Auto-pausing on unmount — same
  // stopRequested flag pause() sets, so it's the exact same safe, resumable stop — makes
  // navigating away behave like clicking Pause instead of leaving an invisible runaway loop.
  useEffect(() => {
    return () => {
      stopRequested.current = true;
    };
  }, []);

  const reset = useCallback(() => {
    stopRequested.current = true;
    runningRef.current = false;
    session.current = null;
    sessionId.current += 1;
    clearTrainingSession(); // otherwise the next page load would silently resume the discarded run
    setRunning(false);
    setHasSession(false);
    setGeneration(0);
    setSlots(Array.from({ length: POPULATION }, (_, slot) => ({ slot, state: null, done: false })));
    setLeaderboard([]);
    setHistory([]);
    setChampion(null);
    setChampionGeneration(null);
  }, []);

  return {
    generation,
    slots,
    leaderboard,
    history,
    running,
    hasSession,
    champion,
    championGeneration,
    start,
    pause,
    reset,
    population: POPULATION,
    gamesPerGenome: GAMES_PER_GENOME,
    speedMs,
    setSpeedMs,
    turbo,
    setTurbo,
  };
}
