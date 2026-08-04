import { GROUP_MEMBERS } from "@monopoly-arena/engine";
import type { ColorGroup, GameState } from "@monopoly-arena/engine";
import { GROUP_COLORS, PLAYER_COLORS, TOKEN_ICONS } from "./boardLayout";

const GROUP_ORDER: ColorGroup[] = [
  "brown",
  "lightblue",
  "pink",
  "orange",
  "red",
  "yellow",
  "green",
  "darkblue",
  "railroad",
  "utility",
];

const GROUP_LABELS: Record<ColorGroup, string> = {
  brown: "Brown",
  lightblue: "Light Blue",
  pink: "Pink",
  orange: "Orange",
  red: "Red",
  yellow: "Yellow",
  green: "Green",
  darkblue: "Dark Blue",
  railroad: "Railroads",
  utility: "Utilities",
};

/** Deed-rack view: every property grouped by color, moving from "unowned" styling to the
 * owner's color as it's bought, with badges for houses/hotel and mortgage status. */
export function PropertiesPanel({ state }: { state: GameState }) {
  return (
    <div className="properties-panel">
      {GROUP_ORDER.map((group) => {
        // A monopoly: every property in the group owned by the same single player.
        const owners = GROUP_MEMBERS[group].map((i) => state.ownership[i].ownerId);
        const soleOwnerId = owners[0];
        const hasMonopoly = soleOwnerId !== null && owners.every((id) => id === soleOwnerId);
        const monopolyOwnerIndex = hasMonopoly ? state.players.findIndex((p) => p.id === soleOwnerId) : -1;
        const MonopolyIcon = hasMonopoly ? TOKEN_ICONS[monopolyOwnerIndex % TOKEN_ICONS.length] : null;

        return (
          <div className="prop-group" key={group}>
            <div className="prop-group-header">
              <span className="prop-group-swatch" style={{ background: GROUP_COLORS[group] }} />
              <span className="prop-group-label">{GROUP_LABELS[group]}</span>
              {hasMonopoly && MonopolyIcon && (
                <span
                  className="monopoly-badge"
                  style={{ background: PLAYER_COLORS[monopolyOwnerIndex % PLAYER_COLORS.length] }}
                  title={`${state.players[monopolyOwnerIndex].name} owns a monopoly on ${GROUP_LABELS[group]}!`}
                >
                  <MonopolyIcon size={9} strokeWidth={2.5} />
                </span>
              )}
            </div>
            <div className="prop-chips">
              {GROUP_MEMBERS[group].map((index) => {
                const space = state.spaces[index];
                const record = state.ownership[index];
                const ownerIndex = record.ownerId ? state.players.findIndex((p) => p.id === record.ownerId) : -1;
                const ownerColor = ownerIndex >= 0 ? PLAYER_COLORS[ownerIndex % PLAYER_COLORS.length] : undefined;

                return (
                  <div
                    key={index}
                    className={`prop-chip ${record.ownerId ? "owned" : "unowned"} ${record.mortgaged ? "mortgaged" : ""}`}
                    style={ownerColor ? { borderColor: ownerColor, background: `${ownerColor}26` } : undefined}
                    title={space.name}
                  >
                    <span className="prop-chip-name">{space.name}</span>
                    <span className="prop-chip-badges">
                      {record.hotel && <span className="prop-badge hotel">H</span>}
                      {!record.hotel && record.houses > 0 && <span className="prop-badge houses">{record.houses}</span>}
                      {record.mortgaged && <span className="prop-badge mortgaged">M</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
