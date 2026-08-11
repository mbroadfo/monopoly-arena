import { GROUP_MEMBERS } from "../board.js";
import { findMonopolyCompletionTargets, propertyValue } from "../bots/shared.js";
import type { GameState, Ownable, TradeOffer } from "../types.js";
import { scoreProperty } from "./encoding.js";
import type { Genome } from "./types.js";

// A cash offer's premium above the missing property's own face price scales with the *group's*
// total value, not just the one piece — completing a monopoly is worth far more than a single
// property's price (the doubled base rent alone, before even building), so a persuasive offer
// needs to reflect that real prize, not a flat 1.5x/2x multiple of the smallest piece of it.
const GROUP_VALUE_PREMIUM_FRACTIONS = [0.1, 0.25, 0.5];
const SWEETENER_CAP_LEVEL = 3; // matches NaiveBot/OrangeRushBot's own convention for a "goodwill" cap

/**
 * Structural, genome-independent candidate generation — mirrors `encoding.ts`'s split between
 * state-only `buildableCandidates` and genome-dependent `scoreProperty`. Enumerates plausible
 * trade offers `playerId` could propose, for `scoreTradeCandidate` to rank; the engine only allows
 * one propose/accept-or-reject attempt per turn (`Game.runTradePhase`), so `createNeatBot` picks
 * the single best-scoring candidate from this list rather than negotiating.
 *
 * Reuses `findMonopolyCompletionTargets` (`bots/shared.ts`, already relied on by
 * NaiveBot/OrangeRushBot) for "I'm missing exactly one piece of a group" opportunities.
 */
export function generateTradeCandidates(state: GameState, playerId: string): TradeOffer[] {
  const player = state.players.find((p) => p.id === playerId)!;
  const candidates: TradeOffer[] = [];

  for (const target of findMonopolyCompletionTargets(state, playerId)) {
    const space = state.spaces[target.spaceIndex] as Ownable;
    const groupValue = propertyValue(state, GROUP_MEMBERS[(space as { group: string }).group]);
    const cashOffers = GROUP_VALUE_PREMIUM_FRACTIONS.map((fraction) => Math.round(space.price + fraction * groupValue));

    for (const offeredCash of cashOffers) {
      if (offeredCash > player.cash) continue;
      candidates.push({
        fromPlayerId: playerId,
        toPlayerId: target.ownerId,
        offeredProperties: [],
        offeredCash,
        offeredGetOutOfJailFreeCards: 0,
        requestedProperties: [target.spaceIndex],
        requestedCash: 0,
        requestedGetOutOfJailFreeCards: 0,
        conditions: [],
      });
    }

    // A sweetened variant at the smallest premium: same cash, plus a rent-cap condition
    // protecting the counterparty on the property they're giving up — a non-cash sweetener, same
    // pattern NaiveBot/OrangeRushBot already use.
    const sweetenedCash = cashOffers[0];
    if (sweetenedCash <= player.cash) {
      candidates.push({
        fromPlayerId: playerId,
        toPlayerId: target.ownerId,
        offeredProperties: [],
        offeredCash: sweetenedCash,
        offeredGetOutOfJailFreeCards: 0,
        requestedProperties: [target.spaceIndex],
        requestedCash: 0,
        requestedGetOutOfJailFreeCards: 0,
        conditions: [
          { spaceIndex: target.spaceIndex, ownerId: playerId, protectedPlayerId: target.ownerId, kind: "cap", capLevel: SWEETENER_CAP_LEVEL },
        ],
      });
    }

    // Mutual-monopoly check: does the counterparty also have a "missing exactly one" group where
    // I hold the missing piece? If so, a straight property-for-property swap — both players
    // complete a monopoly in one deal, no cash needed.
    const reciprocalTargets = findMonopolyCompletionTargets(state, target.ownerId).filter((t) => t.ownerId === playerId);
    for (const reciprocal of reciprocalTargets) {
      candidates.push({
        fromPlayerId: playerId,
        toPlayerId: target.ownerId,
        offeredProperties: [reciprocal.spaceIndex],
        offeredCash: 0,
        offeredGetOutOfJailFreeCards: 0,
        requestedProperties: [target.spaceIndex],
        requestedCash: 0,
        requestedGetOutOfJailFreeCards: 0,
        conditions: [],
      });
    }
  }

  return candidates;
}

export interface TradeCandidateScore {
  offer: TradeOffer;
  myGain: number;
  counterpartyGain: number;
  /** min(myGain, counterpartyGain) — high only when the deal looks good from both sides, which is
   * the actual substance of "fair, within boundaries" rather than just self-interested. */
  fairness: number;
}

const CASH_SCALE = 1500; // matches encoding.ts's own cash-normalization convention

function valueTo(genome: Genome, state: GameState, viewerId: string, spaceIndices: number[]): number {
  return spaceIndices.reduce((sum, i) => sum + scoreProperty(genome, state, viewerId, i), 0);
}

/**
 * Values both sides of `offer` using the *same* `scoreProperty` function already driving
 * buy/bid/build — no separate evolved output needed. `offer.fromPlayerId`/`toPlayerId` (not a
 * separately-passed player id) determine which side is "mine" vs. "the counterparty's", so this
 * gives the same answer regardless of which of the two players' bot calls it — `proposeTrade`
 * reads `myGain`/`fairness`, `evaluateTrade` (called on the receiving player) reads
 * `counterpartyGain`.
 */
export function scoreTradeCandidate(genome: Genome, state: GameState, offer: TradeOffer): TradeCandidateScore {
  const proposerId = offer.fromPlayerId;
  const counterpartyId = offer.toPlayerId;
  const cashDelta = (offer.requestedCash - offer.offeredCash) / CASH_SCALE;

  const myGain =
    valueTo(genome, state, proposerId, offer.requestedProperties) - valueTo(genome, state, proposerId, offer.offeredProperties) + cashDelta;
  const counterpartyGain =
    valueTo(genome, state, counterpartyId, offer.offeredProperties) -
    valueTo(genome, state, counterpartyId, offer.requestedProperties) -
    cashDelta;

  return { offer, myGain, counterpartyGain, fairness: Math.min(myGain, counterpartyGain) };
}
