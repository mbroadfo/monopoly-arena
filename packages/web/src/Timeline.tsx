import { ChevronLeft, ChevronRight } from "lucide-react";

export function Timeline({
  scrubTurn,
  latestTurn,
  isLive,
  disabled,
  onScrub,
  onStep,
}: {
  scrubTurn: number;
  latestTurn: number;
  isLive: boolean;
  disabled: boolean;
  onScrub: (turn: number) => void;
  onStep: (delta: 1 | -1) => void;
}) {
  return (
    <div className="timeline">
      <div className="timeline-header">
        <span className="timeline-turn-label">
          Turn {scrubTurn} / {latestTurn}
        </span>
        {isLive ? (
          <span className="timeline-live-badge">● Live</span>
        ) : (
          <button className="secondary timeline-live-btn" onClick={() => onScrub(latestTurn)}>
            Jump to Live
          </button>
        )}
      </div>
      <div className="timeline-controls">
        <button
          className="timeline-step-btn"
          onClick={() => onStep(-1)}
          disabled={disabled || scrubTurn === 0}
          title="Previous turn"
        >
          <ChevronLeft size={16} />
        </button>
        <input
          type="range"
          className="timeline-slider"
          min={0}
          max={latestTurn}
          step={1}
          value={scrubTurn}
          disabled={disabled || latestTurn === 0}
          onChange={(e) => onScrub(Number(e.target.value))}
        />
        <button
          className="timeline-step-btn"
          onClick={() => onStep(1)}
          disabled={disabled || scrubTurn === latestTurn}
          title="Next turn (replays that turn's movement)"
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
