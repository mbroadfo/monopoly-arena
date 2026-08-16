import { GROUP_MEMBERS } from "../board.js";
import type { Bot, FinanceAction, GameState, Ownable, PropertySpace, TradeOffer } from "../types.js";
import {
  completesMonopolyFor,
  houseAuctionCeiling,
  MAX_DESPERATION_DISCOUNT,
  MONOPOLY_COMPLETION_PREMIUM,
  propertyValue,
  standingDesperation,
} from "./shared.js";

const MIN_CASH_BUFFER = 50;
// No particular urgency here either — bids only up to face houseCost, matching its "buys whatever
// it can afford" character rather than fighting for a scarce piece.
const HOUSE_AUCTION_MULTIPLIER = 1;

const chooseHouseToBuild = (state: GameState, playerId: string): number | null => {
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
};

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
    shouldPayToLeaveJail(_state: GameState, _playerId: string): boolean {
      // Deliberately not graduated by board danger like the other reference bots — reckless by
      // design, matching its always-buy, no-reserve-check character everywhere else.
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
    proposeTrade(_state: GameState, _playerId: string): TradeOffer | null {
      // Stays passive here too — no deliberate trade strategy, matching everything else about it.
      return null;
    },
    evaluateTrade(state: GameState, playerId: string, offer: TradeOffer): boolean {
      // Accepts anything that isn't a clear net loss — no reserve check, matching its
      // existing reckless build behavior. Does recognize when an offered property would complete
      // its own monopoly, though — worth far more than face price, and missing that was a real
      // blind spot: it would decline an outright great deal just because the face-value cash/
      // property comparison looked lopsided. No matching defense on the giving side — still
      // reckless about what it gives up, just not blind to what it's being handed.
      const gainsMonopoly = offer.offeredProperties.some((i) => completesMonopolyFor(state, playerId, i, offer.fromPlayerId));
      const gaining = offer.offeredCash + propertyValue(state, offer.offeredProperties) * (gainsMonopoly ? MONOPOLY_COMPLETION_PREMIUM : 1);
      // The further behind the current leader, the more of that value it discounts away just to
      // get a deal done — a losing player trying to change the board state, not hold out for fair.
      const desperationDiscount = 1 - standingDesperation(state, playerId) * MAX_DESPERATION_DISCOUNT;
      const giving = (offer.requestedCash + propertyValue(state, offer.requestedProperties)) * desperationDiscount;
      return gaining >= giving;
    },
  };
}
