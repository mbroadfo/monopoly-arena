import { useState } from "react";
import { Board } from "./Board";
import { PlayerPanel } from "./PlayerPanel";
import { LogFeed } from "./LogFeed";
import { PropertiesPanel } from "./PropertiesPanel";
import { BankrollChart } from "./BankrollChart";
import { Timeline } from "./Timeline";
import { LineupPicker } from "./LineupPicker";
import { useGame } from "./useGame";

export function App() {
  const [botIndices, setBotIndices] = useState([0, 1, 2, 3]);
  const {
    state,
    history,
    step,
    reset,
    playing,
    setPlaying,
    speedMs,
    setSpeedMs,
    animating,
    animationEnabled,
    setAnimationEnabled,
    fadingPlayerId,
    scrubTurn,
    latestTurn,
    isLive,
    scrubTo,
    stepTurn,
  } = useGame(botIndices);

  const isSetupMode = state.turn === 0;

  return (
    <div className="app">
      <div className="layout">
        <div className="properties-column">
          <PropertiesPanel state={state} />
          <BankrollChart history={history} players={state.players} activeTurn={scrubTurn} />
          <Timeline
            scrubTurn={scrubTurn}
            latestTurn={latestTurn}
            isLive={isLive}
            disabled={animating}
            onScrub={scrubTo}
            onStep={stepTurn}
          />
        </div>

        <div className="board-column">
          <Board state={state} fadingPlayerId={fadingPlayerId} animationEnabled={animationEnabled} />
        </div>

        <div className="side-column">
          <header className="side-header">
            <h1>Monopoly Arena</h1>
            <p className="subtitle">Watch AI bots play Monopoly against each other.</p>
          </header>

          <PlayerPanel state={state} />

          <div className="controls">
            <button onClick={step} disabled={state.winnerId !== null || animating || !isLive}>
              Step
            </button>
            <button onClick={() => setPlaying((p) => !p)} disabled={state.winnerId !== null || !isLive}>
              {playing ? "Pause" : "Auto-play"}
            </button>
            <label className="speed-control">
              Speed
              <input
                type="range"
                min={50}
                max={1000}
                step={50}
                value={1050 - speedMs}
                onChange={(e) => setSpeedMs(1050 - Number(e.target.value))}
                aria-label="Playback speed"
              />
            </label>
            <label className="animate-toggle">
              <input
                type="checkbox"
                checked={animationEnabled}
                onChange={(e) => setAnimationEnabled(e.target.checked)}
              />
              Animate movement
            </label>
            <button className="secondary" onClick={() => reset(botIndices)}>
              Reset
            </button>
          </div>

          {isSetupMode && (
            <LineupPicker
              botIndices={botIndices}
              onChange={(next) => {
                setBotIndices(next);
                reset(next);
              }}
            />
          )}

          <LogFeed state={state} />
        </div>
      </div>
    </div>
  );
}
