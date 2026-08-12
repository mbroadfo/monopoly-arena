import { GROUP_MEMBERS } from "../board.js";
import { findMonopolyCompletionTargets, maxOpponentRentThreat, propertyValue } from "../bots/shared.js";
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

  // Railroad/utility acquisition — excluded from findMonopolyCompletionTargets (rent there scales
  // with count owned rather than a single completed set), which used to mean NEAT could *never*
  // propose trading for a missing railroad even though accumulating them is exactly how
  // RailroadBaron dominates. Any opponent-held member of an income group where this player already
  // owns at least one piece (so the scaling benefit is real, not speculative) is a candidate, at
  // premiums scaled to the group's total value like the color-group offers above.
  for (const group of ["railroad", "utility"] as const) {
    const indices = GROUP_MEMBERS[group];
    const ownedByMe = indices.filter((i) => state.ownership[i].ownerId === playerId).length;
    if (ownedByMe === 0) continue;
    const groupValue = propertyValue(state, indices);

    for (const index of indices) {
      const record = state.ownership[index];
      if (!record.ownerId || record.ownerId === playerId) continue;
      const space = state.spaces[index] as Ownable;
      for (const fraction of GROUP_VALUE_PREMIUM_FRACTIONS) {
        const offeredCash = Math.round(space.price + fraction * groupValue);
        if (offeredCash > player.cash) continue;
        candidates.push({
          fromPlayerId: playerId,
          toPlayerId: record.ownerId,
          offeredProperties: [],
          offeredCash,
          offeredGetOutOfJailFreeCards: 0,
          requestedProperties: [index],
          requestedCash: 0,
          requestedGetOutOfJailFreeCards: 0,
          conditions: [],
        });
      }
    }
  }

  return candidates;
}

export interface TradeCandidateScore {
  offer: TradeOffer;
  myGain: number;
  counterpartyGain: number;
  /** min(myGain, counterpartyGain) — high only when the deal looks good from both sides. Kept as a
   * secondary signal (a mutually-great deal is the most likely to actually execute), but no longer
   * the ranking criterion: `createNeatBot.proposeTrade` extracts the most self-favorable deal the
   * counterparty is still predicted to accept, which is where leverage actually shows up. */
  fairness: number;
}

const CASH_SCALE = 1500; // matches encoding.ts's own cash-normalization convention

/**
 * How much more than face value each incremental dollar is worth to `playerId` right now, in
 * [0, 1] — the leverage mechanism behind `scoreTradeCandidate`. A player whose cash comfortably
 * covers two landings on the worst rent any opponent could charge (`maxOpponentRentThreat`) has
 * pressure 0: cash is worth its face value, no more. A player who couldn't survive even one such
 * landing approaches 1: cash in hand is what stands between them and bankruptcy, so a deal that
 * delivers cash is worth accepting on worse-than-face terms — and a deal that drains cash hurts
 * more than its face amount. This is how real players negotiate: the desperate side takes the
 * lopsided deal because their alternative is worse, and the comfortable side knows it can press.
 */
export function cashPressure(state: GameState, playerId: string): number {
  const player = state.players.find((p) => p.id === playerId)!;
  const threat = maxOpponentRentThreat(state, playerId);
  if (threat <= 0) return 0;
  const cushion = player.cash / (threat * 2);
  return Math.max(0, Math.min(1, 1 - cushion));
}

function valueTo(genome: Genome, state: GameState, viewerId: string, spaceIndices: number[]): number {
  return spaceIndices.reduce((sum, i) => sum + scoreProperty(genome, state, viewerId, i), 0);
}

/**
 * Values both sides of `offer` using the *same* `scoreProperty` function already driving
 * buy/bid/build — no separate evolved output needed. `offer.fromPlayerId`/`toPlayerId` (not a
 * separately-passed player id) determine which side is "mine" vs. "the counterparty's", so this
 * gives the same answer regardless of which of the two players' bot calls it — `proposeTrade`
 * reads `myGain` (and predicted acceptability via `counterpartyGain`), `evaluateTrade` (called on
 * the receiving player) reads `counterpartyGain`.
 *
 * Each side's cash delta is scaled by their own `cashPressure` — a desperate player's received
 * cash counts for up to double face value (and cash paid out hurts up to double), so the same
 * nominal offer scores very differently depending on who's under threat. That asymmetry is what
 * lets a proposer's ranking legitimately favor lopsided deals against a cornered opponent, and
 * what makes a cornered evaluator accept them — positions of strength and leverage, not flat
 * fairness.
 */
export function scoreTradeCandidate(genome: Genome, state: GameState, offer: TradeOffer): TradeCandidateScore {
  const proposerId = offer.fromPlayerId;
  const counterpartyId = offer.toPlayerId;
  const cashToProposer = (offer.requestedCash - offer.offeredCash) / CASH_SCALE; // negative when the proposer pays
  const proposerCashWeight = 1 + cashPressure(state, proposerId);
  const counterpartyCashWeight = 1 + cashPressure(state, counterpartyId);

  const myGain =
    valueTo(genome, state, proposerId, offer.requestedProperties) -
    valueTo(genome, state, proposerId, offer.offeredProperties) +
    cashToProposer * proposerCashWeight;
  const counterpartyGain =
    valueTo(genome, state, counterpartyId, offer.offeredProperties) -
    valueTo(genome, state, counterpartyId, offer.requestedProperties) -
    cashToProposer * counterpartyCashWeight;

  return { offer, myGain, counterpartyGain, fairness: Math.min(myGain, counterpartyGain) };
}
