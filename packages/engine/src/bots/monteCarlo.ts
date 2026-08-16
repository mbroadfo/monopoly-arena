import type { Rng } from "../dice.js";
import { evaluatePurchase, type RolloutOptions } from "../lookahead.js";
import type { Bot, GameState, Ownable } from "../types.js";
import { createNaiveBot } from "./naive.js";

// Mirrors Game's own private AUCTION_BID_INCREMENT (game.ts) — the engine validates any bid
// against the same $10 step, so bidding anything else would just be silently rejected.
const AUCTION_BID_INCREMENT = 10;

export interface MonteCarloBotOptions {
  /** Simulated continuations averaged per decision. More = steadier estimate, slower decisions. */
  rolloutCount?: number;
  /** Turns played out per simulated continuation. */
  horizonTurns?: number;
  rng?: Rng;
}

/**
 * Looks ahead instead of using a fixed heuristic for the two decisions where it pays off most
 * directly — buying a property, and how much to bid for one at auction — by simulating several
 * short rollouts of "what happens if I do this" vs. "what happens if I don't" (see lookahead.ts)
 * and comparing the average outcome. Every other decision (jail, trade, build, finance) delegates
 * to NaiveBot's existing heuristics — a complete, playable bot from day one, with search applied
 * exactly where it demonstrably helps.
 *
 * Slower per-decision than the other reference bots by design — suited to a handful of
 * interactive games, not large-scale tournaments (see the README's bot-types roadmap).
 */
export function createMonteCarloBot(options: MonteCarloBotOptions = {}): Bot {
  const rolloutOptions: RolloutOptions = {
    rolloutCount: options.rolloutCount ?? 12,
    horizonTurns: options.horizonTurns ?? 4,
    rng: options.rng ?? Math.random,
  };
  const fallback = createNaiveBot();

  return {
    name: "MonteCarloBot",

    shouldBuyProperty(state: GameState, playerId: string, spaceIndex: number): boolean {
      const price = (state.spaces[spaceIndex] as Ownable).price;
      return evaluatePurchase(state, playerId, spaceIndex, price, rolloutOptions).worthBuying;
    },

    auctionBid(state: GameState, playerId: string, spaceIndex: number, currentBid: number): number | null {
      const player = state.players.find((p) => p.id === playerId)!;
      const nextBid = currentBid + AUCTION_BID_INCREMENT;
      if (nextBid > player.cash) return null;
      const { worthBuying } = evaluatePurchase(state, playerId, spaceIndex, nextBid, rolloutOptions);
      return worthBuying ? nextBid : null;
    },

    chooseHouseToBuild: fallback.chooseHouseToBuild,
    houseAuctionBid: fallback.houseAuctionBid,
    shouldPayToLeaveJail: fallback.shouldPayToLeaveJail,
    raiseCash: fallback.raiseCash,
    chooseFinanceAction: fallback.chooseFinanceAction,
    proposeTrade: fallback.proposeTrade,
    evaluateTrade: fallback.evaluateTrade,
  };
}
