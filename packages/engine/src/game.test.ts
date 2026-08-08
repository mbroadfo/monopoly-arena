import { describe, expect, it } from "vitest";
import { createNaiveBot } from "./bots/naive.js";
import { createRandomBot } from "./bots/random.js";
import { mulberry32 } from "./dice.js";
import { Game } from "./game.js";
import type { Bot, GameState } from "./types.js";

describe("Game", () => {
  it("plays to completion without throwing", () => {
    // Seed chosen to terminate quickly. With auctions ensuring the whole board gets owned and
    // mortgaging giving players a safety net against bankruptcy, two-player games between these
    // bots can legitimately run very long (or effectively stall) for some seeds — cash from GO
    // salary keeps growing while rent stays fixed-size, so bankruptcy becomes rare. That's
    // expected emergent behavior, not a bug; this test just needs a seed that resolves.
    const game = new Game({
      playerNames: ["Alice", "Bob"],
      bots: [createNaiveBot(), createRandomBot()],
      rng: mulberry32(1),
    });

    let turns = 0;
    while (!game.isGameOver() && turns < 5000) {
      game.playTurn();
      turns += 1;
    }

    expect(game.isGameOver()).toBe(true);
    expect(game.state.winnerId).not.toBeNull();
  });

  it("auctions a property to the highest bidder when the landing player declines to buy", () => {
    const passivePassthrough = {
      chooseHouseToBuild: () => null,
      shouldPayToLeaveJail: () => true,
      raiseCash: () => null,
      chooseFinanceAction: () => null,
      proposeTrade: () => null,
      evaluateTrade: () => false,
    };
    // Neither bot ever buys directly, so every landed-on property goes to auction.
    const decliner: Bot = {
      name: "Decliner",
      ...passivePassthrough,
      shouldBuyProperty: () => false,
      auctionBid: (_state, _playerId, _spaceIndex, currentBid) => (currentBid === 0 ? 10 : null),
    };
    const bidder: Bot = {
      name: "Bidder",
      ...passivePassthrough,
      shouldBuyProperty: () => false,
      auctionBid: (_state, _playerId, _spaceIndex, currentBid) => currentBid + 20,
    };

    const game = new Game({ playerNames: ["A", "B"], bots: [decliner, bidder], rng: mulberry32(7) });

    let turns = 0;
    while (turns < 500 && !Object.values(game.state.ownership).some((r) => r.ownerId !== null)) {
      game.playTurn();
      turns += 1;
    }

    const ownedEntries = Object.entries(game.state.ownership).filter(([, r]) => r.ownerId !== null);
    expect(ownedEntries.length).toBeGreaterThan(0);
    // Bidder always outbids Decliner, so the first auctioned property should go to Bidder.
    expect(ownedEntries[0][1].ownerId).toBe(game.state.players[1].id);
  });

  it("leaves a property unowned when nobody bids at auction", () => {
    const passive: Bot = {
      name: "A",
      shouldBuyProperty: () => false,
      chooseHouseToBuild: () => null,
      shouldPayToLeaveJail: () => true,
      raiseCash: () => null,
      chooseFinanceAction: () => null,
      proposeTrade: () => null,
      evaluateTrade: () => false,
      auctionBid: () => null,
    };
    const game = new Game({ playerNames: ["A", "B"], bots: [passive, { ...passive, name: "B" }], rng: mulberry32(7) });

    let turns = 0;
    while (turns < 20 && !game.state.log.some((l) => l.includes("No bids for"))) {
      game.playTurn();
      turns += 1;
    }

    expect(game.state.log.some((l) => l.includes("No bids for"))).toBe(true);
    for (const record of Object.values(game.state.ownership)) {
      expect(record.ownerId).toBeNull();
    }
  });

  it("executes a proposed trade with a rent-cap condition, and the cap is honored later", () => {
    const BOARDWALK = 39;
    const passthrough = {
      chooseHouseToBuild: () => null,
      shouldPayToLeaveJail: () => true,
      raiseCash: () => null,
      chooseFinanceAction: () => null,
      auctionBid: () => null,
      shouldBuyProperty: () => false,
    };

    const seller: Bot = {
      name: "Seller",
      ...passthrough,
      proposeTrade: () => null,
      evaluateTrade: () => true,
    };
    const buyer: Bot = {
      name: "Buyer",
      ...passthrough,
      proposeTrade: (state, playerId) => {
        if (state.ownership[BOARDWALK].ownerId !== "p0") return null;
        return {
          fromPlayerId: playerId,
          toPlayerId: "p0",
          offeredProperties: [],
          offeredCash: 500,
          offeredGetOutOfJailFreeCards: 0,
          requestedProperties: [BOARDWALK],
          requestedCash: 0,
          requestedGetOutOfJailFreeCards: 0,
          conditions: [{ spaceIndex: BOARDWALK, ownerId: playerId, protectedPlayerId: "p0", kind: "cap", capLevel: 3 }],
        };
      },
      evaluateTrade: () => false,
    };

    // Fixed roll of 1+2=3 (never doubles) every time, so movement is fully predictable and
    // free of incidental tax/card effects — lets the cash/rent assertions below be exact.
    let call = 0;
    const fixedRoll = () => {
      call += 1;
      return call % 2 === 1 ? 0 : 0.2; // d1 = floor(0*6)+1 = 1, d2 = floor(0.2*6)+1 = 2
    };

    const game = new Game({ playerNames: ["Seller", "Buyer"], bots: [seller, buyer], rng: fixedRoll });
    game.state.currentPlayerIndex = 0; // force Seller to go first, independent of the starting roll
    // Seed ownership directly rather than relying on random landing to get there.
    game.state.ownership[BOARDWALK].ownerId = "p0";

    game.playTurn(); // Seller: 0 -> 3 (Baltic Avenue, declined, stays unowned).
    game.playTurn(); // Buyer: 0 -> 3 (same); proposes the trade, Seller accepts.

    expect(game.state.ownership[BOARDWALK].ownerId).toBe("p1");
    expect(game.state.players[1].cash).toBe(1000); // 1500 - 500
    expect(game.state.players[0].cash).toBe(2000); // 1500 + 500
    expect(game.state.tradeConditions).toEqual([
      { spaceIndex: BOARDWALK, ownerId: "p1", protectedPlayerId: "p0", kind: "cap", capLevel: 3 },
    ]);

    // Build a hotel directly (bypassing the normal build flow) so the uncapped rent would be
    // Boardwalk's top tier, then force Seller onto it next turn (3 -> 39 with the fixed roll)
    // and confirm the charged rent respects the cap instead.
    game.state.ownership[BOARDWALK].hotel = true;
    game.state.players[0].position = 36;
    game.playTurn(); // Seller: 36 -> 39 (Boardwalk).

    const rentLine = game.state.log.find((line) => line.includes("rent for Boardwalk"));
    expect(rentLine).toBeDefined();
    expect(rentLine).toContain("$1400"); // capLevel 3 rent, not the $2000 hotel rent
    expect(rentLine).not.toContain("$2000");
  });

  it("waives rent for a set number of uses via a trade condition, then charges normally", () => {
    // Unlike "cap" (used by NaiveBot/OrangeRushBot), no bot currently produces a "waive"
    // condition — this exercises that code path directly rather than leaving it untested.
    const BOARDWALK = 39;
    const passthrough = {
      chooseHouseToBuild: () => null,
      shouldPayToLeaveJail: () => true,
      raiseCash: () => null,
      chooseFinanceAction: () => null,
      auctionBid: () => null,
      shouldBuyProperty: () => false,
    };

    const seller: Bot = { name: "Seller", ...passthrough, proposeTrade: () => null, evaluateTrade: () => true };
    const buyer: Bot = {
      name: "Buyer",
      ...passthrough,
      proposeTrade: (state, playerId) => {
        if (state.ownership[BOARDWALK].ownerId !== "p0") return null;
        return {
          fromPlayerId: playerId,
          toPlayerId: "p0",
          offeredProperties: [],
          offeredCash: 500,
          offeredGetOutOfJailFreeCards: 0,
          requestedProperties: [BOARDWALK],
          requestedCash: 0,
          requestedGetOutOfJailFreeCards: 0,
          conditions: [{ spaceIndex: BOARDWALK, ownerId: playerId, protectedPlayerId: "p0", kind: "waive", usesRemaining: 2 }],
        };
      },
      evaluateTrade: () => false,
    };

    let call = 0;
    const fixedRoll = () => {
      call += 1;
      return call % 2 === 1 ? 0 : 0.2; // every roll: 1+2 = 3
    };

    const game = new Game({ playerNames: ["Seller", "Buyer"], bots: [seller, buyer], rng: fixedRoll });
    game.state.currentPlayerIndex = 0;
    game.state.ownership[BOARDWALK].ownerId = "p0";

    game.playTurn(); // Seller: proposes nothing.
    game.playTurn(); // Buyer: proposes the trade, Seller accepts.
    expect(game.state.tradeConditions).toEqual([
      { spaceIndex: BOARDWALK, ownerId: "p1", protectedPlayerId: "p0", kind: "waive", usesRemaining: 2 },
    ]);

    // First landing: waived, one use consumed.
    game.state.players[0].position = 36;
    game.playTurn(); // Seller: 36 -> 39.
    expect(game.state.log.at(-1)).toContain("owes no rent for Boardwalk (waived)");
    expect(game.state.tradeConditions[0].usesRemaining).toBe(1);
    game.playTurn(); // Buyer.

    // Second landing: waived again, uses now exhausted.
    game.state.players[0].position = 36;
    game.playTurn(); // Seller.
    expect(game.state.log.at(-1)).toContain("owes no rent for Boardwalk (waived)");
    expect(game.state.tradeConditions[0].usesRemaining).toBe(0);
    game.playTurn(); // Buyer.

    // Third landing: no uses left — full normal rent applies (base rent, no houses/hotel: $50).
    // Note: .at(-1), not .find() — the earlier waived-rent lines also contain "rent for Boardwalk".
    game.state.players[0].position = 36;
    game.playTurn(); // Seller.
    expect(game.state.log.at(-1)).toContain("rent for Boardwalk");
    expect(game.state.log.at(-1)).toContain("$50");
  });

  it("rejects building on a property that isn't the group's least-developed", () => {
    const ORANGE = [16, 18, 19]; // St. James Place, Tennessee Avenue, New York Avenue
    const bot: Bot = {
      name: "Builder",
      shouldBuyProperty: () => false,
      shouldPayToLeaveJail: () => true,
      raiseCash: () => null,
      chooseFinanceAction: () => null,
      auctionBid: () => null,
      proposeTrade: () => null,
      evaluateTrade: () => false,
      // Always tries to build on New York Ave, which already has more houses than its siblings.
      chooseHouseToBuild: () => 19,
    };

    const game = new Game({ playerNames: ["Builder"], bots: [bot], rng: mulberry32(1) });
    for (const i of ORANGE) game.state.ownership[i].ownerId = "p0";
    game.state.ownership[19].houses = 1; // ahead of its (still-unbuilt) siblings
    game.state.players[0].cash = 5000;

    game.playTurn();

    expect(game.state.ownership[19].houses).toBe(1); // unchanged — rejected by even-building
    expect(game.state.ownership[16].houses).toBe(0);
    expect(game.state.ownership[18].houses).toBe(0);
  });

  it("sells houses back respecting the reverse (most-developed-first) rule", () => {
    const ORANGE = [16, 18, 19];
    const passthrough = {
      shouldBuyProperty: () => false,
      shouldPayToLeaveJail: () => true,
      raiseCash: () => null,
      chooseHouseToBuild: () => null,
      auctionBid: () => null,
      proposeTrade: () => null,
      evaluateTrade: () => false,
    };
    let sellTarget = 19;
    const seller: Bot = {
      name: "Seller",
      ...passthrough,
      chooseFinanceAction: () => ({ action: "sell-house", spaceIndex: sellTarget }),
    };
    const dummy: Bot = { name: "Dummy", ...passthrough, chooseFinanceAction: () => null };

    const game = new Game({ playerNames: ["Seller", "Dummy"], bots: [seller, dummy], rng: mulberry32(1) });
    game.state.currentPlayerIndex = 0; // force Seller to go first regardless of the starting roll
    for (const i of ORANGE) game.state.ownership[i].ownerId = "p0";
    game.state.ownership[16].houses = 2;
    game.state.ownership[18].houses = 2;
    game.state.ownership[19].houses = 1; // least-developed
    const housesRemainingBefore = game.state.housesRemaining;
    const cashBefore = game.state.players[0].cash;

    game.playTurn(); // Seller tries to sell from 19 (least-developed) — rejected.
    game.playTurn(); // Dummy.
    expect(game.state.ownership[19].houses).toBe(1);
    expect(game.state.housesRemaining).toBe(housesRemainingBefore);
    expect(game.state.players[0].cash).toBe(cashBefore);

    sellTarget = 16; // tied for most-developed — allowed.
    game.playTurn(); // Seller.
    game.playTurn(); // Dummy.
    expect(game.state.ownership[16].houses).toBe(1);
    expect(game.state.housesRemaining).toBe(housesRemainingBefore + 1);
    expect(game.state.players[0].cash).toBe(cashBefore + 50); // St. James Place houseCost 100, half = 50

    // 18 (still at 2) is now the sole max — selling 16 again is correctly rejected until 18
    // catches down to tie with it, demonstrating the whole group has to come down evenly too.
    sellTarget = 16;
    game.playTurn(); // Seller: rejected, 18 is still the max.
    game.playTurn(); // Dummy.
    expect(game.state.ownership[16].houses).toBe(1);

    // The finance phase keeps calling chooseFinanceAction until it's rejected or null (same
    // loop mortgage/unmortgage already use) — since this bot always asks for 18 again, it
    // sells twice in the same turn: 2 -> 1 (ties with its siblings) -> 0 (still tied, allowed
    // again), only stopping on the third attempt once 19 becomes the sole remaining max.
    sellTarget = 18;
    game.playTurn(); // Seller: 18 drains 2 -> 0 in one turn.
    game.playTurn(); // Dummy.
    expect(game.state.ownership[18].houses).toBe(0);

    // Now 16 and 19 are tied at 1 (the group's max) — selling 16 down to 0 is allowed.
    sellTarget = 16;
    game.playTurn(); // Seller: 16 (1 -> 0); a second attempt at 16 would now fail (19 is the max).
    expect(game.state.ownership[16].houses).toBe(0);
  });

  it("charges double rent when a Chance card sends the player to the nearest owned railroad", () => {
    let call = 0;
    const fixedRoll = () => {
      call += 1;
      return call % 2 === 1 ? 0 : 0.2; // every roll: d1=1, d2=2, total=3
    };
    const passthrough = {
      shouldBuyProperty: () => false,
      shouldPayToLeaveJail: () => true,
      raiseCash: () => null,
      chooseHouseToBuild: () => null,
      chooseFinanceAction: () => null,
      auctionBid: () => null,
      proposeTrade: () => null,
      evaluateTrade: () => false,
    };
    const drawer: Bot = { name: "Drawer", ...passthrough };
    const owner: Bot = { name: "RailroadOwner", ...passthrough };

    const game = new Game({ playerNames: ["Drawer", "RailroadOwner"], bots: [drawer, owner], rng: fixedRoll });
    game.state.currentPlayerIndex = 0; // force Drawer to go first, independent of the starting roll
    game.state.players[0].cash = 10000; // clear of any incidental card/tax effects along the way
    // Pennsylvania Railroad (index 15) is the nearest railroad forward from Chance (index 7).
    // RailroadOwner owns only this one, so normal rent would be $25 — doubled by the card, $50.
    game.state.ownership[15].ownerId = "p1";

    let rentLine: string | undefined;
    for (let i = 0; i < 20 && !rentLine; i++) {
      game.state.players[0].position = 4; // 4 + roll(3) = 7 (Chance) every time, however the deck shuffled.
      game.playTurn(); // Drawer.
      rentLine = game.state.log.find((line) => line.includes("rent for Pennsylvania Railroad"));
      if (!rentLine) game.playTurn(); // RailroadOwner.
    }

    expect(rentLine).toBeDefined();
    expect(rentLine).toContain("$50"); // double the normal $25 single-railroad rent
  });

  it("does not move (or grant a roll) a player who stays in jail", () => {
    let call = 0;
    const fixedRoll = () => {
      call += 1;
      return call % 2 === 1 ? 0 : 0.2; // every roll: d1=1, d2=2 (never a double)
    };
    const passthrough = {
      shouldBuyProperty: () => false,
      shouldPayToLeaveJail: () => false, // never pays/uses a card — must roll for doubles
      raiseCash: () => null,
      chooseHouseToBuild: () => null,
      chooseFinanceAction: () => null,
      auctionBid: () => null,
      proposeTrade: () => null,
      evaluateTrade: () => false,
    };
    const jailed: Bot = { name: "Jailed", ...passthrough };
    const dummy: Bot = { name: "Dummy", ...passthrough };

    const game = new Game({ playerNames: ["Jailed", "Dummy"], bots: [jailed, dummy], rng: fixedRoll });
    game.state.currentPlayerIndex = 0;
    game.state.players[0].inJail = true;
    game.state.players[0].jailTurns = 0;
    game.state.players[0].position = 10; // Jail

    game.playTurn(); // Jailed: rolls a non-double, stays in jail — must NOT also move this turn.

    expect(game.state.players[0].position).toBe(10); // unchanged — this was the bug: it used to move anyway
    expect(game.state.players[0].inJail).toBe(true);
    expect(game.state.players[0].jailTurns).toBe(1);
    expect(game.state.log.at(-1)).toContain("stays in jail (turn 1/3)");
    expect(game.state.moves).toEqual([]); // no movement recorded this turn
  });

  it("moves exactly once — no bonus roll — when rolling doubles to leave jail", () => {
    const doubleRoll = () => 0.4; // every rng() call: floor(0.4*6)+1 = 3 -> d1=d2=3, always a double
    const passthrough = {
      shouldBuyProperty: () => false,
      shouldPayToLeaveJail: () => false,
      raiseCash: () => null,
      chooseHouseToBuild: () => null,
      chooseFinanceAction: () => null,
      auctionBid: () => null,
      proposeTrade: () => null,
      evaluateTrade: () => false,
    };
    const jailed: Bot = { name: "Jailed", ...passthrough };
    const dummy: Bot = { name: "Dummy", ...passthrough };

    const game = new Game({ playerNames: ["Jailed", "Dummy"], bots: [jailed, dummy], rng: doubleRoll });
    game.state.currentPlayerIndex = 0;
    game.state.players[0].inJail = true;
    game.state.players[0].jailTurns = 1;
    game.state.players[0].position = 10; // Jail

    game.playTurn(); // Jailed: rolls doubles (3+3=6), leaves jail, moves once to 16 — no bonus roll.

    expect(game.state.players[0].inJail).toBe(false);
    expect(game.state.players[0].position).toBe(16); // 10 + 6, a single move — this was the bug: it used to roll again
    expect(game.state.moves).toHaveLength(1);
    // toMatchObject, not toEqual: this test is about movement, not ownership — ownershipAfter is
    // covered by its own dedicated test below.
    expect(game.state.moves[0]).toMatchObject({ playerId: "p0", from: 10, to: 16, type: "walk", direction: "forward" });
  });

  it("records a walk move for the roll and a teleport move for a card that sends to jail", () => {
    let call = 0;
    const fixedRoll = () => {
      call += 1;
      return call % 2 === 1 ? 0 : 0.2; // every roll: d1=1, d2=2, total=3
    };
    const passthrough = {
      shouldBuyProperty: () => false,
      shouldPayToLeaveJail: () => true,
      raiseCash: () => null,
      chooseHouseToBuild: () => null,
      chooseFinanceAction: () => null,
      auctionBid: () => null,
      proposeTrade: () => null,
      evaluateTrade: () => false,
    };
    const drawer: Bot = { name: "Drawer", ...passthrough };
    const dummy: Bot = { name: "Dummy", ...passthrough };

    const game = new Game({ playerNames: ["Drawer", "Dummy"], bots: [drawer, dummy], rng: fixedRoll });
    game.state.currentPlayerIndex = 0; // force Drawer to go first, independent of the starting roll

    let jailMove: (typeof game.state.moves)[number] | undefined;
    for (let i = 0; i < 20 && !jailMove; i++) {
      game.state.players[0].position = 39; // 39 + roll(3) = 2 (Community Chest) every time.
      game.playTurn(); // Drawer.
      jailMove = game.state.moves.find((m) => m.type === "teleport");
      if (!jailMove) game.playTurn(); // Dummy.
    }

    expect(jailMove).toBeDefined();
    // toMatchObject, not toEqual: this test is about movement, not ownership — ownershipAfter is
    // covered by its own dedicated test below.
    expect(jailMove).toMatchObject({ playerId: "p0", from: 2, to: 10, type: "teleport", direction: "forward" });
    // The dice roll that landed on Community Chest is recorded as its own preceding walk move.
    expect(game.state.moves[0]).toMatchObject({ playerId: "p0", from: 39, to: 2, type: "walk", direction: "forward" });
  });

  it("stamps ownershipAfter on the move where a purchase happened, not just at turn end — the fix for the outline-lags-a-whole-turn animation bug", () => {
    const passthrough = {
      chooseHouseToBuild: () => null,
      shouldPayToLeaveJail: () => true,
      raiseCash: () => null,
      chooseFinanceAction: () => null,
      auctionBid: () => null,
      proposeTrade: () => null,
      evaluateTrade: () => false,
    };
    const buyer: Bot = { name: "Buyer", ...passthrough, shouldBuyProperty: () => true };
    const other: Bot = { name: "Other", ...passthrough, shouldBuyProperty: () => false };

    const game = new Game({ playerNames: ["Buyer", "Other"], bots: [buyer, other], rng: mulberry32(3) });

    // Search for a turn shaped like the reported bug: Buyer rolls doubles onto an unowned,
    // ownable space (buying it), then rolls again (doubles grants a bonus roll) and lands
    // somewhere else. Reset position each attempt rather than trying to hand-predict the exact
    // rng call count needed to hit this — the constructor's own deck shuffling and turn-order
    // rolls already consume an rng-implementation-dependent number of calls before play begins.
    let firstMove: GameState["moves"][number] | undefined;
    let secondMove: GameState["moves"][number] | undefined;
    for (let i = 0; i < 500 && !firstMove; i++) {
      game.state.currentPlayerIndex = 0;
      game.state.players[0].position = 0;
      game.state.players[0].cash = 1500; // otherwise repeated purchases across attempts would exhaust it
      for (const index of Object.keys(game.state.ownership)) game.state.ownership[Number(index)].ownerId = null;
      game.playTurn();
      if (game.state.moves.length < 2) continue;
      const [m0, m1] = game.state.moves;
      if (m0.to === m1.to) continue; // only care about a turn with two genuinely distinct landings
      if (m0.ownershipAfter[m0.to]?.ownerId !== "p0") continue; // first landing must have been a buy
      firstMove = m0;
      secondMove = m1;
    }

    expect(firstMove).toBeDefined();
    expect(secondMove).toBeDefined();

    // The whole point: the FIRST move's stamp already reflects the buy that happened on THAT
    // roll, not just whatever ownership looked like once the entire turn (both rolls) finished.
    expect(firstMove!.ownershipAfter[firstMove!.to].ownerId).toBe("p0");
    // Whatever the second landing was, it hadn't happened yet as of the first move's stamp.
    if (secondMove!.to in firstMove!.ownershipAfter) {
      expect(firstMove!.ownershipAfter[secondMove!.to].ownerId).not.toBe("p0");
    }
  });

  it("starts every player with $1500 and no properties owned", () => {
    const game = new Game({
      playerNames: ["Alice", "Bob"],
      bots: [createRandomBot(), createRandomBot()],
      rng: mulberry32(1),
    });
    for (const player of game.state.players) {
      expect(player.cash).toBe(1500);
    }
    for (const record of Object.values(game.state.ownership)) {
      expect(record.ownerId).toBeNull();
    }
  });
});
