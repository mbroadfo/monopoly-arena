import type { GameState } from "@monopoly-arena/engine";
import { PLAYER_COLORS, TOKEN_ICONS } from "./boardLayout";

export function PlayerPanel({ state }: { state: GameState }) {
  return (
    <div className="player-panel">
      {state.players.map((player, i) => {
        const ownedCount = Object.values(state.ownership).filter((r) => r.ownerId === player.id).length;
        const isCurrent = i === state.currentPlayerIndex && !state.winnerId;
        const Icon = TOKEN_ICONS[i % TOKEN_ICONS.length];
        return (
          <div key={player.id} className={`player-card ${player.bankrupt ? "bankrupt" : ""} ${isCurrent ? "current" : ""}`}>
            <div className="player-swatch" style={{ background: PLAYER_COLORS[i % PLAYER_COLORS.length] }}>
              <Icon size={17} strokeWidth={2.5} />
            </div>
            <div className="player-info">
              <div className="player-name">
                {player.name} {isCurrent && "▶"}
              </div>
              <div className="player-cash-row">
                <span className="player-cash">${player.cash.toLocaleString()}</span>
                <span className="player-meta">{ownedCount} properties</span>
              </div>
              {(player.inJail || player.bankrupt) && (
                <div className="player-meta">
                  {player.inJail ? "in jail" : ""}
                  {player.bankrupt ? "bankrupt" : ""}
                </div>
              )}
            </div>
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
