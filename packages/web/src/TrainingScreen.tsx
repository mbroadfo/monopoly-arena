import { useState } from "react";
import type { Genome, PlayerState } from "@monopoly-arena/engine";
import { BankrollChart } from "./BankrollChart";
import { deleteChampion, listChampions, saveChampion, type SavedChampion } from "./championGallery";
import { GenomeTopology } from "./GenomeTopology";
import { MiniBoard } from "./MiniBoard";
import { ViewSwitch, type View } from "./ViewSwitch";
import { PLAYER_COLORS } from "./boardLayout";
import { MAX_STEP_PAUSE_MS, MIN_STEP_PAUSE_MS, useTraining } from "./useTraining";

// BankrollChart is generically typed around "a cash number per player per turn" — reused here as
// "a fitness number per series per generation" via two placeholder PlayerState-shaped entries
// (only .id/.name are actually read by the chart; the rest are unused filler to satisfy the type).
const FITNESS_SERIES: PlayerState[] = [
  { id: "best", name: "Best", cash: 0, position: 0, inJail: false, jailTurns: 0, bankrupt: false, getOutOfJailFreeCards: 0 },
  { id: "avg", name: "Average", cash: 0, position: 0, inJail: false, jailTurns: 0, bankrupt: false, getOutOfJailFreeCards: 0 },
];

// Fitness carries a -1,000,000 bankruptcy penalty (see engine's BANKRUPTCY_PENALTY) — an early,
// still-mostly-random genome bankrupting out is completely normal, but "-1,000,200" spelled out in
// full is a lot of digits to cram onto a ~300px-wide board label. Compact for the tight spots
// (board label, leaderboard); the roomier stat boxes above keep the exact number.
function formatFitnessCompact(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1000) return `${sign}${Math.round(abs / 1000)}k`;
  return Math.round(n).toString();
}

export function TrainingScreen({
  onAdoptChampion,
  view,
  onViewChange,
}: {
  onAdoptChampion: (genome: Genome) => void;
  view: View;
  onViewChange: (view: View) => void;
}) {
  const {
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
    population,
    gamesPerGenome,
    speedMs,
    setSpeedMs,
    turbo,
    setTurbo,
  } = useTraining();

  const fitnessHistory = history.map((h) => ({ turn: h.generation, cash: [h.bestFitness, h.averageFitness] }));
  const latest = history[history.length - 1];
  // The generation stats that produced the current champion — championGeneration always matches
  // an entry in history exactly, since it's set from that same generation's stats.bestFitness
  // (see useTraining's `if (stats.bestFitness > s.championFitness)` branch), so this is the
  // champion's real fitness without useTraining needing to expose a whole extra piece of state.
  const championFitness = history.find((h) => h.generation === championGeneration)?.bestFitness ?? 0;

  const [champions, setChampions] = useState<SavedChampion[]>(() => listChampions());
  // A generation number is a safe enough proxy for genome identity here — championGeneration only
  // ever changes when useTraining actually crowns a new fitness record (not on every render, and
  // not just because more generations have passed), so "some saved entry already has this exact
  // generation" reliably means "I already saved this specific champion," not just "a" champion.
  const championAlreadySaved = championGeneration !== null && champions.some((c) => c.generation === championGeneration);

  const handleSaveChampion = () => {
    if (!champion || championGeneration === null) return;
    const defaultName = `Gen ${championGeneration} · ${formatFitnessCompact(championFitness)}`;
    const name = window.prompt("Name this champion:", defaultName);
    if (!name) return; // cancelled
    const entry = saveChampion(champion, name, championFitness, championGeneration);
    setChampions((c) => [entry, ...c]);
  };

  const handleDeleteChampion = (id: string) => {
    deleteChampion(id);
    setChampions((c) => c.filter((entry) => entry.id !== id));
  };

  return (
    <div className="training-screen">
      <div className="training-body">
        <div className="training-side">
          <ViewSwitch view={view} onChange={onViewChange} />

          <header className="side-header">
            <h1>Train a NEAT bot</h1>
            <p className="subtitle">
              {population} genomes evolve live, {population} games playing at once — watch the population improve generation by generation.
            </p>
          </header>

          <div className="training-stats">
            <div className="training-stat">
              <span className="training-stat-label">Generation</span>
              <span className="training-stat-value">{generation}</span>
            </div>
            <div className="training-stat">
              <span className="training-stat-label">Best fitness</span>
              <span className="training-stat-value">{latest ? Math.round(latest.bestFitness).toLocaleString() : "—"}</span>
            </div>
            <div className="training-stat">
              <span className="training-stat-label">Avg fitness</span>
              <span className="training-stat-value">{latest ? Math.round(latest.averageFitness).toLocaleString() : "—"}</span>
            </div>
            <div className="training-stat">
              <span className="training-stat-label">Species</span>
              <span className="training-stat-value">{latest ? latest.speciesCount : "—"}</span>
            </div>
          </div>

          {/* A single Start/Pause toggle instead of two separate buttons — pausing keeps the
              population/species state intact (see useTraining's `session`), so resuming continues
              evolving instead of restarting, and Reset is always clickable (it's now safe to fire
              mid-run — see useTraining's `sessionId` guard) instead of needing Pause pressed first. */}
          <div className="controls">
            <button onClick={running ? pause : start}>{running ? "Pause" : hasSession ? "Resume training" : "Start training"}</button>
            <button className="secondary" onClick={reset}>
              Reset
            </button>
            <button
              onClick={() => champion && onAdoptChampion(champion)}
              disabled={!champion}
              title="Play with it now — doesn't save it anywhere"
            >
              Adopt champion
            </button>
            <button
              className={championAlreadySaved ? "champion-already-saved" : "champion-save-ready"}
              onClick={handleSaveChampion}
              disabled={!champion || championAlreadySaved}
              title={championAlreadySaved ? "This exact champion is already saved" : "Keep it in the list below, permanently"}
            >
              Save champion
            </button>
            {/* Inverted like Play's own speed slider (drag right = faster) — takes effect on the
                very next round even mid-run, since useTraining reads pacing through a ref.
                Disabled under turbo, which ignores it entirely (no pacing at all). */}
            <label className={`speed-control ${turbo ? "disabled" : ""}`}>
              Speed
              <input
                type="range"
                min={MIN_STEP_PAUSE_MS}
                max={MAX_STEP_PAUSE_MS}
                step={10}
                value={MIN_STEP_PAUSE_MS + MAX_STEP_PAUSE_MS - speedMs}
                onChange={(e) => setSpeedMs(MIN_STEP_PAUSE_MS + MAX_STEP_PAUSE_MS - Number(e.target.value))}
                disabled={turbo}
                aria-label="Training speed"
              />
            </label>
            {/* Real evolutionary progress (a hidden node actually appearing, fitness climbing
                meaningfully) needs dozens-to-hundreds of generations — unreachable at any watchable
                pace, since long games commonly run 150-300+ turns each. Turbo skips per-round
                pacing and stops pushing a board update every single round, trading "watch every
                turn" for "watch the generation count and fitness climb fast." */}
            <label className="turbo-toggle" title="Skip animation pacing to reach many more generations per session">
              <input type="checkbox" checked={turbo} onChange={(e) => setTurbo(e.target.checked)} />
              Turbo
            </label>
          </div>

          <div className="training-leaderboard">
            <h2>This generation</h2>
            {leaderboard.map((entry, rank) => (
              <div key={entry.slot} className="player-row">
                <div className="player-row-line1">
                  <span className="player-row-swatch" style={{ ["--player-color" as string]: PLAYER_COLORS[entry.slot % PLAYER_COLORS.length] }}>
                    {rank + 1}
                  </span>
                  <span className="player-row-name">Genome {entry.slot + 1}</span>
                  {/* 0 completed games reads as "scored zero," not "no data yet" — show a dash
                      until this genome has actually finished at least one game this generation. */}
                  <span className="player-row-cash">
                    {entry.gamesCompleted > 0 ? formatFitnessCompact(entry.averageFitnessSoFar) : "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {history.length > 0 && (
            <div className="training-chart">
              <h2>Fitness over generations</h2>
              <BankrollChart history={fitnessHistory} players={FITNESS_SERIES} />
            </div>
          )}

          {/* Separate from useTraining's own auto-saved session (trainingPersistence.ts) — that's
              one run's "don't lose progress," this is a user-curated list of individually-named
              champions that survives resetting the run entirely. Internally scrollable rather than
              growing the sidebar's own height, regardless of how many get saved over time. */}
          <div className="training-champions">
            <h2>Saved champions</h2>
            {champions.length === 0 ? (
              <p className="training-champions-empty">Nothing saved yet — "Save champion" keeps one here permanently.</p>
            ) : (
              <div className="training-champions-list">
                {champions.map((c) => (
                  <div key={c.id} className="champion-row">
                    <div className="champion-row-main">
                      <span className="champion-row-name">{c.name}</span>
                      <span className="champion-row-meta">
                        Gen {c.generation} · {formatFitnessCompact(c.fitness)}
                      </span>
                    </div>
                    <div className="champion-row-actions">
                      <button onClick={() => onAdoptChampion(c.genome)} title="Play with it now">
                        Load
                      </button>
                      <button className="secondary" onClick={() => handleDeleteChampion(c.id)} title="Delete permanently">
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Boards and the network diagram share a column, stacked — the diagram sits in the
            otherwise-empty space beneath the boards, using their own width (up to 1360px) rather
            than being squeezed into the 440px sidebar next to a chart it doesn't actually share a
            row with. Both need the boards' horizontal room; neither wants the sidebar's narrow one. */}
        <div className="training-main">
          <div className="mini-board-grid-wrapper">
            {slots.map((slot) => {
              const entry = leaderboard.find((l) => l.slot === slot.slot);
              const fitnessLabel = entry && entry.gamesCompleted > 0 ? formatFitnessCompact(entry.averageFitnessSoFar) : null;
              return slot.state ? (
                <MiniBoard
                  key={slot.slot}
                  state={slot.state}
                  genomeNumber={slot.slot + 1}
                  fitnessLabel={fitnessLabel}
                  done={slot.done}
                  gamesCompleted={entry?.gamesCompleted ?? 0}
                  gamesPerGenome={gamesPerGenome}
                />
              ) : (
                <div key={slot.slot} className="mini-board mini-board-idle">
                  <div className="mini-board-label">Genome {slot.slot + 1} — waiting to start</div>
                </div>
              );
            })}
          </div>

          <div className="training-topology">
            <h2>Champion's network{championGeneration !== null ? ` — gen ${championGeneration}` : ""}</h2>
            {champion ? (
              <GenomeTopology genome={champion} />
            ) : (
              <p className="training-topology-empty">Start training to see its network once a champion emerges.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
