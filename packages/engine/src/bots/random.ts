import { GROUP_MEMBERS } from "../board.js";
import type { Bot, FinanceAction, GameState, Ownable, PropertySpace } from "../types.js";

const MIN_CASH_BUFFER = 50;

/**
 * Buys whatever it can afford and builds evenly across any monopoly it completes (keeping
 * only a thin cash buffer), always tries to leave jail immediately. A monopoly holder that
 * never builds never escalates rent, which stalls the game indefinitely — so even a
 * "reckless" bot has to actually use its monopolies once it has them.
 */
export function createRandomBot(): Bot {
  return {
    name: "RandomBot",
    shouldBuyProperty(_state: GameState, _playerId: string, _spaceIndex: number): boolean {
      return true;
    },
    chooseHouseToBuild(state: GameState, playerId: string): number | null {
      const player = state.players.find((p) => p.id === playerId)!;
      const buildableGroups = Object.entries(GROUP_MEMBERS).filter(
        ([group]) => group !== "railroad" && group !== "utility",
      );

      let bestChoice: { index: number; houses: number } | null = null;
      for (const [, indices] of buildableGroups) {
        const ownsAll = indices.every((i) => state.ownership[i].ownerId === playerId);
        if (!ownsAll) continue;
        if (indices.some((i) => state.ownership[i].mortgaged)) continue;
        if (indices.some((i) => state.ownership[i].hotel)) continue;

        for (const index of indices) {
          const record = state.ownership[index];
          const space = state.spaces[index] as PropertySpace;
          if (player.cash - space.houseCost < MIN_CASH_BUFFER) continue;
          if (bestChoice === null || record.houses < bestChoice.houses) {
            bestChoice = { index, houses: record.houses };
          }
        }
      }
      return bestChoice ? bestChoice.index : null;
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
    auctionBid(state: GameState, playerId: string, spaceIndex: number, currentBid: number): number | null {
      const player = state.players.find((p) => p.id === playerId)!;
      const space = state.spaces[spaceIndex] as Ownable;
      const nextBid = currentBid + 10;
      // Willing to bid up to face value, whatever it can afford.
      return nextBid <= space.price && nextBid <= player.cash ? nextBid : null;
    },
  };
}
