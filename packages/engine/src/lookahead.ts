import { GROUP_MEMBERS } from "./board.js";
import { createNaiveBot } from "./bots/naive.js";
import { propertyValue } from "./bots/shared.js";
import { mulberry32, type Rng } from "./dice.js";
import { Game } from "./game.js";
import type { GameState, Ownable } from "./types.js";

const MONOPOLY_BONUS = 200;
const BANKRUPTCY_PENALTY = -1_000_000;
// A per-turn rent expectation is a recurring income figure, not a lump sum, so it needs scaling
// to be comparable to the other (one-time) terms in evaluatePosition — a deliberately simple,
// tunable stand-in for "roughly this many more turns of the game remain to collect it."
const RENT_VALUE_MULTIPLIER = 10;
const AVERAGE_DICE_ROLL = 7; // E[2d6] — see currentRent's utility-rent case.

// Probability a single 2d6 roll sums to each total from 2-12 — the classic triangular distribution.
const TWO_DICE_PROBABILITY: Record<number, number> = {
  2: 1 / 36,
  3: 2 / 36,
  4: 3 / 36,
  5: 4 / 36,
  6: 5 / 36,
  7: 6 / 36,
  8: 5 / 36,
  9: 4 / 36,
  10: 3 / 36,
  11: 2 / 36,
  12: 1 / 36,
};

/**
 * Probability a single 2d6 roll moves a player forward by exactly `distance` spaces. Only
 * distances 2-12 are reachable in one roll (0 otherwise). A deliberate simplification: this
 * ignores a doubles chain extending the same turn's movement further, and any Chance/Community
 * Chest card that moves a player by a fixed or random amount — both real, but secondary next to
 * the core distance-to-landing-probability relationship this is meant to capture cheaply.
 */
function landingProbability(distance: number): number {
  return TWO_DICE_PROBABILITY[distance] ?? 0;
}

/**
 * The rent `payerId` would owe right now for landing on `spaceIndex`, at its current development
 * level — mirrors `Game`'s private `calculateRent`, with two differences: it has no `payerId` to
 * validate against a live game (a plain lookup, not a charge), and utility rent uses the dice
 * roll's *expectation* (`AVERAGE_DICE_ROLL`) rather than a live roll, since this function answers
 * "what would this cost on average," not "what did this actually cost." The one-off "advance to
 * nearest railroad/utility" card rent overrides aren't modeled — they're transient per-move
 * effects, not part of a property's steady-state value.
 */
function currentRent(state: GameState, spaceIndex: number, payerId: string): number {
  const record = state.ownership[spaceIndex];
  if (!record.ownerId || record.ownerId === payerId || record.mortgaged) return 0;
  const space = state.spaces[spaceIndex] as Ownable;
  const ownerId = record.ownerId;

  if (space.type === "railroad") {
    const ownedCount = GROUP_MEMBERS.railroad.filter((i) => state.ownership[i].ownerId === ownerId).length;
    return 25 * 2 ** (ownedCount - 1);
  }
  if (space.type === "utility") {
    const ownedCount = GROUP_MEMBERS.utility.filter((i) => state.ownership[i].ownerId === ownerId).length;
    return AVERAGE_DICE_ROLL * (ownedCount >= 2 ? 10 : 4);
  }

  let rent: number;
  if (record.hotel) rent = space.rent[5];
  else if (record.houses > 0) rent = space.rent[record.houses];
  else {
    const hasMonopoly = GROUP_MEMBERS[space.group].every((i) => state.ownership[i].ownerId === ownerId);
    rent = hasMonopoly ? space.rent[0] * 2 : space.rent[0];
  }

  const condition = state.tradeConditions.find(
    (c) => c.spaceIndex === space.index && c.ownerId === ownerId && c.protectedPlayerId === payerId,
  );
  if (condition?.kind === "waive" && (condition.usesRemaining ?? 0) > 0) return 0;
  if (condition?.kind === "cap" && condition.capLevel !== undefined) return Math.min(rent, space.rent[condition.capLevel]);
  return rent;
}

/**
 * Expected rent `playerId` collects next turn across all owned properties and active opponents —
 * for each opponent, the probability their next roll lands exactly on one of `playerId`'s
 * properties, times the rent they'd owe there right now (see `currentRent`). Deliberately
 * analytical rather than sampled: exact and free of the rollout noise `averageRolloutScore` needs
 * many simulations to smooth out, and — because it reads the property's *current* development
 * level — it recomputes correctly turn to turn as the board changes, including immediately after
 * building.
 */
export function expectedRentIncome(state: GameState, playerId: string): number {
  const ownedSpaces = Object.entries(state.ownership)
    .filter(([, r]) => r.ownerId === playerId && !r.mortgaged)
    .map(([i]) => Number(i));
  if (ownedSpaces.length === 0) return 0;

  let total = 0;
  for (const opponent of state.players) {
    if (opponent.id === playerId || opponent.bankrupt) continue;
    for (const spaceIndex of ownedSpaces) {
      const distance = ((spaceIndex - opponent.position) % 40 + 40) % 40;
      const probability = landingProbability(distance);
      if (probability === 0) continue;
      total += probability * currentRent(state, spaceIndex, opponent.id);
    }
  }
  return total;
}

/**
 * Rough net-worth heuristic for scoring a simulated end state: cash + owned property value
 * (mortgaged properties count at half value, via `propertyValue`) + development value (houses/
 * hotels count at what they cost to build — a house-equivalent scale of houses=1..4, hotel=5,
 * matching `PlayerPanel.tsx`'s `countHouseEquivalents` convention on the web side — without this,
 * cash spent building houses would just vanish from the score, since `propertyValue` only counts
 * a space's face price) + a flat bonus per completed color-group monopoly (railroads/utilities
 * excluded — they scale with count owned, not a single completed set) + a scaled expected-rent
 * term (see `expectedRentIncome`) capturing forward-looking earning potential that a rollout
 * horizon may cut off before it actually materializes as cash, or a large penalty if the player
 * ended up bankrupt.
 */
export function evaluatePosition(state: GameState, playerId: string): number {
  const player = state.players.find((p) => p.id === playerId);
  if (!player || player.bankrupt) return BANKRUPTCY_PENALTY;

  const owned = Object.entries(state.ownership)
    .filter(([, r]) => r.ownerId === playerId)
    .map(([i]) => Number(i));
  const unmortgaged = owned.filter((i) => !state.ownership[i].mortgaged);
  const mortgaged = owned.filter((i) => state.ownership[i].mortgaged);
  const ownedValue = propertyValue(state, unmortgaged) + propertyValue(state, mortgaged) / 2;

  const developmentValue = owned.reduce((sum, i) => {
    const space = state.spaces[i];
    if (space.type !== "property") return sum;
    const record = state.ownership[i];
    const houseEquivalents = record.hotel ? 5 : record.houses;
    return sum + houseEquivalents * space.houseCost;
  }, 0);

  const monopolies = Object.entries(GROUP_MEMBERS)
    .filter(([group]) => group !== "railroad" && group !== "utility")
    .filter(([, indices]) => indices.every((i) => state.ownership[i].ownerId === playerId)).length;

  const rentValue = expectedRentIncome(state, playerId) * RENT_VALUE_MULTIPLIER;

  return player.cash + ownedValue + developmentValue + monopolies * MONOPOLY_BONUS + rentValue;
}

export interface RolloutOptions {
  rolloutCount: number;
  horizonTurns: number;
  rng: Rng;
}

/** Mutates a cloned rollout state in place to model one hypothetical action before playing it out. */
export type HypotheticalAction = (state: GameState) => void;

/**
 * Plays one simulated continuation of `state` (`horizonTurns` turns, using NaiveBot in every seat
 * as a fast, generic playout policy — a bot has no legitimate way to know its opponents' or its
 * own future strategy, so a neutral policy for every seat is the honest choice, not a weakness)
 * and returns the heuristic score at the end of it. `applyAction`, if given, mutates a fresh clone
 * of `state` first (e.g. "buy this property").
 *
 * Note: `Game.playTurn()` always starts a turn with a fresh roll, so resuming mid-decision means
 * the current player's in-progress turn is effectively replayed from a fresh roll rather than
 * continued from where it actually is. That's a known simplification — but it applies identically
 * to every rollout and every hypothetical being compared, so the relative comparison (which is
 * what these decisions actually need) stays meaningful even though no single rollout is a precise
 * forecast.
 */
function runRollout(state: GameState, playerId: string, options: RolloutOptions, applyAction?: HypotheticalAction): number {
  const rolloutState = structuredClone(state);
  applyAction?.(rolloutState);

  const bots = rolloutState.players.map(() => createNaiveBot());
  const game = Game.fromState(rolloutState, bots, options.rng);
  for (let t = 0; t < options.horizonTurns && !game.isGameOver(); t++) {
    game.playTurn();
  }
  return evaluatePosition(game.getSnapshot(), playerId);
}

/** Plays `rolloutCount` independent rollouts (see `runRollout`) and returns the average score. */
export function averageRolloutScore(
  state: GameState,
  playerId: string,
  options: RolloutOptions,
  applyAction?: HypotheticalAction,
): number {
  let total = 0;
  for (let i = 0; i < options.rolloutCount; i++) {
    total += runRollout(state, playerId, options, applyAction);
  }
  return total / options.rolloutCount;
}

export interface PurchaseEvaluation {
  buyScore: number;
  declineScore: number;
  worthBuying: boolean;
}

/**
 * Compares "buy this property at `price`" against "decline" via rollout — the shared primitive
 * behind both `shouldBuyProperty` and `auctionBid` in `createMonteCarloBot`.
 *
 * Uses "common random numbers": each rollout index plays out under the *same* dice/card/opponent
 * randomness for both the buy and decline branch (a fresh seed drawn from `options.rng` per index,
 * replayed identically for both), so the only difference between a paired buy/decline run is the
 * decision itself. Without this, buy and decline would each consume a different, unrelated segment
 * of the shared `rng` stream — leaving the actual effect of the decision buried under several
 * turns' worth of unrelated dice/card variance between the two samples being compared.
 */
export function evaluatePurchase(
  state: GameState,
  playerId: string,
  spaceIndex: number,
  price: number,
  options: RolloutOptions,
): PurchaseEvaluation {
  const applyBuy: HypotheticalAction = (s) => {
    const player = s.players.find((p) => p.id === playerId)!;
    player.cash -= price;
    s.ownership[spaceIndex] = { ownerId: playerId, houses: 0, hotel: false, mortgaged: false };
  };

  let buyTotal = 0;
  let declineTotal = 0;
  for (let i = 0; i < options.rolloutCount; i++) {
    const seed = Math.floor(options.rng() * 2 ** 31);
    buyTotal += runRollout(state, playerId, { ...options, rng: mulberry32(seed) }, applyBuy);
    declineTotal += runRollout(state, playerId, { ...options, rng: mulberry32(seed) });
  }
  const buyScore = buyTotal / options.rolloutCount;
  const declineScore = declineTotal / options.rolloutCount;
  return { buyScore, declineScore, worthBuying: buyScore > declineScore };
}
