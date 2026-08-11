import championGenome from "./neat-champion.json" with { type: "json" };
import { buildableCandidates, scoreProperty } from "../neat/encoding.js";
import { generateTradeCandidates, scoreTradeCandidate } from "../neat/trade.js";
import type { Genome } from "../neat/types.js";
import type { Bot, GameState, PropertySpace, TradeOffer } from "../types.js";
import { createNaiveBot } from "./naive.js";
import { maxOpponentRentThreat } from "./shared.js";

// Mirrors Game's own private AUCTION_BID_INCREMENT (game.ts) — the engine validates any bid
// against the same $10 step, so bidding anything else would just be silently rejected.
const AUCTION_BID_INCREMENT = 10;

// Left unlearned deliberately (see chooseHouseToBuild): an evolved genome trained under a small
// games-per-genome budget can land on "build one house, then stop and hoard cash" as a
// locally-safe policy — it never gets bankrupted by an unbuilt monopoly, but it also never
// presses the advantage. A reserve floor keeps building "aggressive within safety" regardless of
// what the genome itself learned to value, matching the doctrine's "three houses is the economic
// sweet spot" — you can't reach that sweet spot at all if nothing pushes past the first house.
const BASE_BUILD_RESERVE = 150;
// Scales the reserve up with real threat (see `maxOpponentRentThreat`) rather than using a flat
// number regardless of board state — surviving one landing on an opponent's worst-case property
// twice over, roughly. Doesn't grow the reserve just because cash is high (that would defeat the
// point — surplus above whatever the real threat requires should get built, not hoarded).
const THREAT_RESERVE_MULTIPLIER = 2;

/**
 * A bot driven by an evolved NEAT genome for `shouldBuyProperty`, `auctionBid`, and
 * `chooseHouseToBuild` — see `neat/encoding.ts`'s `scoreProperty` for the shared "how valuable is
 * this property to me right now" evaluator behind all three. Every other decision delegates to an
 * internally-held `NaiveBot`, matching `monteCarlo.ts`'s exact shape — a complete, playable bot
 * with the evolved network applied exactly where it's meant to add value.
 *
 * Defaults to the shipped, pre-trained `neat-champion.json` when no genome is given, so the web
 * UI's lineup picker has a working bot with no training step required. Pass an explicit genome
 * during evolutionary training (`neat/train.ts`) to evaluate a candidate instead.
 */
export function createNeatBot(genome?: Genome): Bot {
  const activeGenome = genome ?? (championGenome as Genome);
  const fallback = createNaiveBot();

  return {
    name: "NeatBot",

    shouldBuyProperty(state: GameState, playerId: string, spaceIndex: number): boolean {
      return scoreProperty(activeGenome, state, playerId, spaceIndex) > 0;
    },

    auctionBid(state: GameState, playerId: string, spaceIndex: number, currentBid: number): number | null {
      const player = state.players.find((p) => p.id === playerId)!;
      const nextBid = currentBid + AUCTION_BID_INCREMENT;
      if (nextBid > player.cash) return null;
      return scoreProperty(activeGenome, state, playerId, spaceIndex, nextBid) > 0 ? nextBid : null;
    },

    chooseHouseToBuild(state: GameState, playerId: string): number | null {
      const player = state.players.find((p) => p.id === playerId)!;
      const reserve = Math.max(BASE_BUILD_RESERVE, maxOpponentRentThreat(state, playerId) * THREAT_RESERVE_MULTIPLIER);
      let best: { index: number; score: number } | null = null;
      for (const index of buildableCandidates(state, playerId)) {
        const cost = (state.spaces[index] as PropertySpace).houseCost;
        if (player.cash - cost < reserve) continue; // stay solvent; otherwise keep building
        const score = scoreProperty(activeGenome, state, playerId, index);
        if (best === null || score > best.score) best = { index, score };
      }
      return best ? best.index : null;
    },

    shouldPayToLeaveJail: fallback.shouldPayToLeaveJail,
    raiseCash: fallback.raiseCash,
    chooseFinanceAction: fallback.chooseFinanceAction,

    proposeTrade(state: GameState, playerId: string): TradeOffer | null {
      const scored = generateTradeCandidates(state, playerId)
        .map((offer) => scoreTradeCandidate(activeGenome, state, offer))
        .filter((s) => s.myGain > 0); // never propose a deal that looks self-harming
      if (scored.length === 0) return null;
      scored.sort((a, b) => b.fairness - a.fairness); // prefer offers that look good on both sides
      return scored[0].offer;
    },

    evaluateTrade(state: GameState, _playerId: string, offer: TradeOffer): boolean {
      return scoreTradeCandidate(activeGenome, state, offer).counterpartyGain > 0;
    },
  };
}
