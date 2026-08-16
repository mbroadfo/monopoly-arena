import { GROUP_MEMBERS } from "../board.js";
import type { GameState, Ownable, PropertySpace } from "../types.js";

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

/**
 * Fraction of the board's ownable spaces (properties, railroads, utilities) still unowned, in
 * [0, 1] — 1.0 at the very start of the game, falling as players buy in. A simple, board-wide
 * proxy for "how dangerous is an unlucky landing right now": early on almost nothing is claimed,
 * so there's little to fear; once most of the board is owned and developed, staying put avoids
 * real money exposure. Used to graduate `shouldPayToLeaveJail` from "always pay" toward "wait it
 * out" as the game gets more dangerous, instead of one fixed rule for the whole game.
 */
export function percentPropertiesUnowned(state: GameState): number {
  const records = Object.values(state.ownership);
  return records.filter((r) => r.ownerId === null).length / records.length;
}

/** Matches the ~1.5x-of-price premium Naive/OrangeRush/RailroadBaron already pay as a *buyer* for
 * a monopoly-completing piece — reused as the minimum a bot should demand before *selling* one, so
 * a bot doesn't undervalue on the sell side the exact thing its own buy side already prices at a
 * premium. */
export const MONOPOLY_COMPLETION_PREMIUM = 1.5;

/**
 * True if handing `spaceIndex` (currently owned by `currentOwnerId`) to `wouldGainId` completes
 * one of their color-group monopolies — i.e. this isn't just any property, it's the missing piece.
 * Reuses `findMonopolyCompletionTargets` (the same "who's missing exactly one piece" scan
 * `proposeTrade` already runs for its own offers) so accept-side defense and propose-side offers
 * agree on what counts as a monopoly-completing property.
 */
export function completesMonopolyFor(state: GameState, wouldGainId: string, spaceIndex: number, currentOwnerId: string): boolean {
  return findMonopolyCompletionTargets(state, wouldGainId).some((t) => t.spaceIndex === spaceIndex && t.ownerId === currentOwnerId);
}

/**
 * Color-group properties `playerId` owns that would complete one of `counterpartyId`'s own
 * "missing exactly one piece" groups — the reverse-direction lookup from
 * `findMonopolyCompletionTargets`, used to find a straight property-for-property swap that
 * completes a monopoly for *both* sides at once, no cash needed. Mirrors the "mutual monopoly"
 * check `neat/trade.ts`'s candidate generator already runs for NEAT's own offers, so the fixed
 * bots can propose the same kind of deal.
 *
 * `requestedSpaceIndex` (the property `playerId` is asking for) is excluded from its own group:
 * for the one 2-property color group (brown), each side owning one piece always makes both
 * players simultaneously "missing exactly one" of that *same* group — without this exclusion,
 * `playerId` would end up "offering" the very group-mate of the piece they're requesting, a
 * self-cancelling swap that trades away their own progress instead of completing it.
 */
export function findMutualMonopolyTargets(
  state: GameState,
  playerId: string,
  counterpartyId: string,
  requestedSpaceIndex: number,
): number[] {
  const requestedGroup = (state.spaces[requestedSpaceIndex] as Ownable).group;
  return findMonopolyCompletionTargets(state, counterpartyId)
    .filter((t) => t.ownerId === playerId && (state.spaces[t.spaceIndex] as Ownable).group !== requestedGroup)
    .map((t) => t.spaceIndex);
}

/**
 * How much a bot should be willing to bid for a scarce house/hotel piece at `spaceIndex`, given
 * how eager it is (`multiplier`, a plain scale on face `houseCost`) — scaled further by how close
 * that property already is to a hotel: 1x face value at 0 houses, up to 2x at 3 houses (bidding
 * for the 4th). Real Monopoly's house-shortage auction has no such rule, but rewarding urgency
 * this way is what makes an auction actually help: a bid that favors finishing a hotel over
 * starting a new group concentrates the scarce supply instead of spreading it thin, which is what
 * lets hotel conversions (each returns 4 houses to the bank) keep the game moving instead of
 * freezing once the 32-house pool runs dry.
 */
export function houseAuctionCeiling(state: GameState, spaceIndex: number, multiplier: number): number {
  const space = state.spaces[spaceIndex] as PropertySpace;
  const record = state.ownership[spaceIndex];
  const closeness = 1 + record.houses / 4;
  return Math.round(space.houseCost * multiplier * closeness);
}

/** Up to this fraction off what a fully desperate player insists on receiving back in a trade. */
export const MAX_DESPERATION_DISCOUNT = 0.4;
/** Up to this much extra, as a fraction of a normal cash offer, a fully desperate proposer adds
 * to sweeten its own offers — a losing player trying to actually get a deal done, not just a
 * pickier one waiting for a better price. */
export const MAX_DESPERATION_SWEETENER = 0.3;

/**
 * Cash + owned-property face value + development value (houses/hotels priced at what they cost
 * to build) — a simpler, self-contained echo of `lookahead.ts`'s own `netWorth`, kept separate
 * rather than imported: `lookahead.ts` already depends on this module transitively (it constructs
 * a NaiveBot for rollout policy), so importing back from here would create a cycle. Precision
 * doesn't matter here the way it does for NEAT's fitness signal — this only feeds
 * `standingDesperation`'s *relative* ranking among active players.
 */
function estimatedNetWorth(state: GameState, playerId: string): number {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return 0;
  const owned = Object.keys(state.ownership)
    .map(Number)
    .filter((i) => state.ownership[i].ownerId === playerId);
  const developmentValue = owned.reduce((sum, i) => {
    const space = state.spaces[i];
    if (space.type !== "property") return sum;
    const record = state.ownership[i];
    const houseEquivalents = record.hotel ? 5 : record.houses;
    return sum + houseEquivalents * space.houseCost;
  }, 0);
  return player.cash + propertyValue(state, owned) + developmentValue;
}

/**
 * How far behind the game's current leader `playerId` is, in [0, 1] — 0 if they *are* the leader
 * (by `estimatedNetWorth` among active players), approaching 1 the further behind they are. A
 * behavioral nudge, not a precise metric: how much value a bot is willing to give up in a trade
 * just to change the board state, the way a human who feels like they're losing starts making
 * deals a comfortable leader never would — see the `MAX_DESPERATION_*` constants above for where
 * this actually gets used.
 */
export function standingDesperation(state: GameState, playerId: string): number {
  const active = state.players.filter((p) => !p.bankrupt);
  if (active.length <= 1) return 0;
  const worths = active.map((p) => estimatedNetWorth(state, p.id));
  const leaderWorth = Math.max(...worths);
  if (leaderWorth <= 0) return 0;
  const myWorth = estimatedNetWorth(state, playerId);
  return Math.max(0, Math.min(1, (leaderWorth - myWorth) / leaderWorth));
}
