import { GROUP_MEMBERS } from "../board.js";
import type { Bot, ColorGroup, FinanceAction, GameState, Ownable, PropertySpace } from "../types.js";
import { mortgageCandidates, ownedMortgaged, unmortgageCost } from "./shared.js";

const PRIORITY_GROUPS = new Set<ColorGroup>(["orange", "red"]);
const PRIORITY_RESERVE = 20;

function isPriorityGroup(space: { group?: ColorGroup }): boolean {
  return space.group !== undefined && PRIORITY_GROUPS.has(space.group);
}

export interface OrangeRushBotOptions {
  /** Minimum cash to keep on hand for non-priority purchases/building. */
  cashReserve?: number;
}

/**
 * Targets the orange and red color groups — the most statistically landed-on properties,
 * since players leaving jail commonly roll a 6, 8, or 9 straight onto them. Buys and builds
 * on those groups with a razor-thin reserve and will even outbid face value for them at
 * auction, while playing everything else on the board more cautiously.
 */
export function createOrangeRushBot(options: OrangeRushBotOptions = {}): Bot {
  const reserve = options.cashReserve ?? 120;

  return {
    name: "OrangeRushBot",

    shouldBuyProperty(state: GameState, playerId: string, spaceIndex: number): boolean {
      const player = state.players.find((p) => p.id === playerId)!;
      const space = state.spaces[spaceIndex] as PropertySpace | { price: number; group?: ColorGroup };
      const effectiveReserve = isPriorityGroup(space) ? PRIORITY_RESERVE : reserve;
      return player.cash - space.price >= effectiveReserve;
    },

    chooseHouseToBuild(state: GameState, playerId: string): number | null {
      const player = state.players.find((p) => p.id === playerId)!;
      const buildableGroups = (Object.entries(GROUP_MEMBERS) as [ColorGroup, number[]][])
        .filter(([group]) => group !== "railroad" && group !== "utility")
        .sort(([a], [b]) => Number(PRIORITY_GROUPS.has(b)) - Number(PRIORITY_GROUPS.has(a)));

      let bestChoice: { index: number; houses: number; priority: boolean } | null = null;
      for (const [group, indices] of buildableGroups) {
        const ownsAll = indices.every((i) => state.ownership[i].ownerId === playerId);
        if (!ownsAll) continue;
        if (indices.some((i) => state.ownership[i].mortgaged)) continue;
        if (indices.some((i) => state.ownership[i].hotel)) continue;

        const priority = PRIORITY_GROUPS.has(group);
        const effectiveReserve = priority ? PRIORITY_RESERVE : reserve;
        for (const index of indices) {
          const record = state.ownership[index];
          const space = state.spaces[index] as PropertySpace;
          if (player.cash - space.houseCost < effectiveReserve) continue;
          const better =
            bestChoice === null || (priority && !bestChoice.priority) || (priority === bestChoice.priority && record.houses < bestChoice.houses);
          if (better) bestChoice = { index, houses: record.houses, priority };
        }
      }
      return bestChoice ? bestChoice.index : null;
    },

    shouldPayToLeaveJail(state: GameState, playerId: string): boolean {
      // Wants back on the board fast to keep buying and collecting rent.
      const player = state.players.find((p) => p.id === playerId)!;
      return player.cash - 50 >= PRIORITY_RESERVE;
    },

    raiseCash(state: GameState, playerId: string, _amountNeeded: number): number | null {
      const candidates = mortgageCandidates(state, playerId);
      return candidates.length > 0 ? candidates[0] : null;
    },

    chooseFinanceAction(state: GameState, playerId: string): FinanceAction | null {
      const player = state.players.find((p) => p.id === playerId)!;
      for (const index of ownedMortgaged(state, playerId)) {
        const cost = unmortgageCost(state, index);
        if (player.cash - cost >= reserve) return { action: "unmortgage", spaceIndex: index };
      }
      return null;
    },

    auctionBid(state: GameState, playerId: string, spaceIndex: number, currentBid: number): number | null {
      const player = state.players.find((p) => p.id === playerId)!;
      const space = state.spaces[spaceIndex] as Ownable & { group?: ColorGroup };
      const priority = isPriorityGroup(space);
      // Will pay a premium above face value for orange/red; lowballs everything else.
      const ceiling = priority ? space.price * 1.2 : space.price * 0.8;
      const nextBid = currentBid + 10;
      if (nextBid > ceiling || nextBid > player.cash) return null;
      return nextBid;
    },
  };
}
