import { BOT_CHOICES } from "./useGame";

export function LineupPicker({ botIndices, onChange }: { botIndices: number[]; onChange: (next: number[]) => void }) {
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
            {BOT_CHOICES.map((bot, idx) => (
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
