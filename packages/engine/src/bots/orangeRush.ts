import { GROUP_MEMBERS } from "../board.js";
import type { Bot, ColorGroup, FinanceAction, GameState, Ownable, PropertySpace, TradeOffer } from "../types.js";
import {
  completesMonopolyFor,
  findMonopolyCompletionTargets,
  findMutualMonopolyTargets,
  houseAuctionCeiling,
  MAX_DESPERATION_DISCOUNT,
  MAX_DESPERATION_SWEETENER,
  MONOPOLY_COMPLETION_PREMIUM,
  mortgageCandidates,
  ownedMortgaged,
  percentPropertiesUnowned,
  propertyValue,
  standingDesperation,
  unmortgageCost,
} from "./shared.js";

const PRIORITY_GROUPS = new Set<ColorGroup>(["orange", "red"]);
const PRIORITY_RESERVE = 20;
// Stays aggressive about tempo longer than Naive — being back on the board fast is the whole
// strategy — but even this bot stops paying once the board is mostly claimed and a landing is a
// real risk.
const JAIL_DANGER_THRESHOLD = 0.3;
// How much more than face houseCost this bot will bid for a scarce house/hotel piece — steeper
// for orange/red, matching its auction/trade premiums there.
const HOUSE_AUCTION_MULTIPLIER_PRIORITY = 2;
const HOUSE_AUCTION_MULTIPLIER = 1.2;

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

  const chooseHouseToBuild = (state: GameState, playerId: string): number | null => {
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
  };

  return {
    name: "OrangeRushBot",

    shouldBuyProperty(state: GameState, playerId: string, spaceIndex: number): boolean {
      const player = state.players.find((p) => p.id === playerId)!;
      const space = state.spaces[spaceIndex] as PropertySpace | { price: number; group?: ColorGroup };
      const effectiveReserve = isPriorityGroup(space) ? PRIORITY_RESERVE : reserve;
      return player.cash - space.price >= effectiveReserve;
    },

    chooseHouseToBuild,

    houseAuctionBid(state: GameState, playerId: string, currentBid: number): number | null {
      const player = state.players.find((p) => p.id === playerId)!;
      const target = chooseHouseToBuild(state, playerId);
      if (target === null) return null;
      const priority = isPriorityGroup(state.spaces[target] as { group?: ColorGroup });
      const ceiling = houseAuctionCeiling(state, target, priority ? HOUSE_AUCTION_MULTIPLIER_PRIORITY : HOUSE_AUCTION_MULTIPLIER);
      const nextBid = currentBid + 10;
      if (nextBid > ceiling || nextBid > player.cash) return null;
      return nextBid;
    },

    shouldPayToLeaveJail(state: GameState, playerId: string): boolean {
      // Wants back on the board fast to keep buying and collecting rent.
      const player = state.players.find((p) => p.id === playerId)!;
      return player.cash - 50 >= PRIORITY_RESERVE && percentPropertiesUnowned(state) >= JAIL_DANGER_THRESHOLD;
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

    proposeTrade(state: GameState, playerId: string): TradeOffer | null {
      const targets = findMonopolyCompletionTargets(state, playerId).filter((t) =>
        isPriorityGroup(state.spaces[t.spaceIndex] as { group?: ColorGroup }),
      );
      const target = targets[0];
      if (!target) return null;

      // A straight swap needs no cash — but never offer up one of its own orange/red pieces to
      // get it, matching the same refusal `evaluateTrade` applies on the receiving end.
      const swapIndex = findMutualMonopolyTargets(state, playerId, target.ownerId, target.spaceIndex).find(
        (i) => !isPriorityGroup(state.spaces[i] as { group?: ColorGroup }),
      );
      if (swapIndex !== undefined) {
        return {
          fromPlayerId: playerId,
          toPlayerId: target.ownerId,
          offeredProperties: [swapIndex],
          offeredCash: 0,
          offeredGetOutOfJailFreeCards: 0,
          requestedProperties: [target.spaceIndex],
          requestedCash: 0,
          requestedGetOutOfJailFreeCards: 0,
          conditions: [],
        };
      }

      const player = state.players.find((p) => p.id === playerId)!;
      const space = state.spaces[target.spaceIndex] as PropertySpace;
      // More aggressive than a flat cash offer — matches its auction premium. Sweetens further
      // the further behind it is, trying to actually get a deal done.
      const cashOffer = Math.round(space.price * (1.7 + standingDesperation(state, playerId) * MAX_DESPERATION_SWEETENER));
      if (player.cash - cashOffer < PRIORITY_RESERVE) return null;

      return {
        fromPlayerId: playerId,
        toPlayerId: target.ownerId,
        offeredProperties: [],
        offeredCash: cashOffer,
        offeredGetOutOfJailFreeCards: 0,
        requestedProperties: [target.spaceIndex],
        requestedCash: 0,
        requestedGetOutOfJailFreeCards: 0,
        conditions: [{ spaceIndex: target.spaceIndex, ownerId: playerId, protectedPlayerId: target.ownerId, kind: "cap", capLevel: 3 }],
      };
    },

    evaluateTrade(state: GameState, playerId: string, offer: TradeOffer): boolean {
      const player = state.players.find((p) => p.id === playerId)!;
      // Won't give up an orange/red property regardless of price — that's the whole strategy.
      const givingUpPriority = offer.requestedProperties.some((i) => isPriorityGroup(state.spaces[i] as { group?: ColorGroup }));
      if (givingUpPriority) return false;

      // No monopoly-completion premium on the giving side beyond this point — the hard refusal
      // above already defends orange/red unconditionally, so anything reaching here is outside
      // its home turf. It lets those go at face value rather than holding out for value on a
      // group it was never going to build on.
      const gainsMonopoly = offer.offeredProperties.some((i) => completesMonopolyFor(state, playerId, i, offer.fromPlayerId));

      const offeredPropsValue = propertyValue(state, offer.offeredProperties) * (gainsMonopoly ? MONOPOLY_COMPLETION_PREMIUM : 1);
      const gaining = offer.offeredCash + offeredPropsValue;

      const protectedByCondition = offer.conditions.some((c) => c.protectedPlayerId === playerId);
      const requestedPropsValue = propertyValue(state, offer.requestedProperties);
      const adjustedRequestedPropsValue = protectedByCondition ? requestedPropsValue * 0.7 : requestedPropsValue;
      // The further behind the current leader, the more of that value it discounts away just to
      // get a deal done — a losing player trying to change the board state, not hold out for fair.
      const desperationDiscount = 1 - standingDesperation(state, playerId) * MAX_DESPERATION_DISCOUNT;
      const giving = (offer.requestedCash + adjustedRequestedPropsValue) * desperationDiscount;

      const cashAfter = player.cash + offer.offeredCash - offer.requestedCash;
      return gaining >= giving && cashAfter >= reserve;
    },
  };
}
