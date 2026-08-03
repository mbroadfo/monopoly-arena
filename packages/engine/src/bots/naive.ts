import { GROUP_MEMBERS } from "../board.js";
import type { Bot, FinanceAction, GameState, PropertySpace, TradeOffer } from "../types.js";
import { findMonopolyCompletionTargets, mortgageCandidates, ownedMortgaged, propertyValue, unmortgageCost } from "./shared.js";

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

    raiseCash(state: GameState, playerId: string, _amountNeeded: number): number | null {
      const candidates = mortgageCandidates(state, playerId);
      return candidates.length > 0 ? candidates[0] : null;
    },

    chooseFinanceAction(state: GameState, playerId: string): FinanceAction | null {
      const player = state.players.find((p) => p.id === playerId)!;
      for (const index of ownedMortgaged(state, playerId)) {
        const cost = unmortgageCost(state, index);
        if (player.cash - cost >= reserve) {
          return { action: "unmortgage", spaceIndex: index };
        }
      }
      return null;
    },

    auctionBid(state: GameState, playerId: string, spaceIndex: number, currentBid: number): number | null {
      const player = state.players.find((p) => p.id === playerId)!;
      const space = state.spaces[spaceIndex] as PropertySpace | { price: number };
      const nextBid = currentBid + 10;
      // Never pay more than face value, and never bid below the cash reserve.
      if (nextBid > space.price) return null;
      if (player.cash - nextBid < reserve) return null;
      return nextBid;
    },

    proposeTrade(state: GameState, playerId: string): TradeOffer | null {
      const player = state.players.find((p) => p.id === playerId)!;
      const target = findMonopolyCompletionTargets(state, playerId)[0];
      if (!target) return null;

      const space = state.spaces[target.spaceIndex] as PropertySpace;
      const cashOffer = Math.round(space.price * 1.5);
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
        // A goodwill sweetener: cap the seller's future rent there at the 3-house rate, so
        // handing over a monopoly-completing property doesn't mean eating uncapped risk.
        conditions: [{ spaceIndex: target.spaceIndex, ownerId: playerId, protectedPlayerId: target.ownerId, kind: "cap", capLevel: 3 }],
      };
    },

    evaluateTrade(state: GameState, playerId: string, offer: TradeOffer): boolean {
      const player = state.players.find((p) => p.id === playerId)!;
      const gaining = offer.offeredCash + propertyValue(state, offer.offeredProperties);
      const giving = offer.requestedCash + propertyValue(state, offer.requestedProperties);
      // A property with a rent condition protecting me is less risky to give up.
      const protectedByCondition = offer.conditions.some((c) => c.protectedPlayerId === playerId);
      const effectiveGiving = protectedByCondition ? giving * 0.7 : giving;
      const cashAfter = player.cash + offer.offeredCash - offer.requestedCash;
      return gaining >= effectiveGiving && cashAfter >= reserve;
    },
  };
}

