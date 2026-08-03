import { GROUP_MEMBERS } from "../board.js";
import type { Bot, ColorGroup, FinanceAction, GameState, Ownable, PropertySpace, TradeOffer } from "../types.js";
import { ownedMortgaged, propertyValue, unmortgageCost } from "./shared.js";

const INCOME_GROUPS = new Set<ColorGroup>(["railroad", "utility"]);

function isIncomeGroup(space: { group?: ColorGroup }): boolean {
  return space.group !== undefined && INCOME_GROUPS.has(space.group);
}

export interface RailroadBaronBotOptions {
  /** Minimum cash to keep on hand before buying color properties or building. */
  cashReserve?: number;
}

/**
 * Plays for steady, low-risk income instead of monopolies: always grabs railroads and
 * utilities regardless of cash reserve (cheap, and rent scales sharply with how many it
 * owns), keeps a large cushion before ever touching a color property or building a house,
 * and would rather sit out jail than risk landing on an opponent's ground.
 */
export function createRailroadBaronBot(options: RailroadBaronBotOptions = {}): Bot {
  const reserve = options.cashReserve ?? 300;

  return {
    name: "RailroadBaronBot",

    shouldBuyProperty(state: GameState, playerId: string, spaceIndex: number): boolean {
      const player = state.players.find((p) => p.id === playerId)!;
      const space = state.spaces[spaceIndex] as PropertySpace | { price: number; group?: ColorGroup };
      if (isIncomeGroup(space)) return player.cash >= space.price;
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
        if (indices.some((i) => state.ownership[i].mortgaged)) continue;
        if (indices.some((i) => state.ownership[i].hotel)) continue;

        for (const index of indices) {
          const record = state.ownership[index];
          const space = state.spaces[index] as PropertySpace;
          // Building is a last resort here, not the plan — leave an extra-large cushion.
          if (player.cash - space.houseCost < reserve * 1.5) continue;
          if (bestChoice === null || record.houses < bestChoice.houses) {
            bestChoice = { index, houses: record.houses };
          }
        }
      }
      return bestChoice ? bestChoice.index : null;
    },

    shouldPayToLeaveJail(_state: GameState, _playerId: string): boolean {
      // Jail is a free, safe place to wait out risk from opponents' monopolies.
      return false;
    },

    raiseCash(state: GameState, playerId: string, _amountNeeded: number): number | null {
      const candidates = mortgageCandidatesProtectingIncome(state, playerId);
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
      const income = isIncomeGroup(space);
      const nextBid = currentBid + 10;
      if (!income && player.cash - nextBid < reserve) return null;
      // Willing to pay a real premium for railroads/utilities — a 4th railroad alone
      // doubles rent, and a 2nd utility multiplies it 2.5x.
      const ceiling = income ? space.price * 1.3 : space.price * 0.75;
      if (nextBid > ceiling || nextBid > player.cash) return null;
      return nextBid;
    },

    proposeTrade(state: GameState, playerId: string): TradeOffer | null {
      const player = state.players.find((p) => p.id === playerId)!;
      const target = findIncomeTarget(state, playerId);
      if (!target) return null;

      const space = state.spaces[target.spaceIndex] as Ownable;
      // Matches its auction ceiling for railroads/utilities.
      const cashOffer = Math.round(space.price * 1.3);
      if (player.cash - cashOffer < reserve) return null;

      return {
        fromPlayerId: playerId,
        toPlayerId: target.ownerId,
        offeredProperties: [],
        offeredCash: cashOffer,
        offeredGetOutOfJailFreeCards: 0,
        requestedProperties: [target.spaceIndex],
        requestedCash: 0,
        requestedGetOutOfJailFreeCards: 0,
        // No rent-cap sweetener here — conditions only apply to color properties.
        conditions: [],
      };
    },

    evaluateTrade(state: GameState, playerId: string, offer: TradeOffer): boolean {
      const player = state.players.find((p) => p.id === playerId)!;
      // Won't give up a railroad/utility regardless of price — that's the whole strategy.
      const givingUpIncome = offer.requestedProperties.some((i) => isIncomeGroup(state.spaces[i] as { group?: ColorGroup }));
      if (givingUpIncome) return false;

      const gaining = offer.offeredCash + propertyValue(state, offer.offeredProperties);
      const giving = offer.requestedCash + propertyValue(state, offer.requestedProperties);
      const protectedByCondition = offer.conditions.some((c) => c.protectedPlayerId === playerId);
      const effectiveGiving = protectedByCondition ? giving * 0.7 : giving;
      const cashAfter = player.cash + offer.offeredCash - offer.requestedCash;
      return gaining >= effectiveGiving && cashAfter >= reserve;
    },
  };
}

/** Owns at least one but not all of a railroad/utility group, and someone else owns a missing
 * piece — a direct check rather than findMonopolyCompletionTargets, which excludes these groups. */
function findIncomeTarget(state: GameState, playerId: string): { spaceIndex: number; ownerId: string } | null {
  for (const group of ["railroad", "utility"] as const) {
    const indices = GROUP_MEMBERS[group];
    const ownedByMe = indices.filter((i) => state.ownership[i].ownerId === playerId);
    if (ownedByMe.length === 0 || ownedByMe.length === indices.length) continue;

    const missing = indices.find((i) => state.ownership[i].ownerId !== playerId)!;
    const missingOwnerId = state.ownership[missing].ownerId;
    if (!missingOwnerId) continue;
    return { spaceIndex: missing, ownerId: missingOwnerId };
  }
  return null;
}

/** Mortgages color properties before ever touching a railroad or utility. */
function mortgageCandidatesProtectingIncome(state: GameState, playerId: string): number[] {
  const owned = Object.entries(state.ownership)
    .filter(([, r]) => r.ownerId === playerId && !r.mortgaged && !r.hotel && r.houses === 0)
    .map(([i]) => Number(i));

  return owned.sort((a, b) => {
    const aIncome = isIncomeGroup(state.spaces[a] as { group?: ColorGroup }) ? 1 : 0;
    const bIncome = isIncomeGroup(state.spaces[b] as { group?: ColorGroup }) ? 1 : 0;
    if (aIncome !== bIncome) return aIncome - bIncome;
    return (state.spaces[a] as Ownable).price - (state.spaces[b] as Ownable).price;
  });
}
