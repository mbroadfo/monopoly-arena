import championGenome from "./neat-champion.json" with { type: "json" };
import { buildableCandidates, scoreJail, scoreMortgage, scoreProperty, scoreSellHouse, scoreUnmortgage, sellableCandidates } from "../neat/encoding.js";
import { generateTradeCandidates, scoreTradeCandidate } from "../neat/trade.js";
import type { Genome } from "../neat/types.js";
import type { Bot, FinanceAction, GameState, PropertySpace, TradeOffer } from "../types.js";
import { mortgageCandidates, maxOpponentRentThreat, ownedMortgaged } from "./shared.js";

// Mirrors Game's own private AUCTION_BID_INCREMENT (game.ts) — the engine validates any bid
// against the same $10 step, so bidding anything else would just be silently rejected.
const AUCTION_BID_INCREMENT = 10;

// Left unlearned deliberately (see chooseHouseToBuild): an evolved genome trained under a small
// games-per-genome budget can land on "build one house, then stop and hoard cash" as a
// locally-safe policy — it never gets bankrupted by an unbuilt monopoly, but it also never
// presses the advantage. A reserve floor keeps building "aggressive within safety" regardless of
// what the genome itself learned to value, matching the doctrine's "three houses is the economic
// sweet spot" — you can't reach that sweet spot at all if nothing pushes past the first house.
// Kept as a safety net now that jail/mortgage/unmortgage/sell-house are also evolved decisions —
// cheap insurance against an undertrained genome, not a substitute for what evolution can learn.
const BASE_BUILD_RESERVE = 150;
// Scales the reserve up with real threat (see `maxOpponentRentThreat`) rather than using a flat
// number regardless of board state — surviving one landing on an opponent's worst-case property
// twice over, roughly. Doesn't grow the reserve just because cash is high (that would defeat the
// point — surplus above whatever the real threat requires should get built, not hoarded).
const THREAT_RESERVE_MULTIPLIER = 2;

// A property can score positive on *both* the mortgage head ("not much reason to keep this") and
// the unmortgage head ("affordable, worth reclaiming") at once when its situation is genuinely
// marginal — with both gated at a bare > 0, that lets a borderline property flip-flop every turn
// (mortgage it, immediately pay it back off, repeat), quietly bleeding the 10% unmortgage interest
// fee each cycle forever. Confirmed directly: some games got stuck in exactly this loop for
// hundreds of turns straight without resolving. Requiring more than a razor-thin positive score to
// act (for mortgage/unmortgage specifically — sell-house has no such symmetric counterpart to
// oscillate against) creates a dead zone where a marginal case just stays as it already is instead
// of flipping. Not applied to `raiseCash`'s forced mortgaging — that must still act on any
// available candidate to avoid needless bankruptcy, matching every other bot's contract.
const FINANCE_ACTION_MARGIN = 0.1;

// How much a personality can shift the bar for acting on the network's own scores. At the extremes
// (+-1), an aggressive bot buys/bids/leaves-jail/trades on scores as low as -AGGRESSION_THRESHOLD_SCALE
// (opportunities a neutral bot would pass on) and a cautious one needs a score above
// +AGGRESSION_THRESHOLD_SCALE (only the clearest opportunities). This is a threshold shift on the
// *same* trained genome, not a different genome — cheap enough to give several NEAT seats in one
// game distinct playstyles without training a personality-specific champion for each one.
const AGGRESSION_THRESHOLD_SCALE = 0.5;
// Same idea for the build reserve: aggressive halves it (builds with a thinner cash cushion),
// cautious grows it by half again.
const AGGRESSION_RESERVE_SCALE = 0.5;

export interface NeatBotOptions {
  /**
   * -1 (cautious) to +1 (aggressive), default 0 — the genome's own trained behavior, unmodified.
   * Shifts the action threshold on buy/bid/jail/trade decisions and the build cash reserve;
   * doesn't touch `raiseCash`/`chooseFinanceAction`'s defensive logic or the mortgage/unmortgage
   * self-consistency guard, which stay personality-independent safety nets regardless.
   */
  aggressiveness?: number;
}

/**
 * A bot driven by an evolved NEAT genome for all 8 `BotDecisions` — see `neat/encoding.ts`'s
 * unified `encodeDecisionFeatures`/five output heads (`scoreProperty`, `scoreJail`,
 * `scoreMortgage`, `scoreUnmortgage`, `scoreSellHouse`) for the shared network behind every
 * decision below, and `neat/trade.ts` for the fairness-scored trade candidates behind
 * `proposeTrade`/`evaluateTrade`. One genome, one evolutionary population — every decision reads
 * its own output head from the same forward pass rather than evolving a second network.
 *
 * Defaults to the shipped, pre-trained `neat-champion.json` when no genome is given, so the web
 * UI's lineup picker has a working bot with no training step required. Pass an explicit genome
 * during evolutionary training (`neat/train.ts`) to evaluate a candidate instead.
 */
export function createNeatBot(genome?: Genome, options: NeatBotOptions = {}): Bot {
  const activeGenome = genome ?? (championGenome as Genome);
  const aggressiveness = Math.max(-1, Math.min(1, options.aggressiveness ?? 0));
  const actionThreshold = -aggressiveness * AGGRESSION_THRESHOLD_SCALE;
  const reserveMultiplier = Math.max(0, 1 - aggressiveness * AGGRESSION_RESERVE_SCALE);

  return {
    name: "NeatBot",

    shouldBuyProperty(state: GameState, playerId: string, spaceIndex: number): boolean {
      return scoreProperty(activeGenome, state, playerId, spaceIndex) > actionThreshold;
    },

    auctionBid(state: GameState, playerId: string, spaceIndex: number, currentBid: number): number | null {
      const player = state.players.find((p) => p.id === playerId)!;
      const nextBid = currentBid + AUCTION_BID_INCREMENT;
      if (nextBid > player.cash) return null;
      return scoreProperty(activeGenome, state, playerId, spaceIndex, nextBid) > actionThreshold ? nextBid : null;
    },

    chooseHouseToBuild(state: GameState, playerId: string): number | null {
      const player = state.players.find((p) => p.id === playerId)!;
      const reserve = Math.max(BASE_BUILD_RESERVE, maxOpponentRentThreat(state, playerId) * THREAT_RESERVE_MULTIPLIER) * reserveMultiplier;
      let best: { index: number; score: number } | null = null;
      for (const index of buildableCandidates(state, playerId)) {
        const cost = (state.spaces[index] as PropertySpace).houseCost;
        if (player.cash - cost < reserve) continue; // stay solvent; otherwise keep building
        const score = scoreProperty(activeGenome, state, playerId, index);
        if (best === null || score > best.score) best = { index, score };
      }
      return best ? best.index : null;
    },

    shouldPayToLeaveJail(state: GameState, playerId: string): boolean {
      return scoreJail(activeGenome, state, playerId) > actionThreshold;
    },

    raiseCash(state: GameState, playerId: string, _amountNeeded: number): number | null {
      // A forced call — never refuse if a mortgageable property exists, matching every other
      // bot's contract (declining with an available candidate just causes needless bankruptcy).
      // The evolved score picks *which* one to give up first, not *whether* to act.
      let best: { index: number; score: number } | null = null;
      for (const index of mortgageCandidates(state, playerId)) {
        const score = scoreMortgage(activeGenome, state, playerId, index);
        if (best === null || score > best.score) best = { index, score };
      }
      return best ? best.index : null;
    },

    chooseFinanceAction(state: GameState, playerId: string): FinanceAction | null {
      // Self-consistency guard against mortgage/unmortgage churn: before acting, ask the network
      // about the *resulting* state — if the opposite head would immediately fire there, the two
      // heads contradict each other about where this property should sit, and acting on either
      // opinion just starts an A→B→A loop that bleeds the 10% unmortgage interest every cycle
      // (observed for hundreds of consecutive turns in real games; a score deadband alone can't
      // stop it because an undertrained genome holds both opinions at ±0.9 confidence, not at the
      // margin). A contradicted property is left exactly as it is. The state snapshot is this
      // bot's own clone (Game.getSnapshot), so the temporary flip below is invisible to the engine.
      const wouldImmediatelyReverse = (index: number, action: "mortgage" | "unmortgage"): boolean => {
        const record = state.ownership[index];
        const original = record.mortgaged;
        record.mortgaged = action === "mortgage";
        const reverseScore =
          action === "mortgage"
            ? scoreUnmortgage(activeGenome, state, playerId, index)
            : scoreMortgage(activeGenome, state, playerId, index);
        record.mortgaged = original;
        return reverseScore > FINANCE_ACTION_MARGIN;
      };

      const candidates: { action: FinanceAction["action"]; index: number; score: number }[] = [];
      for (const index of mortgageCandidates(state, playerId)) {
        if (wouldImmediatelyReverse(index, "mortgage")) continue;
        candidates.push({ action: "mortgage", index, score: scoreMortgage(activeGenome, state, playerId, index) });
      }
      for (const index of ownedMortgaged(state, playerId)) {
        if (wouldImmediatelyReverse(index, "unmortgage")) continue;
        candidates.push({ action: "unmortgage", index, score: scoreUnmortgage(activeGenome, state, playerId, index) });
      }
      for (const index of sellableCandidates(state, playerId)) {
        candidates.push({ action: "sell-house", index, score: scoreSellHouse(activeGenome, state, playerId, index) });
      }
      const threshold = (action: FinanceAction["action"]) => (action === "sell-house" ? 0 : FINANCE_ACTION_MARGIN);
      const best = candidates.filter((c) => c.score > threshold(c.action)).sort((a, b) => b.score - a.score)[0];
      return best ? { action: best.action, spaceIndex: best.index } : null;
    },

    proposeTrade(state: GameState, playerId: string): TradeOffer | null {
      // Rank like a negotiator, not an arbitrator: among deals the counterparty is predicted to
      // accept (their gain positive under their own cash pressure — see scoreTradeCandidate's
      // leverage weighting), take the one that extracts the most for us. Against a comfortable
      // opponent only genuinely balanced offers pass the acceptability filter; against a
      // cash-desperate one, more lopsided deals clear it — which is exactly how positions of
      // strength should cash out in the offers actually made.
      const scored = generateTradeCandidates(state, playerId)
        .map((offer) => scoreTradeCandidate(activeGenome, state, offer))
        .filter((s) => s.myGain > actionThreshold && s.counterpartyGain > actionThreshold);
      if (scored.length === 0) return null;
      scored.sort((a, b) => b.myGain - a.myGain);
      return scored[0].offer;
    },

    evaluateTrade(state: GameState, _playerId: string, offer: TradeOffer): boolean {
      return scoreTradeCandidate(activeGenome, state, offer).counterpartyGain > actionThreshold;
    },
  };
}
