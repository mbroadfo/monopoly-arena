import type { Bot, GameState } from "../types.js";

/** Buys whatever it can afford, never builds deliberately, always tries to leave jail immediately. */
export function createRandomBot(): Bot {
  return {
    name: "RandomBot",
    shouldBuyProperty(_state: GameState, _playerId: string, _spaceIndex: number): boolean {
      return true;
    },
    chooseHouseToBuild(_state: GameState, _playerId: string): number | null {
      return null;
    },
    shouldPayToLeaveJail(_state: GameState, _playerId: string): boolean {
      return true;
    },
  };
}
