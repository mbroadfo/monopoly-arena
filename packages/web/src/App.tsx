import { useState } from "react";
import { Board } from "./Board";
import { PlayerPanel } from "./PlayerPanel";
import { LogFeed } from "./LogFeed";
import { PropertiesPanel } from "./PropertiesPanel";
import { BankrollChart } from "./BankrollChart";
import { Timeline } from "./Timeline";
import { BOT_CHOICES, useGame } from "./useGame";

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
    fadingPlayerId,
    scrubTurn,
    latestTurn,
    isLive,
    scrubTo,
    stepTurn,
  } = useGame(botIndices);

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
          <Board state={state} fadingPlayerId={fadingPlayerId} />
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
            <label>
              Speed:
              <input
                type="range"
                min={50}
                max={1000}
                step={50}
                value={1050 - speedMs}
                onChange={(e) => setSpeedMs(1050 - Number(e.target.value))}
              />
            </label>
            <button className="secondary" onClick={() => reset(botIndices)}>
              Reset
            </button>
          </div>
          <div className="bot-select">
            {botIndices.map((choice, i) => (
              <label key={i}>
                Player {i + 1}:
                <select
                  value={choice}
                  onChange={(e) => {
                    const next = [...botIndices];
                    next[i] = Number(e.target.value);
                    setBotIndices(next);
                    reset(next);
                  }}
                >
                  {BOT_CHOICES.map((bot, idx) => (
                    <option key={idx} value={idx}>
                      {bot.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <LogFeed state={state} />
        </div>
      </div>
    </div>
  );
}
