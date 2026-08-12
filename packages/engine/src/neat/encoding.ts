import { GROUP_MEMBERS } from "../board.js";
import { maxOpponentRentThreat } from "../bots/shared.js";
import type { GameState, Ownable, PropertySpace } from "../types.js";
import { evaluate } from "./genome.js";
import type { Genome } from "./types.js";

export const DECISION_INPUT_COUNT = 21;
export const DECISION_OUTPUT_COUNT = 5;

/** Output head indices — one feedforward network, evaluated once per call; each decision reads
 * its own head instead of evolving a separate genome population per decision type. */
export const OUTPUT_PROPERTY = 0;
export const OUTPUT_JAIL = 1;
export const OUTPUT_MORTGAGE = 2;
export const OUTPUT_UNMORTGAGE = 3;
export const OUTPUT_SELL_HOUSE = 4;

const TOTAL_OWNABLE_SPACES = 28;
// Mirrors Game's own private MAX_JAIL_TURNS (game.ts) — not exported, so mirrored here the same
// way AUCTION_BID_INCREMENT is mirrored in neatBot.ts.
const MAX_JAIL_TURNS = 3;

function monopolyCountFor(state: GameState, playerId: string): number {
  return Object.entries(GROUP_MEMBERS)
    .filter(([group]) => group !== "railroad" && group !== "utility")
    .filter(([, indices]) => indices.every((i) => state.ownership[i].ownerId === playerId)).length;
}

/** The rent a railroad/utility candidate would actually charge once `playerId` owns it (counting
 * what they already own in that group) — replaces a flat placeholder that used to hide the real
 * payoff of accumulating railroads (25/50/100/200 as count goes 1-4) from the network entirely. */
function projectedIncomeRent(state: GameState, playerId: string, space: Ownable): number {
  const alreadyOwned = GROUP_MEMBERS[space.group].filter((i) => state.ownership[i].ownerId === playerId).length;
  const owningThisToo = state.ownership[space.index]?.ownerId === playerId ? alreadyOwned : alreadyOwned + 1;
  if (space.type === "railroad") return 25 * 2 ** (owningThisToo - 1);
  return 7 * (owningThisToo >= 2 ? 10 : 4); // utility, average-dice-roll estimate
}

/**
 * The unified feature vector behind every decision this network drives. `spaceIndex` is the
 * candidate property/railroad/utility being scored (buy/bid/build/mortgage/unmortgage/sell-house),
 * or `null` for a candidate-less decision (jail) — the `hasCandidate` flag at the end lets the
 * network tell "no candidate" apart from "candidate happens to score zero everywhere." Every
 * feature is normalized to roughly [0, 1] or [-1, 1], matching every prior phase's convention.
 */
export function encodeDecisionFeatures(state: GameState, playerId: string, spaceIndex: number | null, priceOverride?: number): number[] {
  const player = state.players.find((p) => p.id === playerId)!;
  const opponents = state.players.filter((p) => p.id !== playerId && !p.bankrupt);
  const opponentCashTotal = opponents.reduce((sum, p) => sum + p.cash, 0);

  const ownedCount = Object.values(state.ownership).filter((r) => r.ownerId === playerId).length;
  const unownedCount = Object.values(state.ownership).filter((r) => r.ownerId === null).length;
  const monopolyCount = monopolyCountFor(state, playerId);
  const leadingOpponentMonopolies = opponents.reduce((max, p) => Math.max(max, monopolyCountFor(state, p.id)), 0);
  const activePlayers = state.players.filter((p) => !p.bankrupt).length;

  const global = [
    player.cash / 1500,
    ownedCount / TOTAL_OWNABLE_SPACES,
    monopolyCount / 8,
    opponents.length > 0 ? opponentCashTotal / (1500 * opponents.length) : 0,
    leadingOpponentMonopolies / 8,
    state.players.length > 0 ? activePlayers / state.players.length : 0,
    Math.min(state.turn / 200, 1),
    state.housesRemaining / 32,
    state.hotelsRemaining / 12,
    maxOpponentRentThreat(state, playerId) / 2000,
    player.inJail ? player.jailTurns / MAX_JAIL_TURNS : 0,
    unownedCount / TOTAL_OWNABLE_SPACES,
  ];

  if (spaceIndex === null) {
    return [...global, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // candidate block zeroed, hasCandidate = 0
  }

  const space = state.spaces[spaceIndex] as Ownable;
  const price = priceOverride ?? space.price;
  const group = "group" in space ? space.group : null;
  const groupIndices = group ? GROUP_MEMBERS[group] : [];
  const ownedInGroup = groupIndices.filter((i) => state.ownership[i].ownerId === playerId).length;
  const groupProgress = groupIndices.length > 0 ? ownedInGroup / groupIndices.length : 0;
  const isRailroadOrUtility = space.type === "railroad" || space.type === "utility";

  const record = state.ownership[spaceIndex];
  const baseRent = isRailroadOrUtility ? projectedIncomeRent(state, playerId, space) : (space as PropertySpace).rent[0];
  const improvementLevel = record.hotel ? 5 : record.houses;

  const candidate = [
    price / 400,
    groupIndices.length > 0 ? groupIndices.length / 4 : 0,
    groupProgress,
    isRailroadOrUtility ? 1 : 0,
    baseRent / 250,
    improvementLevel / 5,
    record.mortgaged ? 1 : 0,
    (player.cash - price) / 1500,
    1, // hasCandidate
  ];

  return [...global, ...candidate];
}

function scoreOutput(genome: Genome, state: GameState, playerId: string, outputIndex: number, spaceIndex: number | null, priceOverride?: number) {
  const inputs = encodeDecisionFeatures(state, playerId, spaceIndex, priceOverride);
  return evaluate(genome, inputs)[outputIndex];
}

/** How valuable is owning this property to `playerId` right now — positive means "worth it."
 * Shared by shouldBuyProperty (at face price), auctionBid (at a candidate bid), chooseHouseToBuild
 * (scoring build candidates), and trade.ts's fairness scoring. */
export function scoreProperty(genome: Genome, state: GameState, playerId: string, spaceIndex: number, priceOverride?: number): number {
  return scoreOutput(genome, state, playerId, OUTPUT_PROPERTY, spaceIndex, priceOverride);
}

/** Should `playerId` pay $50 to leave jail right now — positive means "pay." Candidate-less
 * (jail isn't a specific property), so this is the one decision where `evaluate()` runs on the
 * "no candidate" feature vector. */
export function scoreJail(genome: Genome, state: GameState, playerId: string): number {
  return scoreOutput(genome, state, playerId, OUTPUT_JAIL, null);
}

/** How willing is `playerId` to mortgage this owned, unmortgaged, house-free property —
 * higher means "more willing to give this one up first." Used by both a forced `raiseCash` call
 * and proactive mortgaging in `chooseFinanceAction`. */
export function scoreMortgage(genome: Genome, state: GameState, playerId: string, spaceIndex: number): number {
  return scoreOutput(genome, state, playerId, OUTPUT_MORTGAGE, spaceIndex);
}

/** How much does `playerId` want to pay off this mortgage right now — positive means "do it." */
export function scoreUnmortgage(genome: Genome, state: GameState, playerId: string, spaceIndex: number): number {
  return scoreOutput(genome, state, playerId, OUTPUT_UNMORTGAGE, spaceIndex);
}

/** How much does `playerId` want to sell a house/hotel off this property — positive means "do it." */
export function scoreSellHouse(genome: Genome, state: GameState, playerId: string, spaceIndex: number): number {
  return scoreOutput(genome, state, playerId, OUTPUT_SELL_HOUSE, spaceIndex);
}

/**
 * Properties `playerId` is currently eligible to build a house/hotel on — mirrors NaiveBot's own
 * eligibility gathering (`bots/naive.ts`): owns the entire color group, no mortgaged group-mates,
 * no hotel yet, tied for least-developed within the group (the even-building rule — see below),
 * and can afford the house cost.
 */
export function buildableCandidates(state: GameState, playerId: string): number[] {
  const player = state.players.find((p) => p.id === playerId)!;
  const candidates: number[] = [];

  for (const [group, indices] of Object.entries(GROUP_MEMBERS)) {
    if (group === "railroad" || group === "utility") continue;
    const ownsAll = indices.every((i) => state.ownership[i].ownerId === playerId);
    if (!ownsAll) continue;
    if (indices.some((i) => state.ownership[i].mortgaged)) continue;
    if (indices.some((i) => state.ownership[i].hotel)) continue;

    // Even-building: mirrors Game's own private tryBuild rule — only group member(s) tied for
    // *least* developed are actually eligible right now. Without this, a caller that doesn't pick
    // the least-developed member itself (unlike NaiveBot's own greedy "fewest houses" choice) can
    // get permanently stuck: it keeps re-selecting an already-ahead sibling, tryBuild rejects it
    // every time, and the build phase silently ends for the turn without ever trying the sibling
    // that's actually buildable — observed directly causing a full game-length stall in practice.
    const houseLevel = (i: number) => (state.ownership[i].hotel ? 5 : state.ownership[i].houses);
    const minLevel = Math.min(...indices.map(houseLevel));

    for (const index of indices) {
      if (houseLevel(index) > minLevel) continue;
      const space = state.spaces[index] as PropertySpace;
      if (player.cash - space.houseCost < 0) continue;
      candidates.push(index);
    }
  }
  return candidates;
}

/**
 * Owned properties currently eligible to sell a house/hotel off — the reverse of
 * `buildableCandidates`'s even-building rule: only the group's *most*-developed member(s) qualify
 * (a group can be a mix of owners if a house-free member was traded away after houses went up
 * elsewhere in the group, so `maxLevel` is computed across the whole group, not just what
 * `playerId` owns — mirrors Game's private `trySellHouse`, game.ts). A hotel-to-4-houses
 * conversion additionally needs 4 house pieces available in the bank, checked here too so a
 * generated candidate isn't silently rejected downstream.
 */
export function sellableCandidates(state: GameState, playerId: string): number[] {
  const candidates: number[] = [];

  for (const [group, indices] of Object.entries(GROUP_MEMBERS)) {
    if (group === "railroad" || group === "utility") continue;
    const houseLevel = (i: number) => (state.ownership[i].hotel ? 5 : state.ownership[i].houses);
    const maxLevel = Math.max(...indices.map(houseLevel));
    if (maxLevel === 0) continue;

    for (const index of indices) {
      const record = state.ownership[index];
      if (record.ownerId !== playerId) continue;
      if (houseLevel(index) < maxLevel) continue;
      if (record.hotel && state.housesRemaining < 4) continue;
      candidates.push(index);
    }
  }
  return candidates;
}
