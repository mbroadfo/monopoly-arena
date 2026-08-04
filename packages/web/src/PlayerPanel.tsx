import { Home } from "lucide-react";
import { GROUP_MEMBERS } from "@monopoly-arena/engine";
import type { GameState } from "@monopoly-arena/engine";
import { PLAYER_COLORS, TOKEN_ICONS } from "./boardLayout";

function countOwnedProperties(playerId: string, state: GameState): number {
  return Object.values(state.ownership).filter((r) => r.ownerId === playerId).length;
}

/** A completed monopoly: every property in a color group owned by the same player. Railroads
 * and utilities don't count — GROUP_MEMBERS includes them too, so they're explicitly skipped
 * rather than duplicating the board's own list of color groups. */
function countMonopolies(playerId: string, state: GameState): number {
  let count = 0;
  for (const [group, members] of Object.entries(GROUP_MEMBERS)) {
    if (group === "railroad" || group === "utility") continue;
    if (members.every((i) => state.ownership[i].ownerId === playerId)) count++;
  }
  return count;
}

/** Development expressed in house-equivalents: each house = 1, each hotel = 5 (a property with
 * a hotel always has 0 houses on it — see OwnershipRecord — so this never double-counts). */
function countHouseEquivalents(playerId: string, state: GameState): number {
  let total = 0;
  for (const record of Object.values(state.ownership)) {
    if (record.ownerId !== playerId) continue;
    total += record.hotel ? 5 : record.houses;
  }
  return total;
}

export function PlayerPanel({ state }: { state: GameState }) {
  return (
    <div className="player-panel">
      {state.players.map((player, i) => {
        const isCurrent = i === state.currentPlayerIndex && !state.winnerId;
        const Icon = TOKEN_ICONS[i % TOKEN_ICONS.length];
        const properties = countOwnedProperties(player.id, state);
        const monopolies = countMonopolies(player.id, state);
        const development = countHouseEquivalents(player.id, state);

        return (
          <div key={player.id} className={`player-row ${player.bankrupt ? "bankrupt" : ""} ${isCurrent ? "current" : ""}`}>
            <div className="player-row-line1">
              <span
                className={`player-row-swatch ${player.bankrupt ? "bankrupt" : ""}`}
                style={{ ["--player-color" as string]: PLAYER_COLORS[i % PLAYER_COLORS.length] }}
              >
                <Icon size={12} strokeWidth={2.5} />
              </span>
              <span className="player-row-name">
                {player.name}
                {isCurrent && (
                  <span className="current-indicator" title="Current turn" aria-label="current turn">
                    {" "}
                    ▶
                  </span>
                )}
              </span>
              <span className="player-row-cash">{player.bankrupt ? <span className="bankrupt-label">BANKRUPT</span> : `$${player.cash.toLocaleString()}`}</span>
            </div>
            {!player.bankrupt && (
              <div className="player-row-line2">
                <span>
                  <strong>{properties}</strong> propert{properties === 1 ? "y" : "ies"}
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  <strong className={monopolies > 0 ? "stat-gold" : undefined}>{monopolies}</strong> monopol
                  {monopolies === 1 ? "y" : "ies"}
                </span>
                <span aria-hidden="true">·</span>
                <span className="stat-development" aria-label={`${development} house-equivalents of development`}>
                  <Home size={12} strokeWidth={2.75} aria-hidden="true" /> <strong>{development}</strong>
                </span>
              </div>
            )}
          </div>
        );
      })}
      {state.winnerId && (
        <div className="winner-banner">
          {state.players.find((p) => p.id === state.winnerId)?.name} wins!
        </div>
      )}
    </div>
  );
}
