import { GROUP_MEMBERS } from "../board.js";
import type { GameState, Ownable, PropertySpace } from "../types.js";
import { evaluate } from "./genome.js";
import type { Genome } from "./types.js";

export const PROPERTY_SCORE_INPUT_COUNT = 9;
export const PROPERTY_SCORE_OUTPUT_COUNT = 1;

/**
 * The single feature vector behind all three decisions this network drives: how valuable is
 * owning `spaceIndex` (at `priceOverride`, if considering a specific bid rather than face price)
 * to `playerId` right now. Every feature is normalized to roughly [0, 1] or [-1, 1] — untrained
 * network weights start small and random, so keeping inputs on a comparable scale matters for
 * evolution to have a sane starting gradient to work with.
 */
function encodePropertyFeatures(state: GameState, playerId: string, spaceIndex: number, priceOverride?: number): number[] {
  const player = state.players.find((p) => p.id === playerId)!;
  const opponents = state.players.filter((p) => p.id !== playerId && !p.bankrupt);
  const opponentCashTotal = opponents.reduce((sum, p) => sum + p.cash, 0);

  const ownedCount = Object.values(state.ownership).filter((r) => r.ownerId === playerId).length;
  const monopolyCount = Object.entries(GROUP_MEMBERS)
    .filter(([group]) => group !== "railroad" && group !== "utility")
    .filter(([, indices]) => indices.every((i) => state.ownership[i].ownerId === playerId)).length;

  const space = state.spaces[spaceIndex] as Ownable;
  const price = priceOverride ?? space.price;
  const group = "group" in space ? space.group : null;
  const groupIndices = group ? GROUP_MEMBERS[group] : [];
  const ownedInGroup = groupIndices.filter((i) => state.ownership[i].ownerId === playerId).length;
  const groupProgress = groupIndices.length > 0 ? ownedInGroup / groupIndices.length : 0;

  return [
    player.cash / 1500,
    ownedCount / 28,
    monopolyCount / 8,
    opponents.length > 0 ? opponentCashTotal / (1500 * opponents.length) : 0,
    price / 400,
    groupIndices.length > 0 ? groupIndices.length / 4 : 0,
    groupProgress,
    space.type === "railroad" || space.type === "utility" ? 1 : 0,
    Math.min(state.turn / 200, 1),
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
 * no hotel yet, and can afford the house cost. Doesn't independently re-derive even-building
 * legality — like every other bot, an ineligible pick is simply rejected by `Game.tryBuild`,
 * ending the build phase for that call rather than crashing.
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

    for (const index of indices) {
      const space = state.spaces[index] as PropertySpace;
      if (player.cash - space.houseCost < 0) continue;
      candidates.push(index);
    }
  }
  return candidates;
}
