import type { Bot, FinanceAction, GameState } from "../types.js";

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
    raiseCash(state: GameState, playerId: string, _amountNeeded: number): number | null {
      const eligible = Object.entries(state.ownership).find(
        ([, r]) => r.ownerId === playerId && !r.mortgaged && !r.hotel && r.houses === 0,
      );
      return eligible ? Number(eligible[0]) : null;
    },
    chooseFinanceAction(_state: GameState, _playerId: string): FinanceAction | null {
      return null;
    },
  };
}
