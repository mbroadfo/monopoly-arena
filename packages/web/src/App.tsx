import { useState } from "react";
import { Board } from "./Board";
import { PlayerPanel } from "./PlayerPanel";
import { LogFeed } from "./LogFeed";
import { BOT_CHOICES, useGame } from "./useGame";

export function App() {
  const [botIndices, setBotIndices] = useState([0, 1]);
  const { state, step, reset, playing, setPlaying, speedMs, setSpeedMs } = useGame(botIndices);

  return (
    <div className="app">
      <header>
        <h1>Monopoly Arena</h1>
        <p className="subtitle">Watch AI bots play Monopoly against each other.</p>
      </header>

      <div className="layout">
        <div className="board-column">
          <Board state={state} />
          <div className="controls">
            <button onClick={step} disabled={state.winnerId !== null}>
              Step
            </button>
            <button onClick={() => setPlaying((p) => !p)} disabled={state.winnerId !== null}>
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
        </div>

        <div className="side-column">
          <PlayerPanel state={state} />
          <LogFeed state={state} />
        </div>
      </div>
    </div>
  );
}
