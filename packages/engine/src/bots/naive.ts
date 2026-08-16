import { GROUP_MEMBERS } from "../board.js";
import type { Bot, ColorGroup, FinanceAction, GameState, PropertySpace, TradeOffer } from "../types.js";
import {
  completesMonopolyFor,
  findMonopolyCompletionTargets,
  findMutualMonopolyTargets,
  houseAuctionCeiling,
  MONOPOLY_COMPLETION_PREMIUM,
  mortgageCandidates,
  ownedMortgaged,
  percentPropertiesUnowned,
  propertyValue,
  unmortgageCost,
} from "./shared.js";

export interface NaiveBotOptions {
  /** Minimum cash to keep on hand before buying or building. */
  cashReserve?: number;
  /**
   * Its "home turf" — biases which monopoly it builds on first once it owns several, which
   * missing piece it hunts for in trades, and how readily it lets go of properties outside this
   * group. Purely a tie-break/priority, not a hard restriction: still buys, builds, and trades
   * everywhere else exactly as before. Keeps multiple otherwise-neutral bots (this one, and
   * MonteCarloBot, which delegates here) from all competing for the same handful of monopolies —
   * a real cause of the house-supply stalemates a fully generic bot is prone to.
   */
  preferredGroup?: ColorGroup;
}

// Pays to leave jail only while at least half the board is still unclaimed — early on there's
// little to fear from an unlucky landing, but as the board fills in, waiting out a turn in jail
// beats risking rent on a property it doesn't control.
const JAIL_DANGER_THRESHOLD = 0.5;
// How much more than face houseCost this bot will bid for a scarce house/hotel piece.
const HOUSE_AUCTION_MULTIPLIER = 1.5;

/**
 * Buys any property it can afford above its cash reserve, builds evenly across
 * monopolies it completes (preferring its home group first once it holds several), and only
 * pays to leave jail once it has spare cash and the board is still safe enough to risk moving.
 */
export function createNaiveBot(options: NaiveBotOptions = {}): Bot {
  const reserve = options.cashReserve ?? 150;
  const preferredGroup = options.preferredGroup ?? "green";

  const chooseHouseToBuild = (state: GameState, playerId: string): number | null => {
    const player = state.players.find((p) => p.id === playerId)!;
    const buildableGroups = (Object.entries(GROUP_MEMBERS) as [ColorGroup, number[]][])
      .filter(([group]) => group !== "railroad" && group !== "utility")
      .sort(([a], [b]) => Number(b === preferredGroup) - Number(a === preferredGroup));

    let bestChoice: { index: number; houses: number; preferred: boolean } | null = null;
    for (const [group, indices] of buildableGroups) {
      const ownsAll = indices.every((i) => state.ownership[i].ownerId === playerId);
      if (!ownsAll) continue;
      const anyMortgaged = indices.some((i) => state.ownership[i].mortgaged);
      if (anyMortgaged) continue;
      const anyHotel = indices.some((i) => state.ownership[i].hotel);
      if (anyHotel) continue;

      const preferred = group === preferredGroup;
      for (const index of indices) {
        const record = state.ownership[index];
        const space = state.spaces[index] as PropertySpace;
        if (player.cash - space.houseCost < reserve) continue;
        const better =
          bestChoice === null || (preferred && !bestChoice.preferred) || (preferred === bestChoice.preferred && record.houses < bestChoice.houses);
        if (better) bestChoice = { index, houses: record.houses, preferred };
      }
    }
    return bestChoice ? bestChoice.index : null;
  };

  return {
    name: "NaiveBot",

    shouldBuyProperty(state: GameState, playerId: string, spaceIndex: number): boolean {
      const player = state.players.find((p) => p.id === playerId)!;
      const space = state.spaces[spaceIndex] as PropertySpace | { price: number };
      return player.cash - space.price >= reserve;
    },

    chooseHouseToBuild,

    houseAuctionBid(state: GameState, playerId: string, currentBid: number): number | null {
      const player = state.players.find((p) => p.id === playerId)!;
      const target = chooseHouseToBuild(state, playerId);
      if (target === null) return null;
      const ceiling = houseAuctionCeiling(state, target, HOUSE_AUCTION_MULTIPLIER);
      const nextBid = currentBid + 10;
      if (nextBid > ceiling || nextBid > player.cash) return null;
      return nextBid;
    },

    shouldPayToLeaveJail(state: GameState, playerId: string): boolean {
      const player = state.players.find((p) => p.id === playerId)!;
      return player.cash - 50 >= reserve && percentPropertiesUnowned(state) >= JAIL_DANGER_THRESHOLD;
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
      const targets = findMonopolyCompletionTargets(state, playerId).sort(
        (a, b) =>
          Number((state.spaces[b.spaceIndex] as PropertySpace).group === preferredGroup) -
          Number((state.spaces[a.spaceIndex] as PropertySpace).group === preferredGroup),
      );
      const target = targets[0];
      if (!target) return null;

      // A straight swap that completes a monopoly for both sides needs no cash and no
      // sweetener — check for one before falling back to a cash offer.
      const swapIndex = findMutualMonopolyTargets(state, playerId, target.ownerId, target.spaceIndex)[0];
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

      // Each side's property value is scaled up when it's the missing piece of a monopoly for
      // whoever would receive it — worth far more than face price, on both the giving and
      // receiving end, which is what makes an even-priced mutual swap actually add up as fair.
      // Only defended this hard for its own home group, though — properties outside it aren't
      // part of the plan anyway, so it lets those go at a friendlier price rather than holding
      // out for full value on something it was never going to build on.
      const gainsMonopoly = offer.offeredProperties.some((i) => completesMonopolyFor(state, playerId, i, offer.fromPlayerId));
      const givesUpPreferredMonopoly = offer.requestedProperties.some(
        (i) => (state.spaces[i] as PropertySpace).group === preferredGroup && completesMonopolyFor(state, offer.fromPlayerId, i, playerId),
      );

      const offeredPropsValue = propertyValue(state, offer.offeredProperties) * (gainsMonopoly ? MONOPOLY_COMPLETION_PREMIUM : 1);
      const gaining = offer.offeredCash + offeredPropsValue;

      // A property with a rent condition protecting me is less risky to give up.
      const protectedByCondition = offer.conditions.some((c) => c.protectedPlayerId === playerId);
      const requestedPropsValue = propertyValue(state, offer.requestedProperties);
      const adjustedRequestedPropsValue =
        (protectedByCondition ? requestedPropsValue * 0.7 : requestedPropsValue) * (givesUpPreferredMonopoly ? MONOPOLY_COMPLETION_PREMIUM : 1);
      const giving = offer.requestedCash + adjustedRequestedPropsValue;

      const cashAfter = player.cash + offer.offeredCash - offer.requestedCash;
      return gaining >= giving && cashAfter >= reserve;
    },
  };
}

