import { BOARD } from "./board.js";
import type { GameState } from "./types.js";

export { mulberry32 } from "./dice.js";

/** A minimal, otherwise-empty two-player GameState for testing a bot or evaluation function in
 * isolation, without needing to orchestrate a real game turn to reach the scenario under test. */
export function baseState(overrides: Partial<GameState> = {}): GameState {
  const ownership: GameState["ownership"] = {};
  for (const space of BOARD) {
    if (space.type === "property" || space.type === "railroad" || space.type === "utility") {
      ownership[space.index] = { ownerId: null, houses: 0, hotel: false, mortgaged: false };
    }
  }
  return {
    turn: 1,
    spaces: BOARD,
    ownership,
    players: [
      { id: "p0", name: "Hero", cash: 1500, position: 0, inJail: false, jailTurns: 0, bankrupt: false, getOutOfJailFreeCards: 0 },
      { id: "p1", name: "Rival", cash: 1500, position: 0, inJail: false, jailTurns: 0, bankrupt: false, getOutOfJailFreeCards: 0 },
    ],
    currentPlayerIndex: 0,
    housesRemaining: 32,
    hotelsRemaining: 12,
    log: [],
    winnerId: null,
    doublesStreak: 0,
    tradeConditions: [],
    moves: [],
    ...overrides,
  };
}
