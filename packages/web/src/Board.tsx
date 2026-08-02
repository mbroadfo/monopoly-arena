import { ArrowBigLeft, Droplets, HelpCircle, Package, ParkingCircle, Siren, TrainFront, Trophy, Zap } from "lucide-react";
import type { GameState, Space } from "@monopoly-arena/engine";
import { GROUP_COLORS, PLAYER_COLORS, isCorner, spaceToGrid } from "./boardLayout";

/**
 * Rotation so tile text/icons face outward toward the player sitting at that edge, with the
 * colored group bar always landing on the side nearest the board's center (matching a real board).
 * Only used for non-corner tiles; corners get their own fixed per-corner treatment.
 */
function edgeRotation(index: number): number {
  const { col, row } = spaceToGrid(index);
  if (row === 0) return 180;
  if (col === 0) return 90;
  if (col === 10) return -90;
  return 0;
}

function TileIcon({ space, size = 20 }: { space: Space; size?: number }) {
  switch (space.type) {
    case "chance":
      return <HelpCircle size={size} color="#e65100" strokeWidth={2.5} />;
    case "community-chest":
      return <Package size={size} color="#1565c0" strokeWidth={2} />;
    case "railroad":
      return <TrainFront size={size} color="#333" strokeWidth={2} />;
    case "utility":
      return space.name.includes("Electric") ? (
        <Zap size={size} color="#f9a825" fill="#fff59d" strokeWidth={2} />
      ) : (
        <Droplets size={size} color="#0288d1" fill="#81d4fa" strokeWidth={2} />
      );
    case "tax":
      return <span className="tax-icon">$</span>;
    default:
      return null;
  }
}

/** Corners get their own fixed orientation rather than the generic edge rotation. */
function CornerTile({ space }: { space: Space }) {
  switch (space.type) {
    case "go":
      // Bottom-right corner: reads normally, facing the bottom edge, arrow pointing back along the bottom row.
      return (
        <div className="corner-content go">
          <ArrowBigLeft size={38} color="#d32f2f" strokeWidth={2.5} className="go-arrow" />
          <div className="corner-label go-label">GO</div>
          <div className="corner-sub">COLLECT $200</div>
        </div>
      );
    case "jail":
      // Bottom-left corner: a diagonal "in jail" cell (bars) inset toward the interior of the
      // board, and a separate "just visiting" label along the tile's outer edges.
      return (
        <div className="corner-content jail-corner">
          <div className="jail-cell">
            <div className="jail-window">
              <div className="jail-bars">
                <span />
                <span />
                <span />
              </div>
            </div>
            <span className="jail-cell-label">IN JAIL</span>
          </div>
          <div className="jail-visiting">JUST VISITING</div>
        </div>
      );
    case "free-parking":
      // Top-left corner: diagonal, facing up and out toward the corner.
      return (
        <div className="corner-content diagonal diagonal-nw">
          <ParkingCircle size={28} color="#e53935" strokeWidth={2} />
          <div className="corner-label">FREE PARKING</div>
        </div>
      );
    case "go-to-jail":
      // Top-right corner: diagonal, facing up and out toward the corner.
      return (
        <div className="corner-content diagonal diagonal-ne">
          <Siren size={26} color="#1565c0" strokeWidth={2} />
          <div className="corner-label" style={{ color: "#d32f2f" }}>
            GO TO JAIL
          </div>
        </div>
      );
    default:
      return <div className="corner-label">{space.name.toUpperCase()}</div>;
  }
}

export function Board({ state }: { state: GameState }) {
  return (
    <div className="board-wrap">
      <div className="board-grid">
        {state.spaces.map((space) => {
          const { col, row } = spaceToGrid(space.index);
          const corner = isCorner(space.index);
          const record = state.ownership[space.index];
          const group = "group" in space ? space.group : null;
          const rotation = corner ? 0 : edgeRotation(space.index);

          return (
            <div
              key={space.index}
              className={`tile ${corner ? "corner" : ""}`}
              style={{ gridColumn: col + 1, gridRow: row + 1 }}
            >
              {record && record.ownerId && (
                <div
                  className="tile-owner-border"
                  style={{ borderColor: PLAYER_COLORS[state.players.findIndex((p) => p.id === record.ownerId) % PLAYER_COLORS.length] }}
                />
              )}
              <div className="tile-inner" style={{ transform: `rotate(${rotation}deg)` }}>
                {corner ? (
                  <CornerTile space={space} />
                ) : (
                  <>
                    {group && <div className="tile-color-bar" style={{ background: GROUP_COLORS[group] }} />}
                    <div className="tile-icon">
                      <TileIcon space={space} />
                    </div>
                    <div className="tile-name">{space.name.toUpperCase()}</div>
                    {"price" in space && <div className="tile-price">${space.price}</div>}
                    {space.type === "tax" && <div className="tile-price">${space.amount}</div>}
                  </>
                )}
              </div>

              {record && (record.houses > 0 || record.hotel) && !record.mortgaged && (
                <div className="building-row">
                  {record.hotel ? (
                    <div className="hotel" />
                  ) : (
                    Array.from({ length: record.houses }).map((_, i) => <div className="house" key={i} />)
                  )}
                </div>
              )}

              {record && record.mortgaged && (
                <div className="mortgage-banner">
                  <span>MORTGAGED</span>
                </div>
              )}

              {state.players
                .map((p, i) => ({ p, i }))
                .filter(({ p }) => p.position === space.index)
                .map(({ p, i }, orderIndex, arr) => {
                  const spread = arr.length > 1 ? 16 : 0;
                  const angle = (orderIndex / arr.length) * Math.PI * 2;
                  return (
                    <div
                      key={p.id}
                      className="token"
                      title={p.name}
                      style={{
                        background: p.bankrupt ? "#999" : PLAYER_COLORS[i % PLAYER_COLORS.length],
                        transform: `translate(${Math.cos(angle) * spread}px, ${Math.sin(angle) * spread}px)`,
                      }}
                    />
                  );
                })}
            </div>
          );
        })}

        <div className="board-center">
          <div className="center-inner">
            <div className="logo-ribbon">MONOPOLY</div>
            <div className="logo-sub">A R E N A</div>
            <div className="center-turn">Turn {state.turn}</div>
            {state.winnerId ? (
              <div className="center-winner">
                <Trophy size={18} color="#ffd54f" />
                {state.players.find((p) => p.id === state.winnerId)?.name} wins!
              </div>
            ) : (
              <div className="center-current">
                <span
                  className="current-dot"
                  style={{ background: PLAYER_COLORS[state.currentPlayerIndex % PLAYER_COLORS.length] }}
                />
                {state.players[state.currentPlayerIndex].name}'s turn
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
