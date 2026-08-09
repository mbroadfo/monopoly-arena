import championGenome from "./neat-champion.json" with { type: "json" };
import { buildableCandidates, scoreProperty } from "../neat/encoding.js";
import type { Genome } from "../neat/types.js";
import type { Bot, GameState } from "../types.js";
import { createNaiveBot } from "./naive.js";

// Mirrors Game's own private AUCTION_BID_INCREMENT (game.ts) — the engine validates any bid
// against the same $10 step, so bidding anything else would just be silently rejected.
const AUCTION_BID_INCREMENT = 10;

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
      let best: { index: number; score: number } | null = null;
      for (const index of buildableCandidates(state, playerId)) {
        const score = scoreProperty(activeGenome, state, playerId, index);
        if (score > 0 && (best === null || score > best.score)) best = { index, score };
      }
      return best ? best.index : null;
    },

    shouldPayToLeaveJail: fallback.shouldPayToLeaveJail,
    raiseCash: fallback.raiseCash,
    chooseFinanceAction: fallback.chooseFinanceAction,
    proposeTrade: fallback.proposeTrade,
    evaluateTrade: fallback.evaluateTrade,
  };
}
