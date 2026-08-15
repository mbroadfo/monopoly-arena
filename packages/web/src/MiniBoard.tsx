import { Lock, Star } from "lucide-react";
import { GROUP_MEMBERS, maxRentThreat, netWorth } from "@monopoly-arena/engine";
import type { GameState } from "@monopoly-arena/engine";
import { GROUP_COLORS, PLAYER_COLORS, TOKEN_ICONS, edgeOf, isCorner, spaceToGrid, spaceToPercent } from "./boardLayout";

const GRID_SIZE = 11;

// Semantic colors for the three components of a player's accumulated value — deliberately not
// reused from GROUP_COLORS/PLAYER_COLORS (avoids yet another "is this ownership or identity?"
// collision), and consistent across every board so the same color always means the same thing.
const VALUE_COLORS = { cash: "#66bb6a", equity: "#4fc3f7", rent: "#ce93d8" };

// Body fill for a tile nobody owns (or that can't be owned at all) — the same dark-green felt as
// the mini-board's own background, so an unowned space visually recedes.
const NEUTRAL_TILE_COLOR = "#0b3d2e";

/**
 * A deliberately much simpler sibling of `Board.tsx` — that component's CSS already sits near the
 * minimum for legible tile text/icons at full size, and it always renders full tile chrome (name,
 * price, house art), so it can't shrink into a 6-up grid. This renders only what a glance actually
 * needs, split into two layers per tile: the body fill is who owns it (a player color, or the
 * neutral felt color if unowned — the dominant, easy-to-read signal), and a thin bar facing the
 * board's center is always the space's own identity (property color group, or railroad/utility —
 * via `GROUP_COLORS`, the same map `Board.tsx` uses) regardless of ownership, oriented per edge the
 * same way `Board.tsx`'s `tile-color-bar` is. Player tokens sit on top. The board's empty interior
 * (never touched by tiles — spaceToGrid only ever lands on the outer ring) hosts a compact
 * standings card instead of sitting unused.
 *
 * `done` marks a slot that finished all its games for this generation and is holding on its last
 * state while the round-robin scheduler waits on the others — rendered dimmed with a badge rather
 * than going blank, so "this one's finished" reads clearly instead of looking like a stall or a
 * rendering gap. `gamesCompleted`/`gamesPerGenome` (from the leaderboard entry) drive the "Game
 * X/Y" indicator in the standings card — `useTraining.ts` plays `gamesPerGenome` games per genome
 * per generation before that slot goes idle, and this is the only place that's otherwise visible.
 *
 * `genomeNumber`/`fitnessLabel` used to render as a separate overlay pinned to the board's
 * top-left corner, sitting on top of the actual (colorful, busy) tile ring — cramped and hard to
 * read there. They're folded into the standings card's own header instead, so all of a board's
 * text lives together on the calm felt, not split across two places.
 */
export function MiniBoard({
  state,
  genomeNumber,
  fitnessLabel,
  done,
  gamesCompleted,
  gamesPerGenome,
}: {
  state: GameState;
  genomeNumber: number;
  fitnessLabel: string | null;
  done?: boolean;
  gamesCompleted: number;
  gamesPerGenome: number;
}) {
  const playerIndexById = new Map(state.players.map((p, i) => [p.id, i]));

  return (
    <div className={`mini-board ${done ? "done" : ""}`}>
      {done && <div className="mini-board-done-badge">Waiting for others</div>}
      <div className="mini-board-grid">
        {state.spaces.map((space, index) => {
          const record = state.ownership[index];
          const ownerIndex = record?.ownerId ? playerIndexById.get(record.ownerId) : undefined;
          const ownerColor = ownerIndex !== undefined ? PLAYER_COLORS[ownerIndex] : NEUTRAL_TILE_COLOR;
          const groupColor = "group" in space ? GROUP_COLORS[space.group] : undefined;
          const { col, row } = spaceToGrid(index);
          const edge = isCorner(index) ? null : edgeOf(index);
          return (
            <div
              key={index}
              className="mini-board-tile"
              style={{ gridColumn: col + 1, gridRow: row + 1, background: ownerColor }}
            >
              {groupColor && edge && (
                <div className={`mini-board-tile-bar mini-board-tile-bar-${edge}`} style={{ background: groupColor }} />
              )}
            </div>
          );
        })}

        <MiniBoardStandings
          state={state}
          genomeNumber={genomeNumber}
          fitnessLabel={fitnessLabel}
          gamesCompleted={gamesCompleted}
          gamesPerGenome={gamesPerGenome}
          done={done}
        />

        {state.players.map((player, i) => {
          const { left, top } = spaceToPercent(player.position);
          return (
            <div
              key={player.id}
              className="mini-board-token"
              style={{ left: `${left}%`, top: `${top}%`, background: PLAYER_COLORS[i], opacity: player.bankrupt ? 0.25 : 1 }}
              title={player.name}
            />
          );
        })}
      </div>
    </div>
  );
}

/** One active player's accumulated value, split into the three components a bar segment shows. */
function playerValue(state: GameState, playerId: string) {
  const cash = state.players.find((p) => p.id === playerId)?.cash ?? 0;
  const equity = Math.max(0, netWorth(state, playerId) - cash);
  const rent = maxRentThreat(state, playerId);
  return { cash, equity, rent, total: cash + equity + rent };
}

/** Completed color-group monopolies (railroads/utilities excluded — matches `PlayerPanel.tsx`'s
 * own `countMonopolies` convention on the full board). */
function countMonopolies(state: GameState, playerId: string): number {
  let count = 0;
  for (const [group, members] of Object.entries(GROUP_MEMBERS)) {
    if (group === "railroad" || group === "utility") continue;
    if (members.every((i) => state.ownership[i].ownerId === playerId)) count++;
  }
  return count;
}

/**
 * Sits in the board's otherwise-empty interior (grid lines 2/11 on both axes — the 9x9 square the
 * outer ring of tiles never occupies). Rather than printing cash/properties as numbers, each
 * player's accumulated value renders as a stacked bar: the bar's own length (relative to the
 * strongest player at the table right now) shows who's ahead at a glance, and its three segments —
 * cash, property equity (`netWorth` minus cash), and this player's single biggest rent weapon
 * (`maxRentThreat`) — show *how* they got there without needing to read a number.
 */
function MiniBoardStandings({
  state,
  genomeNumber,
  fitnessLabel,
  gamesCompleted,
  gamesPerGenome,
  done,
}: {
  state: GameState;
  genomeNumber: number;
  fitnessLabel: string | null;
  gamesCompleted: number;
  gamesPerGenome: number;
  done?: boolean;
}) {
  const values = new Map(state.players.filter((p) => !p.bankrupt).map((p) => [p.id, playerValue(state, p.id)]));
  const maxTotal = Math.max(1, ...Array.from(values.values(), (v) => v.total));
  const currentGame = done ? gamesPerGenome : Math.min(gamesCompleted + 1, gamesPerGenome);

  return (
    <div className="mini-board-standings" style={{ gridColumn: "2 / 11", gridRow: "2 / 11" }}>
      <div className="mini-board-standings-header">
        <span className="mini-board-standings-genome">
          Genome {genomeNumber}
          {fitnessLabel && ` — ${fitnessLabel}`}
        </span>
        <span className="mini-board-standings-turn">
          Turn {state.turn} · Game {currentGame}/{gamesPerGenome}
        </span>
      </div>
      {state.players.map((player, i) => {
        const isCurrent = i === state.currentPlayerIndex && !state.winnerId;
        const Icon = TOKEN_ICONS[i % TOKEN_ICONS.length];
        const value = values.get(player.id);
        const monopolies = player.bankrupt ? 0 : countMonopolies(state, player.id);
        return (
          <div
            key={player.id}
            className={`mini-board-standings-row ${isCurrent ? "current" : ""} ${player.bankrupt ? "bankrupt" : ""}`}
            style={{ ["--player-color" as string]: PLAYER_COLORS[i % PLAYER_COLORS.length] }}
          >
            <Icon size={11} strokeWidth={2.5} color={player.bankrupt ? "#555" : PLAYER_COLORS[i % PLAYER_COLORS.length]} />
            <span className="mini-board-standings-name">{player.name}</span>
            {/* Fixed-width regardless of contents, so the value bar starts at the same x on every
                row — letting it shift per-row depending on whether a jail/monopoly badge happened
                to render was the "monopoly counter eating into the bar" complaint. */}
            <span className="mini-board-status-slot">
              {!player.bankrupt && player.inJail && <Lock className="mini-board-jail-icon" size={9} strokeWidth={2.5} />}
              {monopolies > 0 && (
                <span className="mini-board-monopoly-badge" title={`${monopolies} monopol${monopolies === 1 ? "y" : "ies"}`}>
                  <Star size={9} strokeWidth={2.5} />
                  {monopolies}
                </span>
              )}
            </span>
            {player.bankrupt || !value ? (
              <span className="mini-board-standings-out">OUT</span>
            ) : (
              <span className="mini-board-value-track" title={`Cash $${value.cash.toLocaleString()} · Equity $${Math.round(value.equity).toLocaleString()} · Max rent $${value.rent.toLocaleString()}`}>
                <span className="mini-board-value-fill" style={{ width: `${(value.total / maxTotal) * 100}%` }}>
                  <span style={{ flex: value.cash || 0.0001, background: VALUE_COLORS.cash }} />
                  <span style={{ flex: value.equity || 0.0001, background: VALUE_COLORS.equity }} />
                  <span style={{ flex: value.rent || 0.0001, background: VALUE_COLORS.rent }} />
                </span>
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export { GRID_SIZE as MINI_BOARD_GRID_SIZE };
