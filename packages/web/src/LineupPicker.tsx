import { getBotChoices } from "./useGame";

export function LineupPicker({ botIndices, onChange }: { botIndices: number[]; onChange: (next: number[]) => void }) {
  // Recomputed on every render rather than imported as a static list — picks up champions saved
  // or deleted on the Train screen without needing a page reload.
  const botChoices = getBotChoices();

  return (
    <div className="bot-select">
      {botIndices.map((choice, i) => (
        <label key={i}>
          Player {i + 1}:
          <select
            value={choice}
            onChange={(e) => {
              const next = [...botIndices];
              next[i] = Number(e.target.value);
              onChange(next);
            }}
          >
            {botChoices.map((bot, idx) => (
              <option key={idx} value={idx}>
                {bot.label}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
