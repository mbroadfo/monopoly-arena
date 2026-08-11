import { GROUP_MEMBERS } from "../board.js";
import type { GameState, Ownable, PropertySpace } from "../types.js";
import { evaluate } from "./genome.js";
import type { Genome } from "./types.js";

export const PROPERTY_SCORE_INPUT_COUNT = 17;
export const PROPERTY_SCORE_OUTPUT_COUNT = 1;

/** A representative base-rent stand-in for railroad/utility spaces, which don't have a `rent`
 * tier array — one railroad owned ($25) and the low utility multiplier at the average roll
 * (4 * 7 = $28), close enough in scale to a cheap color property's base rent for this feature's
 * purpose (a rough income-potential signal, not an exact rent forecast). */
const NON_COLOR_BASE_RENT = 25;

function monopolyCountFor(state: GameState, playerId: string): number {
  return Object.entries(GROUP_MEMBERS)
    .filter(([group]) => group !== "railroad" && group !== "utility")
    .filter(([, indices]) => indices.every((i) => state.ownership[i].ownerId === playerId)).length;
}

/**
 * The single feature vector behind all three decisions this network drives: how valuable is
 * owning `spaceIndex` (at `priceOverride`, if considering a specific bid rather than face price)
 * to `playerId` right now. Every feature is normalized to roughly [0, 1] or [-1, 1] — untrained
 * network weights start small and random, so keeping inputs on a comparable scale matters for
 * evolution to have a sane starting gradient to work with.
 */
export function encodePropertyFeatures(state: GameState, playerId: string, spaceIndex: number, priceOverride?: number): number[] {
  const player = state.players.find((p) => p.id === playerId)!;
  const opponents = state.players.filter((p) => p.id !== playerId && !p.bankrupt);
  const opponentCashTotal = opponents.reduce((sum, p) => sum + p.cash, 0);

  const ownedCount = Object.values(state.ownership).filter((r) => r.ownerId === playerId).length;
  const monopolyCount = monopolyCountFor(state, playerId);

  const space = state.spaces[spaceIndex] as Ownable;
  const price = priceOverride ?? space.price;
  const group = "group" in space ? space.group : null;
  const groupIndices = group ? GROUP_MEMBERS[group] : [];
  const ownedInGroup = groupIndices.filter((i) => state.ownership[i].ownerId === playerId).length;
  const groupProgress = groupIndices.length > 0 ? ownedInGroup / groupIndices.length : 0;
  const isRailroadOrUtility = space.type === "railroad" || space.type === "utility";

  const record = state.ownership[spaceIndex];
  const baseRent = isRailroadOrUtility ? NON_COLOR_BASE_RENT : (space as PropertySpace).rent[0];
  const improvementLevel = record.hotel ? 5 : record.houses;
  const leadingOpponentMonopolies = opponents.reduce((max, p) => Math.max(max, monopolyCountFor(state, p.id)), 0);
  const activePlayers = state.players.filter((p) => !p.bankrupt).length;

  return [
    player.cash / 1500,
    ownedCount / 28,
    monopolyCount / 8,
    opponents.length > 0 ? opponentCashTotal / (1500 * opponents.length) : 0,
    price / 400,
    groupIndices.length > 0 ? groupIndices.length / 4 : 0,
    groupProgress,
    isRailroadOrUtility ? 1 : 0,
    Math.min(state.turn / 200, 1),
    (player.cash - price) / 1500,
    baseRent / 250,
    improvementLevel / 5,
    record.mortgaged ? 1 : 0,
    leadingOpponentMonopolies / 8,
    state.players.length > 0 ? activePlayers / state.players.length : 0,
    state.housesRemaining / 32,
    state.hotelsRemaining / 12,
  ];
}

/** How valuable is owning this property to `playerId` right now — positive means "worth it."
 * Shared by shouldBuyProperty (at face price), auctionBid (at a candidate bid), and
 * chooseHouseToBuild (scoring build candidates, priceOverride unused there). */
export function scoreProperty(genome: Genome, state: GameState, playerId: string, spaceIndex: number, priceOverride?: number): number {
  const inputs = encodePropertyFeatures(state, playerId, spaceIndex, priceOverride);
  const [output] = evaluate(genome, inputs);
  return output;
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
