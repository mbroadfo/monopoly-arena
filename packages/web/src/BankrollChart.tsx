import { useMemo, useRef, useState } from "react";
import type { PlayerState } from "@monopoly-arena/engine";
import { PLAYER_COLORS } from "./boardLayout";
import type { BankrollPoint } from "./useGame";

const WIDTH = 400;
const HEIGHT = 150;
const MARGIN = { top: 10, right: 10, bottom: 18, left: 40 };
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom;

/** Y-axis label formatting — handles the negative, million-scale range fitness (reused into this
 * chart on the Training screen) can reach, which plain cash amounts never do. */
function formatAxisValue(v: number): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1000) return `${sign}$${Math.round(abs / 1000)}k`;
  return `${sign}$${abs}`;
}

export function BankrollChart({
  history,
  players,
  activeTurn,
}: {
  history: BankrollPoint[];
  players: PlayerState[];
  /** The turn currently shown elsewhere in the UI (e.g. the timeline scrubber) — rendered as a
   * persistent marker, distinct from the mouse-hover crosshair/tooltip below. `history`'s index
   * lines up 1:1 with turn number, so no lookup is needed beyond a bounds check. */
  activeTurn?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { maxTurn, maxCash, minCash, linePoints } = useMemo(() => {
    const maxTurn = Math.max(1, history[history.length - 1]?.turn ?? 0);
    const values = history.flatMap((h) => h.cash);
    // Real bankroll history never goes negative (bankruptcy zeroes cash, doesn't owe past 0), so
    // dataMin is always 0 there and this behaves exactly as before. Fitness (reused into this same
    // chart on the Training screen) very much can — a bankrupted-out genome scores a large negative
    // penalty — so the floor can't just be assumed at 0 the way it used to be, or those points
    // plot far below the visible plot area instead of showing where they actually are.
    const dataMax = Math.max(1500, ...values);
    const dataMin = Math.min(0, ...values);
    const range = dataMax - dataMin || 1;
    const maxCash = dataMax + range * 0.08;
    const minCash = dataMin - range * 0.02;
    const span = maxCash - minCash || 1;
    const linePoints = players.map((_, playerIndex) =>
      history.map((point) => ({
        x: MARGIN.left + (point.turn / maxTurn) * PLOT_W,
        y: MARGIN.top + PLOT_H - ((point.cash[playerIndex] - minCash) / span) * PLOT_H,
      })),
    );
    return { maxTurn, maxCash, minCash, linePoints };
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
  const activeIndex = activeTurn !== undefined && activeTurn >= 0 && activeTurn < history.length ? activeTurn : null;
  const activeX = activeIndex !== null ? MARGIN.left + (history[activeIndex].turn / maxTurn) * PLOT_W : null;
  const gridValues = [0, 0.5, 1].map((f) => Math.round(minCash + (maxCash - minCash) * f));
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
          const y = MARGIN.top + PLOT_H - ((v - minCash) / (maxCash - minCash || 1)) * PLOT_H;
          return (
            <g key={v}>
              <line x1={MARGIN.left} y1={y} x2={WIDTH - MARGIN.right} y2={y} className="bankroll-gridline" />
              <text x={MARGIN.left - 5} y={y + 3} className="bankroll-axis-label" textAnchor="end">
                {formatAxisValue(v)}
              </text>
            </g>
          );
        })}
        {/* A dedicated zero-line whenever the plotted range actually straddles it — the fitness
            reuse case can run entirely negative (a whole generation of bankrupted-out genomes),
            where "$0" would otherwise just be one of three grid lines with no special meaning. */}
        {minCash < 0 && maxCash > 0 && (
          <line
            x1={MARGIN.left}
            y1={MARGIN.top + PLOT_H - ((0 - minCash) / (maxCash - minCash || 1)) * PLOT_H}
            x2={WIDTH - MARGIN.right}
            y2={MARGIN.top + PLOT_H - ((0 - minCash) / (maxCash - minCash || 1)) * PLOT_H}
            className="bankroll-zero-line"
          />
        )}
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

        {activeX !== null && (
          <line x1={activeX} y1={MARGIN.top} x2={activeX} y2={MARGIN.top + PLOT_H} className="bankroll-active-crosshair" />
        )}
        {activeIndex !== null &&
          linePoints.map((points, i) => (
            <circle
              key={players[i].id}
              cx={points[activeIndex].x}
              cy={points[activeIndex].y}
              r={3.5}
              className="bankroll-active-dot"
              fill={PLAYER_COLORS[i % PLAYER_COLORS.length]}
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
