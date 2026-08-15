import { GROUP_MEMBERS } from "../board.js";
import type { GameState, Ownable } from "../types.js";

/** Mortgage value is half face price; unmortgaging costs that plus 10% interest. */
export function unmortgageCost(state: GameState, spaceIndex: number): number {
  const price = (state.spaces[spaceIndex] as Ownable).price;
  return Math.ceil((price / 2) * 1.1);
}

/**
 * A player's owned, unmortgaged, house-free properties eligible to mortgage, with
 * properties outside a complete monopoly first (protecting built-up monopolies longest),
 * cheapest first within each bucket.
 */
export function mortgageCandidates(state: GameState, playerId: string): number[] {
  const owned = Object.entries(state.ownership)
    .filter(([, r]) => r.ownerId === playerId && !r.mortgaged && !r.hotel && r.houses === 0)
    .map(([i]) => Number(i));

  const inMonopoly = (index: number) => {
    const space = state.spaces[index];
    if (!("group" in space)) return false;
    return GROUP_MEMBERS[space.group].every((i) => state.ownership[i].ownerId === playerId);
  };

  return owned.sort((a, b) => {
    const aMono = inMonopoly(a) ? 1 : 0;
    const bMono = inMonopoly(b) ? 1 : 0;
    if (aMono !== bMono) return aMono - bMono;
    return (state.spaces[a] as Ownable).price - (state.spaces[b] as Ownable).price;
  });
}

/** A player's currently mortgaged properties, cheapest first (cheapest to unmortgage). */
export function ownedMortgaged(state: GameState, playerId: string): number[] {
  return Object.entries(state.ownership)
    .filter(([, r]) => r.ownerId === playerId && r.mortgaged)
    .map(([i]) => Number(i))
    .sort((a, b) => (state.spaces[a] as Ownable).price - (state.spaces[b] as Ownable).price);
}

/** Face-value sum of a set of properties, for rough trade-fairness comparisons. */
export function propertyValue(state: GameState, spaceIndices: number[]): number {
  return spaceIndices.reduce((sum, i) => sum + (state.spaces[i] as Ownable).price, 0);
}

/**
 * The rent `ownerId` could currently charge for `spaceIndex` at its current development level —
 * shared by `maxOpponentRentThreat` and `maxRentThreat` so the two "worst single property" numbers
 * (someone else's threat to me / my own threat to someone else) can't drift apart. Utility rent
 * uses the average-dice-roll estimate (7 * multiplier) since there's no live roll to charge against
 * here, matching `lookahead.ts`'s own convention for the same reason.
 */
function currentDevelopmentRent(state: GameState, spaceIndex: number, ownerId: string): number {
  const record = state.ownership[spaceIndex];
  const space = state.spaces[spaceIndex] as Ownable;
  if (space.type === "railroad") {
    const count = GROUP_MEMBERS.railroad.filter((i) => state.ownership[i].ownerId === ownerId).length;
    return 25 * 2 ** (count - 1);
  }
  if (space.type === "utility") {
    const count = GROUP_MEMBERS.utility.filter((i) => state.ownership[i].ownerId === ownerId).length;
    return 7 * (count >= 2 ? 10 : 4);
  }
  if (record.hotel) return space.rent[5];
  if (record.houses > 0) return space.rent[record.houses];
  const hasMonopoly = GROUP_MEMBERS[space.group].every((i) => state.ownership[i].ownerId === ownerId);
  return hasMonopoly ? space.rent[0] * 2 : space.rent[0];
}

/**
 * The single highest rent any active opponent could currently charge `playerId`, across all
 * their owned, unmortgaged properties at current development — a rough "how exposed am I right
 * now" figure in real dollars. Deliberately simple: ignores this player's own board position
 * (doesn't weight by landing probability, unlike `lookahead.ts`'s `expectedRentIncome`) and trade
 * rent conditions (waive/cap) — a worst-case number is the right shape for a reserve floor, not an
 * expected-value one.
 */
export function maxOpponentRentThreat(state: GameState, playerId: string): number {
  let maxRent = 0;
  for (const opponent of state.players) {
    if (opponent.id === playerId || opponent.bankrupt) continue;
    maxRent = Math.max(maxRent, maxRentThreat(state, opponent.id));
  }
  return maxRent;
}

/**
 * The single highest rent `playerId` could currently charge across their own owned, unmortgaged
 * properties at current development — the mirror image of `maxOpponentRentThreat` (this player's
 * own biggest offensive weapon right now, rather than the biggest threat aimed at them).
 */
export function maxRentThreat(state: GameState, playerId: string): number {
  let maxRent = 0;
  for (const [indexStr, record] of Object.entries(state.ownership)) {
    if (record.ownerId !== playerId || record.mortgaged) continue;
    maxRent = Math.max(maxRent, currentDevelopmentRent(state, Number(indexStr), playerId));
  }
  return maxRent;
}

/**
 * Color groups (railroads/utilities excluded — no house tiers, and rent scales with count
 * owned rather than a single missing piece) where this player owns all-but-one property, and
 * who owns the missing piece — only if it's actually tradeable (owned, no houses/hotel).
 */
export function findMonopolyCompletionTargets(state: GameState, playerId: string): { spaceIndex: number; ownerId: string }[] {
  const results: { spaceIndex: number; ownerId: string }[] = [];
  for (const [group, indices] of Object.entries(GROUP_MEMBERS)) {
    if (group === "railroad" || group === "utility") continue;
    const ownedByMe = indices.filter((i) => state.ownership[i].ownerId === playerId);
    if (ownedByMe.length !== indices.length - 1) continue;

    const missing = indices.find((i) => state.ownership[i].ownerId !== playerId)!;
    const missingRecord = state.ownership[missing];
    if (!missingRecord.ownerId || missingRecord.houses > 0 || missingRecord.hotel) continue;
    results.push({ spaceIndex: missing, ownerId: missingRecord.ownerId });
  }
  return results;
}
