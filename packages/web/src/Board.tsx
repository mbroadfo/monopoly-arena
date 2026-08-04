import { Lightbulb, ShowerHead, Trophy } from "lucide-react";
import type { GameState, Space } from "@monopoly-arena/engine";
import { EDGE_DEPTH_RATIO, GROUP_COLORS, PLAYER_COLORS, TOKEN_ICONS, isCorner, spaceToGrid, spaceToPercent } from "./boardLayout";
import railroadIcon from "./assets/railroad.png";
import communityChestIcon from "./assets/community-chest.png";
import goIcon from "./assets/go.png";
import jailIcon from "./assets/jail.png";
import goToJailIcon from "./assets/go-to-jail.png";
import freeParkingIcon from "./assets/free-parking.png";
import chanceIcon from "./assets/Chance.png";
import chanceCardArt from "./assets/Chance-Card.png";
import communityChestCardArt from "./assets/Community-Chest-Card.png";

type Edge = "top" | "bottom" | "left" | "right";

/**
 * Which of the four sides a (non-corner) space sits on. A left/right tile is geometrically
 * identical to a top/bottom tile with its two axes swapped — never rotated content into a
 * mismatched box, just lay each one out in its own natural orientation.
 */
function edgeOf(index: number): Edge {
  const { col, row } = spaceToGrid(index);
  if (row === 0) return "top";
  if (row === 10) return "bottom";
  return col === 0 ? "left" : "right";
}

/**
 * Flex direction that lays out [color bar, icon, name, price] from the board's center outward
 * to the edge — the single rule every edge derives from, rather than a per-edge special case.
 */
function edgeFlexDirection(edge: Edge): "column" | "column-reverse" | "row" | "row-reverse" {
  switch (edge) {
    case "bottom":
      return "column"; // center is above (up = toward center = main-axis start)
    case "top":
      return "column-reverse"; // center is below
    case "right":
      return "row"; // center is to the left
    case "left":
      return "row-reverse"; // center is to the right
  }
}

/**
 * Degrees to rotate the icon/name/price content so it faces the player sitting at that edge —
 * matching a real board, where each side's text is upright for whoever is standing there, not
 * for a single fixed viewer. Applied to each small content element individually (not the whole
 * tile box), so there's no rectangular-box-vs-rotation mismatch to worry about.
 */
function edgeContentRotation(edge: Edge): number {
  switch (edge) {
    case "bottom":
      return 0;
    case "top":
      return 180;
    case "left":
      return 90;
    case "right":
      return -90;
  }
}

/**
 * Text specifically can't just be rotated like the icon: `transform: rotate()` is a purely
 * visual, post-layout effect, so a text block sitting in a `row`-direction flex container
 * grows as wide as it needs to stay on one line *before* being rotated — it never wraps, and
 * the rotated result can overflow. `writing-mode` is a real layout property instead: the browser
 * wraps the text into it directly, respecting the space actually available. Top/bottom don't
 * need this — a plain 180deg rotation never changes a box's width/height, so it can't overflow.
 */
function edgeTextStyle(edge: Edge): React.CSSProperties | undefined {
  switch (edge) {
    case "bottom":
      return undefined;
    case "top":
      return { transform: "rotate(180deg)" };
    case "left":
      return { writingMode: "vertical-rl" };
    case "right":
      // Same vertical flow as "left", then mirrored so the two sides don't read identically.
      return { writingMode: "vertical-rl", transform: "rotate(180deg)" };
  }
}

function TileIcon({ space }: { space: Space }) {
  switch (space.type) {
    case "chance":
      return <img src={chanceIcon} alt="" style={{ width: 44, height: 44, display: "block" }} />;
    case "community-chest":
      return (
        <div className="chest-icon-crop" style={{ width: 32, height: 32 }}>
          <img src={communityChestIcon} alt="" />
        </div>
      );
    case "railroad":
      return <img src={railroadIcon} alt="" style={{ width: 44, height: 44 * 0.64, display: "block" }} />;
    case "utility":
      // lucide has no literal faucet icon; ShowerHead is the closest plumbing fixture available.
      return space.name.includes("Electric") ? (
        <Lightbulb size={26} color="#f9a825" fill="#fff59d" strokeWidth={2} />
      ) : (
        <ShowerHead size={26} color="#0288d1" strokeWidth={2} />
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
      // Square card, already oriented correctly: arrow points back along the bottom row.
      return <img src={goIcon} alt="GO" className="corner-image" />;
    case "jail":
      // Not a plain square — "JUST" runs down the left edge and "VISITING" along the bottom
      // edge, outside the orange cell, which are exactly this tile's two true outer (SW)
      // edges. `contain` keeps its real proportions instead of stretching those labels.
      return <img src={jailIcon} alt="Jail / Just Visiting" className="corner-image corner-image-contain" />;
    case "free-parking":
      return <img src={freeParkingIcon} alt="Free Parking" className="corner-image corner-image-flip" />;
    case "go-to-jail":
      return <img src={goToJailIcon} alt="Go To Jail" className="corner-image corner-image-rotate-ccw" />;
    default:
      return <div className="corner-label">{space.name.toUpperCase()}</div>;
  }
}

// Board side = 9W + 2D (W = one along-edge tile, D = corner/edge depth), applied identically to
// both row and column axes, so corners stay square and every edge tile is deep automatically.
// Set here (not in CSS) and interpolated into literal `fr` values: `calc(var(...) * 1fr)` mixing
// a custom property, calc(), and the `fr` unit is inconsistently supported across browsers and
// can silently collapse to ~1fr — plain literal fr values sidestep that entirely.
// EDGE_DEPTH_RATIO itself lives in boardLayout.ts (shared with spaceToPercent's token math).
// minmax(0, ...) strips the implicit content-based minimum plain `fr` tracks otherwise get,
// so a tile's icon/text can't quietly inflate a track past its fair share of the ratio.
const BOARD_TEMPLATE = `minmax(0, ${EDGE_DEPTH_RATIO}fr) repeat(9, minmax(0, 1fr)) minmax(0, ${EDGE_DEPTH_RATIO}fr)`;

// Fixed per-player-index offsets for tokens sharing a tile — deliberately NOT recomputed from
// how many players currently share the tile (that made every token on a tile jump to a new
// spread position whenever another token entered or passed through). A given player always
// sits in the same slot, whether alone or accompanied, so only the token that's actually moving
// ever visibly moves.
const TOKEN_SLOT_OFFSETS: [number, number][] = [
  [-7, -7],
  [7, -7],
  [-7, 7],
  [7, 7],
  [0, -11],
  [0, 11],
];

export function Board({
  state,
  fadingPlayerId,
  animationEnabled = true,
}: {
  state: GameState;
  fadingPlayerId?: string | null;
  animationEnabled?: boolean;
}) {
  return (
    <div className="board-wrap">
      <div className="board-grid" style={{ gridTemplateColumns: BOARD_TEMPLATE, gridTemplateRows: BOARD_TEMPLATE }}>
        {state.spaces.map((space) => {
          const { col, row } = spaceToGrid(space.index);
          const corner = isCorner(space.index);
          const record = state.ownership[space.index];
          const group = "group" in space ? space.group : null;
          const edge = corner ? null : edgeOf(space.index);
          const isSide = edge === "left" || edge === "right";
          // All four corners are now full-bleed pre-made card images, so tile-inner needs no padding.
          const isImageCorner = corner;
          const contentRotation = edge ? edgeContentRotation(edge) : 0;
          const iconStyle = contentRotation ? { transform: `rotate(${contentRotation}deg)` } : undefined;
          const textStyle = edge ? edgeTextStyle(edge) : undefined;
          // Only real color-group properties have a color bar to anchor the center-to-edge
          // spread. Everything else (chance, community chest, railroads, utilities, tax) has
          // just an icon + name (+ maybe price) — cluster them together instead of letting
          // space-between drift the icon away from its own label.
          const isCompact = space.type !== "property";

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
              <div
                className={`tile-inner ${isSide ? "side" : ""} ${isCompact ? "compact" : ""}`}
                style={{
                  flexDirection: edge ? edgeFlexDirection(edge) : undefined,
                  padding: isImageCorner ? 0 : undefined,
                }}
              >
                {corner ? (
                  <CornerTile space={space} />
                ) : (
                  <>
                    {/* Only real color-group properties get a band — railroads/utilities have a
                        `group` for rent-calculation purposes, but no color swatch on a real board. */}
                    {space.type === "property" && group && (
                      <div className={`tile-color-bar ${isSide ? "vertical" : ""}`} style={{ background: GROUP_COLORS[group] }} />
                    )}
                    <div className="tile-icon" style={iconStyle}>
                      <TileIcon space={space} />
                    </div>
                    <div className="tile-name" style={textStyle}>
                      {space.name.toUpperCase()}
                    </div>
                    {"price" in space && (
                      <div className="tile-price" style={textStyle}>
                        ${space.price}
                      </div>
                    )}
                    {space.type === "tax" && (
                      <div className="tile-price" style={textStyle}>
                        ${space.amount}
                      </div>
                    )}
                  </>
                )}
              </div>

              {record && (record.houses > 0 || record.hotel) && !record.mortgaged && (
                <div className={`building-row ${edge ? `edge-${edge}` : ""}`}>
                  {record.hotel ? (
                    <div className="hotel" style={iconStyle} />
                  ) : (
                    Array.from({ length: record.houses }).map((_, i) => <div className="house" key={i} style={iconStyle} />)
                  )}
                </div>
              )}

              {record && record.mortgaged && (
                <div className="mortgage-banner">
                  <span>MORTGAGED</span>
                </div>
              )}
            </div>
          );
        })}

        <div className="token-layer">
          {state.players.map((p, i) => {
            const { left, top } = spaceToPercent(p.position);
            const [dx, dy] = TOKEN_SLOT_OFFSETS[i % TOKEN_SLOT_OFFSETS.length];
            const Icon = TOKEN_ICONS[i % TOKEN_ICONS.length];
            return (
              <div
                key={p.id}
                className={`token ${p.bankrupt ? "bankrupt" : ""} ${p.id === fadingPlayerId ? "hidden" : ""} ${animationEnabled ? "" : "no-transition"}`}
                title={p.name}
                style={{
                  left: `${left}%`,
                  top: `${top}%`,
                  ["--token-color" as string]: PLAYER_COLORS[i % PLAYER_COLORS.length],
                  transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px)`,
                }}
              >
                <Icon className="token-icon" size={15} color="#fff" strokeWidth={2.75} />
              </div>
            );
          })}
        </div>

        <div className="board-center">
          {/* Ribbon runs bottom-left to top-right at 45deg, leaving the other two corners open for the card piles. */}
          <div className="center-card-pile chance-pile">
            <img src={chanceCardArt} alt="" className="pile-card back" />
            <img src={chanceCardArt} alt="" className="pile-card back" />
            <img src={chanceCardArt} alt="Chance" className="pile-card front" />
          </div>

          <div className="center-card-pile chest-pile">
            <img src={communityChestCardArt} alt="" className="pile-card back" />
            <img src={communityChestCardArt} alt="" className="pile-card back" />
            <img src={communityChestCardArt} alt="Community Chest" className="pile-card front" />
          </div>

          <div className="center-turn">Turn {state.turn}</div>

          <div className="center-logo">
            <div className="logo-ribbon">
              <div className="logo-title">MONOPOLY</div>
              <div className="logo-sub">ARENA</div>
            </div>
          </div>

          {state.winnerId && (
            <div className="center-status">
              <div className="center-winner">
                <Trophy size={18} color="#ffd54f" />
                {state.players.find((p) => p.id === state.winnerId)?.name} wins!
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
