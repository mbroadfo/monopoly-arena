import { GROUP_MEMBERS } from "../board.js";
import type { Bot, GameState, PropertySpace } from "../types.js";

export interface NaiveBotOptions {
  /** Minimum cash to keep on hand before buying or building. */
  cashReserve?: number;
}

/**
 * Buys any property it can afford above its cash reserve, builds evenly across
 * monopolies it completes, and only pays to leave jail once it has spare cash.
 */
export function createNaiveBot(options: NaiveBotOptions = {}): Bot {
  const reserve = options.cashReserve ?? 150;

  return {
    name: "NaiveBot",

    shouldBuyProperty(state: GameState, playerId: string, spaceIndex: number): boolean {
      const player = state.players.find((p) => p.id === playerId)!;
      const space = state.spaces[spaceIndex] as PropertySpace | { price: number };
      return player.cash - space.price >= reserve;
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
        const anyMortgaged = indices.some((i) => state.ownership[i].mortgaged);
        if (anyMortgaged) continue;
        const anyHotel = indices.some((i) => state.ownership[i].hotel);
        if (anyHotel) continue;

        for (const index of indices) {
          const record = state.ownership[index];
          const space = state.spaces[index] as PropertySpace;
          if (player.cash - space.houseCost < reserve) continue;
          if (bestChoice === null || record.houses < bestChoice.houses) {
            bestChoice = { index, houses: record.houses };
          }
        }
      }
      return bestChoice ? bestChoice.index : null;
    },

    shouldPayToLeaveJail(state: GameState, playerId: string): boolean {
      const player = state.players.find((p) => p.id === playerId)!;
      return player.cash - 50 >= reserve;
    },
  };
}

