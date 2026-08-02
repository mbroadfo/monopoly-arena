import { useMemo, useRef, useState } from "react";
import type { PlayerState } from "@monopoly-arena/engine";
import { PLAYER_COLORS } from "./boardLayout";
import type { BankrollPoint } from "./useGame";

const WIDTH = 400;
const HEIGHT = 150;
const MARGIN = { top: 10, right: 10, bottom: 18, left: 40 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

export function BankrollChart({ history, players }: { history: BankrollPoint[]; players: PlayerState[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { maxTurn, maxCash, linePoints } = useMemo(() => {
    const maxTurn = Math.max(1, history[history.length - 1]?.turn ?? 0);
    const maxCash = Math.max(1500, ...history.flatMap((h) => h.cash)) * 1.08;
    const linePoints = players.map((_, playerIndex) =>
      history.map((point) => ({
        x: MARGIN.left + (point.turn / maxTurn) * PLOT_W,
        y: MARGIN.top + PLOT_H - (point.cash[playerIndex] / maxCash) * PLOT_H,
      })),
    );
    return { maxTurn, maxCash, linePoints };
  }, [history, players]);

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || history.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((e.clientX - rect.left) / rect.width) * WIDTH;
    const turn = ((svgX - MARGIN.left) / PLOT_W) * maxTurn;
    const index = Math.round((turn / maxTurn) * (history.length - 1));
    setHoverIndex(Math.max(0, Math.min(history.length - 1, index)));
  };

  const hoverPoint = hoverIndex !== null ? history[hoverIndex] : null;
  const hoverX = hoverPoint ? MARGIN.left + (hoverPoint.turn / maxTurn) * PLOT_W : null;
  const gridValues = [0, 0.5, 1].map((f) => Math.round(maxCash * f));
  // Flip the tooltip to the left once it would run past the right edge of the plot.
  const tooltipOnLeft = hoverX !== null && hoverX > MARGIN.left + PLOT_W * 0.6;

  return (
    <div className="bankroll-chart">
      <div className="bankroll-legend">
        {players.map((p, i) => (
          <span key={p.id} className="bankroll-legend-item">
            <span className="bankroll-dot" style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length] }} />
            {p.name}
          </span>
        ))}
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="bankroll-svg"
        onMouseMove={handleMove}
        onMouseLeave={() => setHoverIndex(null)}
      >
        {gridValues.map((v) => {
          const y = MARGIN.top + PLOT_H - (v / maxCash) * PLOT_H;
          return (
            <g key={v}>
              <line x1={MARGIN.left} y1={y} x2={WIDTH - MARGIN.right} y2={y} className="bankroll-gridline" />
              <text x={MARGIN.left - 5} y={y + 3} className="bankroll-axis-label" textAnchor="end">
                ${v >= 1000 ? `${Math.round(v / 1000)}k` : v}
              </text>
            </g>
          );
        })}
        <text x={MARGIN.left} y={HEIGHT - 3} className="bankroll-axis-label">
          Turn 0
        </text>
        <text x={WIDTH - MARGIN.right} y={HEIGHT - 3} className="bankroll-axis-label" textAnchor="end">
          Turn {maxTurn}
        </text>

        {linePoints.map((points, i) => (
          <polyline
            key={players[i].id}
            points={points.map((p) => `${p.x},${p.y}`).join(" ")}
            fill="none"
            stroke={PLAYER_COLORS[i % PLAYER_COLORS.length]}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {hoverX !== null && (
          <line x1={hoverX} y1={MARGIN.top} x2={hoverX} y2={MARGIN.top + PLOT_H} className="bankroll-crosshair" />
        )}
        {hoverIndex !== null &&
          linePoints.map((points, i) => (
            <circle key={players[i].id} cx={points[hoverIndex].x} cy={points[hoverIndex].y} r={3} fill={PLAYER_COLORS[i % PLAYER_COLORS.length]} />
          ))}
      </svg>

      {hoverPoint && hoverX !== null && (
        <div
          className="bankroll-tooltip"
          style={{
            left: `${(hoverX / WIDTH) * 100}%`,
            transform: tooltipOnLeft ? "translateX(-100%)" : "none",
          }}
        >
          <div className="bankroll-tooltip-turn">Turn {hoverPoint.turn}</div>
          {players.map((p, i) => (
            <div key={p.id} className="bankroll-tooltip-row">
              <span className="bankroll-dot" style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length] }} />
              {p.name}: ${hoverPoint.cash[i].toLocaleString()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
