import { BOARD, GROUP_MEMBERS } from "./board.js";
import { CHANCE_CARDS, COMMUNITY_CHEST_CARDS, type Card } from "./cards.js";
import { rollDice, type Rng } from "./dice.js";
import type { Bot, GameState, MoveEvent, Ownable, OwnershipRecord, PlayerState, PropertySpace, TradeCondition, TradeOffer } from "./types.js";

const STARTING_CASH = 1500;
const GO_SALARY = 200;
const JAIL_SPACE_INDEX = 10;
const GO_TO_JAIL_SPACE_INDEX = 30;
const MAX_JAIL_TURNS = 3;
const JAIL_FINE = 50;
const TOTAL_HOUSES = 32;
const TOTAL_HOTELS = 12;
const MAX_BUILD_ACTIONS_PER_TURN = 50;
const MORTGAGE_INTEREST_RATE = 0.1;
const MAX_FINANCE_ACTIONS_PER_TURN = 28; // one per ownable space, worst case
const AUCTION_BID_INCREMENT = 10;

interface Deck {
  cards: Card[];
  discard: Card[];
}

/** Special rent charged by the two "advance to nearest X" Chance cards, in place of the normal formula. */
type RentOverride = "double-railroad" | "utility-x10";

/**
 * Removes and returns the top card, reshuffling the discard pile back into the deck first if it's
 * empty. Deliberately doesn't discard the drawn card itself — a "Get Out of Jail Free" card must
 * stay out of circulation for as long as a player holds it unused (see `goojfHeld`), so the caller
 * decides where the card goes next instead of this function assuming "straight to discard."
 */
function draw(deck: Deck, rng: Rng): Card {
  if (deck.cards.length === 0) {
    deck.cards = shuffle(deck.discard, rng);
    deck.discard = [];
  }
  return deck.cards.shift()!;
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function describeTradeSide(properties: number[], cash: number, goojfCards: number): string {
  const parts: string[] = [];
  if (properties.length > 0) parts.push(properties.map((i) => BOARD[i].name).join(", "));
  if (cash > 0) parts.push(`$${cash}`);
  if (goojfCards > 0) parts.push(`${goojfCards} Get Out of Jail Free card${goojfCards > 1 ? "s" : ""}`);
  return parts.length > 0 ? parts.join(" + ") : "nothing";
}

/** Human-readable summary of a freshly-struck TradeCondition, for the play-by-play log. */
function describeTradeCondition(condition: TradeCondition, players: PlayerState[]): string {
  const space = BOARD[condition.spaceIndex] as PropertySpace;
  const protectedName = players.find((p) => p.id === condition.protectedPlayerId)?.name ?? condition.protectedPlayerId;
  if (condition.kind === "waive") {
    const uses = condition.usesRemaining ?? 0;
    return `${protectedName} pays no rent on ${space.name} for the next ${uses} visit${uses === 1 ? "" : "s"}`;
  }
  return `${protectedName}'s rent on ${space.name} is capped at $${space.rent[condition.capLevel!]}`;
}

export interface GameOptions {
  playerNames: string[];
  bots: Bot[];
  rng?: Rng;
}

/** Which player currently holds each deck's single "Get Out of Jail Free" card, or null if it's
 * sitting in that deck's cards/discard instead — real Monopoly only ever has one physical GOOJF
 * card per deck, out with at most one player at a time, never both in the deck and someone's hand. */
interface GoojfHolder {
  chance: { playerId: string; card: Card } | null;
  communityChest: { playerId: string; card: Card } | null;
}

export class Game {
  state: GameState;
  private bots: Map<string, Bot> = new Map();
  private rng: Rng;
  private chanceDeck: Deck;
  private communityChestDeck: Deck;
  private goojfHeld: GoojfHolder = { chance: null, communityChest: null };
  // "Round" (every active player gets one turn) is a purely log-formatting concept, distinct from
  // state.turn (one *player's* whole turn, incrementing per playTurn() call — used throughout
  // encoding/UI as a game-length signal, so it keeps its existing meaning unchanged). Tracked by
  // watching for the acting player's seat index wrapping back to <= the last one seen: robust to
  // bankruptcies removing higher-indexed seats from rotation, unlike waiting for a fixed "seat 0"
  // that a bankrupt starting player might never occupy again. Starts at +Infinity, not -1 — any
  // real (finite, >=0) seat index must satisfy "<= last seen" on the very first turn too, so round
  // 1 actually gets its header instead of being silently skipped.
  private roundNumber = 0;
  private lastRoundSeatIndex = Number.POSITIVE_INFINITY;

  constructor(options: GameOptions) {
    if (options.playerNames.length !== options.bots.length) {
      throw new Error("playerNames and bots must be the same length");
    }
    this.rng = options.rng ?? Math.random;
    this.chanceDeck = { cards: shuffle(CHANCE_CARDS, this.rng), discard: [] };
    this.communityChestDeck = { cards: shuffle(COMMUNITY_CHEST_CARDS, this.rng), discard: [] };

    const players: PlayerState[] = options.playerNames.map((name, i) => ({
      id: `p${i}`,
      name,
      cash: STARTING_CASH,
      position: 0,
      inJail: false,
      jailTurns: 0,
      bankrupt: false,
      getOutOfJailFreeCards: 0,
    }));
    players.forEach((p, i) => this.bots.set(p.id, options.bots[i]));

    const ownership: Record<number, OwnershipRecord> = {};
    for (const space of BOARD) {
      if (space.type === "property" || space.type === "railroad" || space.type === "utility") {
        ownership[space.index] = { ownerId: null, houses: 0, hotel: false, mortgaged: false };
      }
    }

    this.state = {
      turn: 0,
      spaces: BOARD,
      ownership,
      players,
      currentPlayerIndex: 0,
      housesRemaining: TOTAL_HOUSES,
      hotelsRemaining: TOTAL_HOTELS,
      log: [],
      winnerId: null,
      doublesStreak: 0,
      tradeConditions: [],
      moves: [],
    };
    this.state.currentPlayerIndex = this.determineStartingPlayer();
  }

  /**
   * Real rule: every player rolls once, highest total goes first; ties re-roll among just the
   * tied players. Doesn't reorder the player array — turns still rotate through the original
   * seating order (matching a real table's clockwise order), just starting from whoever won.
   */
  private determineStartingPlayer(): number {
    let candidates = this.state.players.map((_, i) => i);
    // Capped so a pathological (e.g. constant-output) RNG can't tie forever — after 20 rounds,
    // just take whoever's still tied first rather than looping indefinitely.
    for (let round = 0; candidates.length > 1 && round < 20; round++) {
      const rolls = candidates.map((i) => {
        const roll = rollDice(this.rng);
        this.log(`${this.state.players[i].name} rolls ${roll.d1}+${roll.d2} (${roll.total}) to determine turn order.`);
        return { index: i, total: roll.total };
      });
      const maxTotal = Math.max(...rolls.map((r) => r.total));
      candidates = rolls.filter((r) => r.total === maxTotal).map((r) => r.index);
      if (candidates.length > 1) {
        this.log(`Tie between ${candidates.map((i) => this.state.players[i].name).join(", ")} — rolling again.`);
      }
    }
    this.log(`${this.state.players[candidates[0]].name} goes first.`);
    return candidates[0];
  }

  getSnapshot(): GameState {
    return structuredClone(this.state);
  }

  /**
   * Resumes a `Game` from an existing mid-game `GameState` (e.g. from `getSnapshot()`) instead of
   * starting fresh — for search-based bots simulating hypothetical futures. Reuses the constructor
   * for its harmless, discarded fresh-init bookkeeping (decks, rng storage), then overwrites the
   * state and rebuilds the bots map keyed by the resumed state's actual player IDs (not the
   * fresh-init IDs the throwaway construction generated), so bot identity survives the swap
   * correctly regardless of ID-generation details. Chance/Community Chest deck order isn't part of
   * `GameState`, so the resumed game gets a freshly-shuffled deck — the correct model, since a real
   * player doesn't know deck order either. `getOutOfJailFreeCards` totals *are* part of `GameState`
   * though, and which specific deck each held card came from isn't recoverable — so any card a
   * resumed player already holds gets pulled out of the fresh deck it would otherwise still be in
   * (arbitrarily choosing whichever deck still has one to pull), preventing this resumed game from
   * redrawing a card the state says is already spoken for. It won't have anywhere to return to on
   * use here, but a `fromState` game is a throwaway hypothetical-future simulation, not the
   * canonical game, so that's the right trade for keeping its own deck accounting internally
   * consistent rather than perfectly provenanced.
   */
  static fromState(state: GameState, bots: Bot[], rng: Rng = Math.random): Game {
    const game = new Game({ playerNames: state.players.map((p) => p.name), bots, rng });
    game.state = structuredClone(state);
    game.bots = new Map(state.players.map((p, i) => [p.id, bots[i]]));

    let alreadyHeld = state.players.reduce((sum, p) => sum + p.getOutOfJailFreeCards, 0);
    for (const deck of [game.chanceDeck, game.communityChestDeck]) {
      if (alreadyHeld <= 0) break;
      const index = deck.cards.findIndex((c) => c.effect.kind === "get-out-of-jail-free");
      if (index !== -1) {
        deck.cards.splice(index, 1);
        alreadyHeld--;
      }
    }
    return game;
  }

  isGameOver(): boolean {
    return this.state.winnerId !== null;
  }

  private log(message: string) {
    this.state.log.push(message);
  }

  /** Anything that happens *within* a player's turn — roll, landing, rent, a card, a build, a
   * trade, jail resolution — indented two spaces so a whole turn visually reads as one block
   * nested under its `logTurnMarker` header, rather than a flat run of sequential lines
   * indistinguishable from the turns before and after it. `tag` is one of the short category
   * labels (ROLL/RENT/CARD/BUILD/MORTGAGE/TRADE/JAIL) for the subset of events that have one;
   * plenty of legitimate turn events (buying a property, an auction, paying tax, going bankrupt)
   * don't fit any of those seven and are deliberately left untagged rather than force-fit. */
  private logEvent(message: string, tag?: string) {
    this.log(tag ? `  [${tag}] ${message}` : `  ${message}`);
  }

  /** Logs a "Round N" header the moment the acting player's seat index wraps back around to at or
   * below the last one seen — i.e. a fresh lap of the table has begun. Call once per `playTurn()`,
   * before anything else gets logged for that turn. */
  private maybeStartNewRound() {
    if (this.state.currentPlayerIndex <= this.lastRoundSeatIndex) {
      this.roundNumber++;
      this.log(`Round ${this.roundNumber}`);
    }
    this.lastRoundSeatIndex = this.state.currentPlayerIndex;
  }

  /** "Round N · Player's turn" — the block header every turn's indented events (see `logEvent`)
   * nest under. `suffix` distinguishes a bonus roll from rolling doubles from the turn's initial
   * roll, without implying a whole new turn — the round number and player don't change either. */
  private logTurnMarker(player: PlayerState, suffix = "") {
    this.log(`Round ${this.roundNumber} · ${player.name}'s turn${suffix}`);
  }

  private currentPlayer(): PlayerState {
    return this.state.players[this.state.currentPlayerIndex];
  }

  private activePlayers(): PlayerState[] {
    return this.state.players.filter((p) => !p.bankrupt);
  }

  private advanceToNextPlayer() {
    const n = this.state.players.length;
    for (let step = 1; step <= n; step++) {
      const idx = (this.state.currentPlayerIndex + step) % n;
      if (!this.state.players[idx].bankrupt) {
        this.state.currentPlayerIndex = idx;
        return;
      }
    }
  }

  /** Plays one full turn (including chained doubles) for the current player. */
  playTurn(): void {
    if (this.isGameOver()) return;
    const player = this.currentPlayer();
    if (player.bankrupt) {
      this.advanceToNextPlayer();
      return;
    }

    this.state.turn += 1;
    this.state.doublesStreak = 0;
    this.state.moves = [];

    this.maybeStartNewRound();
    this.logTurnMarker(player);

    let shouldRollNormally = true;
    if (player.inJail) {
      shouldRollNormally = this.handleJailTurn(player);
      if (player.bankrupt || this.isGameOver()) return;
    }

    let keepRolling = shouldRollNormally;
    let firstRoll = true;
    while (keepRolling && !player.bankrupt) {
      // The turn marker above already covers this turn's first roll — only a bonus roll chained
      // from doubles gets its own follow-up marker, distinguishing it from a brand new turn.
      if (!firstRoll) this.logTurnMarker(player, " (bonus roll — doubles)");
      firstRoll = false;
      keepRolling = this.rollAndMove(player);
      if (this.isGameOver()) return;
    }

    this.runTradePhase(player);
    this.runBuildPhase(player);
    this.runFinancePhase(player);
    this.checkForWinner();
    this.advanceToNextPlayer();
  }

  /**
   * Returns true if the player should still take a normal roll-and-move this same turn — only
   * true for the "paid/used a card to get out" branches, which release the player *before* they'd
   * roll, matching the real rule that you get a normal turn immediately after. The other branches
   * either already moved the player themselves (the releasing roll doubles, or the forced-out
   * roll after serving max time) or leave them in jail — either way, no roll-and-move follows.
   */
  private handleJailTurn(player: PlayerState): boolean {
    const bot = this.bots.get(player.id)!;
    if (player.getOutOfJailFreeCards > 0 && bot.shouldPayToLeaveJail(this.getSnapshot(), player.id)) {
      player.getOutOfJailFreeCards -= 1;
      this.releaseGoojfCard(player.id);
      player.inJail = false;
      player.jailTurns = 0;
      this.logEvent(`${player.name} uses a Get Out of Jail Free card.`, "JAIL");
      return true;
    }
    if (bot.shouldPayToLeaveJail(this.getSnapshot(), player.id) && player.cash >= JAIL_FINE) {
      player.cash -= JAIL_FINE;
      player.inJail = false;
      player.jailTurns = 0;
      this.logEvent(`${player.name} pays $${JAIL_FINE} to leave jail.`, "JAIL");
      return true;
    }
    const roll = rollDice(this.rng);
    this.logEvent(`${player.name} (in jail) rolls ${roll.d1}+${roll.d2}.`, "JAIL");
    if (roll.isDouble) {
      player.inJail = false;
      player.jailTurns = 0;
      this.logEvent(`${player.name} rolls doubles and leaves jail.`, "JAIL");
      const move = this.movePlayer(player, roll.total);
      this.resolveSpace(player);
      move.ownershipAfter = structuredClone(this.state.ownership);
      return false;
    }
    player.jailTurns += 1;
    if (player.jailTurns >= MAX_JAIL_TURNS) {
      if (player.cash >= JAIL_FINE) {
        player.cash -= JAIL_FINE;
      } else {
        this.handleBankruptcy(player, null);
        return false;
      }
      player.inJail = false;
      player.jailTurns = 0;
      this.logEvent(`${player.name} has served max jail time and pays $${JAIL_FINE}.`, "JAIL");
      const move = this.movePlayer(player, roll.total);
      this.resolveSpace(player);
      move.ownershipAfter = structuredClone(this.state.ownership);
      return false;
    }
    this.logEvent(`${player.name} stays in jail (turn ${player.jailTurns}/${MAX_JAIL_TURNS}).`, "JAIL");
    return false;
  }

  /** Rolls, moves, and resolves the landing space. Returns true if the player rolled doubles and should go again. */
  private rollAndMove(player: PlayerState): boolean {
    const roll = rollDice(this.rng);
    this.logEvent(`${player.name} rolls ${roll.d1}+${roll.d2} (${roll.total}).`, "ROLL");

    if (roll.isDouble) {
      this.state.doublesStreak += 1;
      if (this.state.doublesStreak === 3) {
        this.logEvent(`${player.name} rolled doubles three times in a row and goes to jail.`, "JAIL");
        this.sendToJail(player);
        return false;
      }
    } else {
      this.state.doublesStreak = 0;
    }

    const move = this.movePlayer(player, roll.total);
    this.resolveSpace(player);
    move.ownershipAfter = structuredClone(this.state.ownership);
    return roll.isDouble && !player.inJail;
  }

  /**
   * Pushes and returns the `MoveEvent` so the caller can stamp `ownershipAfter` once the landing
   * (via `resolveSpace`) has fully resolved — `ownershipAfter` starts as a cheap reference (not a
   * clone) here, since ownership hasn't resolved yet at push time.
   */
  private movePlayer(player: PlayerState, spaces: number): MoveEvent {
    const before = player.position;
    player.position = (player.position + spaces) % 40;
    if (player.position < before) {
      player.cash += GO_SALARY;
      this.logEvent(`${player.name} passes GO and collects $${GO_SALARY}.`);
    }
    const move: MoveEvent = {
      playerId: player.id,
      from: before,
      to: player.position,
      type: "walk",
      direction: "forward",
      ownershipAfter: this.state.ownership,
    };
    this.state.moves.push(move);
    return move;
  }

  /** Walks forward from a position (wrapping at 40) to the first space of the given type. */
  private nearestSpaceOfType(fromPosition: number, type: "railroad" | "utility"): number {
    for (let offset = 1; offset <= 40; offset++) {
      const index = (fromPosition + offset) % 40;
      if (BOARD[index].type === type) return index;
    }
    throw new Error(`no space of type ${type} on the board`); // unreachable given board composition
  }

  /**
   * Pushes and returns the `MoveEvent`, fully stamped — unlike `movePlayer`, no `resolveSpace`
   * follows a jail teleport, so there's no ownership change to wait for; the clone can happen
   * immediately.
   */
  private sendToJail(player: PlayerState): MoveEvent {
    const before = player.position;
    player.position = JAIL_SPACE_INDEX;
    player.inJail = true;
    player.jailTurns = 0;
    const move: MoveEvent = {
      playerId: player.id,
      from: before,
      to: JAIL_SPACE_INDEX,
      type: "teleport",
      direction: "forward",
      ownershipAfter: structuredClone(this.state.ownership),
    };
    this.state.moves.push(move);
    return move;
  }

  private resolveSpace(player: PlayerState, rentOverride?: RentOverride) {
    const space = BOARD[player.position];
    this.logEvent(`${player.name} lands on ${space.name}.`);

    switch (space.type) {
      case "go":
      case "jail":
      case "free-parking":
        return;
      case "go-to-jail":
        this.logEvent(`${player.name} is sent to jail.`, "JAIL");
        this.sendToJail(player);
        return;
      case "tax":
        this.payBank(player, space.amount ?? 0, `${space.name}`);
        return;
      case "chance":
        this.applyCard(player, this.drawAndFile(this.chanceDeck, "chance", player));
        return;
      case "community-chest":
        this.applyCard(player, this.drawAndFile(this.communityChestDeck, "communityChest", player));
        return;
      case "property":
      case "railroad":
      case "utility":
        this.resolveOwnableSpace(player, space.index, rentOverride);
        return;
    }
  }

  private resolveOwnableSpace(player: PlayerState, spaceIndex: number, rentOverride?: RentOverride) {
    const record = this.state.ownership[spaceIndex];
    const space = BOARD[spaceIndex] as PropertySpace | Extract<(typeof BOARD)[number], { type: "railroad" | "utility" }>;
    if (record.ownerId === null) {
      const bot = this.bots.get(player.id)!;
      const price = space.price;
      if (player.cash >= price && bot.shouldBuyProperty(this.getSnapshot(), player.id, spaceIndex)) {
        player.cash -= price;
        record.ownerId = player.id;
        this.logEvent(`${player.name} buys ${space.name} for $${price}.`);
        this.checkMonopolyFormed(player, space.group);
      } else {
        this.logEvent(`${player.name} declines to buy ${space.name}. It goes to auction.`);
        this.runAuction(spaceIndex);
      }
      return;
    }
    if (record.ownerId === player.id || record.mortgaged) return;

    const owner = this.state.players.find((p) => p.id === record.ownerId)!;
    const rent = this.calculateRent(space, record, owner, player, rentOverride);
    if (rent === 0 && space.type === "property") {
      // calculateRent already logged the waiving trade condition that caused this.
      return;
    }
    this.logEvent(`${player.name} owes ${owner.name} $${rent} rent for ${space.name}.`, "RENT");
    this.payPlayer(player, owner, rent);
  }

  /** Runs a bidding auction for an unowned property among all active players. */
  private runAuction(spaceIndex: number) {
    const space = BOARD[spaceIndex] as Ownable;
    const bidders = this.activePlayers().map((p) => p.id);
    if (bidders.length === 0) return;

    let currentBid = 0;
    let highBidderId: string | null = null;
    const passed = new Set<string>();
    const maxTurns = bidders.length * 30;

    for (let turn = 0, i = 0; turn < maxTurns; turn++, i++) {
      const remaining = bidders.filter((id) => !passed.has(id));
      if (remaining.length === 0) break;
      if (remaining.length === 1 && highBidderId !== null) break;

      const playerId = bidders[i % bidders.length];
      if (passed.has(playerId)) continue;

      const player = this.state.players.find((p) => p.id === playerId)!;
      const bot = this.bots.get(playerId)!;
      const nextMinBid = currentBid + AUCTION_BID_INCREMENT;
      const bid = bot.auctionBid(this.getSnapshot(), playerId, spaceIndex, currentBid, highBidderId);
      if (bid !== null && bid >= nextMinBid && bid <= player.cash) {
        currentBid = bid;
        highBidderId = playerId;
      } else {
        passed.add(playerId);
      }
    }

    if (highBidderId) {
      const winner = this.state.players.find((p) => p.id === highBidderId)!;
      winner.cash -= currentBid;
      this.state.ownership[spaceIndex].ownerId = winner.id;
      this.logEvent(`${winner.name} wins the auction for ${space.name} at $${currentBid}.`);
      this.checkMonopolyFormed(winner, space.group);
    } else {
      this.logEvent(`No bids for ${space.name}; it remains unowned.`);
    }
  }

  private calculateRent(
    space: PropertySpace | Extract<(typeof BOARD)[number], { type: "railroad" | "utility" }>,
    record: OwnershipRecord,
    owner: PlayerState,
    payer: PlayerState,
    rentOverride?: RentOverride,
  ): number {
    // The two "advance to nearest X" Chance cards charge a special rent instead of the normal
    // formula: double for a railroad, 10x the dice roll for a utility, regardless of how many
    // the owner has.
    if (rentOverride === "double-railroad" && space.type === "railroad") {
      const ownedCount = GROUP_MEMBERS.railroad.filter((i) => this.state.ownership[i].ownerId === owner.id).length;
      return 25 * Math.pow(2, ownedCount - 1) * 2;
    }
    if (rentOverride === "utility-x10" && space.type === "utility") {
      const roll = rollDice(this.rng);
      return roll.total * 10;
    }
    if (space.type === "railroad") {
      const ownedCount = GROUP_MEMBERS.railroad.filter((i) => this.state.ownership[i].ownerId === owner.id).length;
      return 25 * Math.pow(2, ownedCount - 1);
    }
    if (space.type === "utility") {
      const ownedCount = GROUP_MEMBERS.utility.filter((i) => this.state.ownership[i].ownerId === owner.id).length;
      const multiplier = ownedCount >= 2 ? 10 : 4;
      const roll = rollDice(this.rng);
      return roll.total * multiplier;
    }

    let rent: number;
    if (record.hotel) rent = space.rent[5];
    else if (record.houses > 0) rent = space.rent[record.houses];
    else {
      const hasMonopoly = GROUP_MEMBERS[space.group].every((i) => this.state.ownership[i].ownerId === owner.id);
      rent = hasMonopoly ? space.rent[0] * 2 : space.rent[0];
    }

    // Trade-negotiated rent waiver/cap — only applies to color properties, and only while
    // the same player who struck the deal still owns it (see TradeCondition doc comment).
    const condition = this.state.tradeConditions.find(
      (c) => c.spaceIndex === space.index && c.ownerId === owner.id && c.protectedPlayerId === payer.id,
    );
    if (condition?.kind === "waive" && (condition.usesRemaining ?? 0) > 0) {
      condition.usesRemaining! -= 1;
      const remaining = condition.usesRemaining!;
      this.logEvent(
        `Trade condition applies: ${payer.name} owes no rent on ${space.name}` +
          (remaining > 0 ? ` (${remaining} use${remaining === 1 ? "" : "s"} left).` : " (condition now used up)."),
        "TRADE",
      );
      return 0;
    }
    if (condition?.kind === "cap" && condition.capLevel !== undefined) {
      const capped = Math.min(rent, space.rent[condition.capLevel]);
      if (capped < rent) {
        this.logEvent(`Trade condition applies: ${payer.name}'s rent on ${space.name} is capped at $${capped} (would have been $${rent}).`, "TRADE");
      }
      return capped;
    }
    return rent;
  }

  /** Draws from `deck` and, if it's the "Get Out of Jail Free" card, files it under `goojfHeld`
   * instead of the discard pile — see `GoojfHolder`. Every other card discards as normal. */
  private drawAndFile(deck: Deck, deckKind: keyof GoojfHolder, player: PlayerState): Card {
    const card = draw(deck, this.rng);
    if (card.effect.kind === "get-out-of-jail-free") {
      this.goojfHeld[deckKind] = { playerId: player.id, card };
    } else {
      deck.discard.push(card);
    }
    return card;
  }

  /** Returns whichever deck's "Get Out of Jail Free" card `playerId` holds (if any) to that
   * deck's discard pile, freeing it to be reshuffled back into circulation. Called when a card is
   * actually used to leave jail, or when its holder goes bankrupt to the bank. */
  private releaseGoojfCard(playerId: string): void {
    if (this.goojfHeld.chance?.playerId === playerId) {
      this.chanceDeck.discard.push(this.goojfHeld.chance.card);
      this.goojfHeld.chance = null;
      return;
    }
    if (this.goojfHeld.communityChest?.playerId === playerId) {
      this.communityChestDeck.discard.push(this.goojfHeld.communityChest.card);
      this.goojfHeld.communityChest = null;
    }
  }

  /** Moves one held "Get Out of Jail Free" card from `fromId` to `toId` without touching either
   * deck — the physical card just changes hands (a trade, or a bankruptcy paid to a creditor). */
  private transferGoojfCard(fromId: string, toId: string): void {
    if (this.goojfHeld.chance?.playerId === fromId) {
      this.goojfHeld.chance.playerId = toId;
      return;
    }
    if (this.goojfHeld.communityChest?.playerId === fromId) {
      this.goojfHeld.communityChest.playerId = toId;
    }
  }

  private applyCard(player: PlayerState, card: Card) {
    this.logEvent(`${player.name} draws: "${card.text}"`, "CARD");
    const effect = card.effect;
    switch (effect.kind) {
      case "advance-to": {
        const before = player.position;
        player.position = effect.spaceIndex;
        if (player.position < before || effect.spaceIndex === 0) {
          player.cash += GO_SALARY;
          this.logEvent(`${player.name} passes GO and collects $${GO_SALARY}.`);
        }
        const move: MoveEvent = {
          playerId: player.id,
          from: before,
          to: player.position,
          type: "walk",
          direction: "forward",
          ownershipAfter: this.state.ownership,
        };
        this.state.moves.push(move);
        this.resolveSpace(player);
        move.ownershipAfter = structuredClone(this.state.ownership);
        return;
      }
      case "advance-spaces": {
        const move = this.movePlayer(player, effect.spaces);
        this.resolveSpace(player);
        move.ownershipAfter = structuredClone(this.state.ownership);
        return;
      }
      case "advance-to-nearest-railroad": {
        const before = player.position;
        player.position = this.nearestSpaceOfType(before, "railroad");
        if (player.position < before) {
          player.cash += GO_SALARY;
          this.logEvent(`${player.name} passes GO and collects $${GO_SALARY}.`);
        }
        const move: MoveEvent = {
          playerId: player.id,
          from: before,
          to: player.position,
          type: "walk",
          direction: "forward",
          ownershipAfter: this.state.ownership,
        };
        this.state.moves.push(move);
        this.resolveSpace(player, "double-railroad");
        move.ownershipAfter = structuredClone(this.state.ownership);
        return;
      }
      case "advance-to-nearest-utility": {
        const before = player.position;
        player.position = this.nearestSpaceOfType(before, "utility");
        if (player.position < before) {
          player.cash += GO_SALARY;
          this.logEvent(`${player.name} passes GO and collects $${GO_SALARY}.`);
        }
        const move: MoveEvent = {
          playerId: player.id,
          from: before,
          to: player.position,
          type: "walk",
          direction: "forward",
          ownershipAfter: this.state.ownership,
        };
        this.state.moves.push(move);
        this.resolveSpace(player, "utility-x10");
        move.ownershipAfter = structuredClone(this.state.ownership);
        return;
      }
      case "go-back-spaces": {
        // Never awards GO salary, even if it would wrap past 0 — matches the real rule, and
        // sidesteps movePlayer's forward-only pass-GO detection and JS's negative-modulo quirk.
        const before = player.position;
        player.position = ((player.position - effect.spaces) % 40 + 40) % 40;
        const move: MoveEvent = {
          playerId: player.id,
          from: before,
          to: player.position,
          type: "walk",
          direction: "backward",
          ownershipAfter: this.state.ownership,
        };
        this.state.moves.push(move);
        this.resolveSpace(player);
        move.ownershipAfter = structuredClone(this.state.ownership);
        return;
      }
      case "collect":
        player.cash += effect.amount;
        return;
      case "pay":
        this.payBank(player, effect.amount, "a card");
        return;
      case "go-to-jail":
        this.sendToJail(player);
        return;
      case "get-out-of-jail-free":
        player.getOutOfJailFreeCards += 1;
        return;
      case "pay-each-player":
        for (const other of this.activePlayers()) {
          if (other.id === player.id) continue;
          this.payPlayer(player, other, effect.amount);
          if (player.bankrupt) return;
        }
        return;
      case "collect-from-each-player":
        for (const other of this.activePlayers()) {
          if (other.id === player.id) continue;
          this.payPlayer(other, player, effect.amount);
        }
        return;
      case "repairs": {
        let total = 0;
        for (const [indexStr, record] of Object.entries(this.state.ownership)) {
          if (record.ownerId !== player.id) continue;
          if (record.hotel) total += effect.perHotel;
          else total += record.houses * effect.perHouse;
        }
        this.payBank(player, total, "repairs");
        return;
      }
    }
  }

  private payBank(player: PlayerState, amount: number, reason: string) {
    if (amount <= 0) return;
    if (player.cash < amount) this.raiseCash(player, amount - player.cash);
    if (player.cash < amount) {
      this.handleBankruptcy(player, null);
      return;
    }
    player.cash -= amount;
    this.logEvent(`${player.name} pays $${amount} for ${reason}.`);
  }

  private payPlayer(payer: PlayerState, payee: PlayerState, amount: number) {
    if (amount <= 0) return;
    if (payer.cash < amount) this.raiseCash(payer, amount - payer.cash);
    if (payer.cash < amount) {
      this.handleBankruptcy(payer, payee);
      return;
    }
    payer.cash -= amount;
    payee.cash += amount;
  }

  private mortgageValue(spaceIndex: number): number {
    const space = BOARD[spaceIndex] as Ownable;
    return Math.floor(space.price / 2);
  }

  private unmortgageCost(spaceIndex: number): number {
    return Math.ceil(this.mortgageValue(spaceIndex) * (1 + MORTGAGE_INTEREST_RATE));
  }

  private canMortgage(playerId: string, spaceIndex: number): boolean {
    const record = this.state.ownership[spaceIndex];
    if (!record || record.ownerId !== playerId || record.mortgaged) return false;
    return !record.hotel && record.houses === 0;
  }

  private canUnmortgage(playerId: string, spaceIndex: number): boolean {
    const record = this.state.ownership[spaceIndex];
    return !!record && record.ownerId === playerId && record.mortgaged;
  }

  private doMortgage(player: PlayerState, spaceIndex: number) {
    const record = this.state.ownership[spaceIndex];
    const value = this.mortgageValue(spaceIndex);
    record.mortgaged = true;
    player.cash += value;
    this.logEvent(`${player.name} mortgages ${BOARD[spaceIndex].name} for $${value}.`, "MORTGAGE");
  }

  private doUnmortgage(player: PlayerState, spaceIndex: number) {
    const record = this.state.ownership[spaceIndex];
    const cost = this.unmortgageCost(spaceIndex);
    record.mortgaged = false;
    player.cash -= cost;
    this.logEvent(`${player.name} pays off the mortgage on ${BOARD[spaceIndex].name} for $${cost}.`, "MORTGAGE");
  }

  /**
   * Gives the player's bot a chance to mortgage properties to cover a shortfall, before bankruptcy.
   *
   * `amountNeeded` (from `payBank`/`payPlayer`) is the shortfall *at the moment this is called* —
   * `amount - player.cash`, a fixed number. This used to be compared directly against
   * `player.cash` as the loop's own exit condition, which is comparing two different things: total
   * cash on hand vs. the *initial* shortfall. For any debt smaller than the player's cash on hand
   * (the common case — e.g. $48 cash, $2 short of a $50 payment), `player.cash < amountNeeded` is
   * false from the very first check, so the loop body never runs even once and a solvent-looking
   * player goes straight to bankruptcy without the bot ever getting a chance to mortgage anything.
   * Recomputing a fixed `target` up front (the true total the player must reach) fixes both that
   * and the same bug's second half — the old code also passed the bot a `amountNeeded - player.cash`
   * argument that went *negative* on any iteration after the first, once cash had grown past the
   * stale initial shortfall figure.
   *
   * Falls back to automatically selling down the player's own most-developed property (see
   * `anySellableProperty`) once the bot has no mortgageable property left to offer — every bot's
   * `raiseCash` can only name a house-free property (see its `BotDecisions` doc comment), so a
   * player whose cash is tied up in houses/hotels had no legal way to raise cash at all before
   * this, and could go bankrupt over a trivial shortfall while still holding substantial
   * liquidatable equity. Selling a house can itself free a property up for the bot to mortgage on
   * the next iteration (it re-asks the bot first every time), so the two mechanisms chain
   * naturally without extra bookkeeping.
   */
  private raiseCash(player: PlayerState, amountNeeded: number) {
    const bot = this.bots.get(player.id)!;
    const target = player.cash + amountNeeded; // the true total cash the player must reach
    for (let i = 0; i < MAX_FINANCE_ACTIONS_PER_TURN && player.cash < target; i++) {
      const choice = bot.raiseCash(this.getSnapshot(), player.id, target - player.cash);
      if (choice !== null && this.canMortgage(player.id, choice)) {
        this.doMortgage(player, choice);
        continue;
      }
      const sellable = this.anySellableProperty(player.id);
      if (sellable === null) return;
      this.trySellHouse(player, sellable);
    }
  }

  /** Any one of `playerId`'s own properties currently eligible to sell a house/hotel from (the
   * same even-building-in-reverse rule `trySellHouse` itself enforces) — a generic last-resort
   * candidate, not a considered choice of *which* one, since this only fires once the player's own
   * bot has already failed to offer a way to cover a shortfall. */
  private anySellableProperty(playerId: string): number | null {
    for (const [group, indices] of Object.entries(GROUP_MEMBERS)) {
      if (group === "railroad" || group === "utility") continue;
      const maxLevel = Math.max(...indices.map((i) => this.improvementLevel(this.state.ownership[i])));
      if (maxLevel === 0) continue;
      for (const index of indices) {
        const record = this.state.ownership[index];
        if (record.ownerId !== playerId) continue;
        if (this.improvementLevel(record) < maxLevel) continue;
        return index;
      }
    }
    return null;
  }

  private runFinancePhase(player: PlayerState) {
    if (player.bankrupt) return;
    const bot = this.bots.get(player.id)!;
    for (let i = 0; i < MAX_FINANCE_ACTIONS_PER_TURN; i++) {
      const choice = bot.chooseFinanceAction(this.getSnapshot(), player.id);
      if (choice === null) return;
      if (choice.action === "mortgage") {
        if (!this.canMortgage(player.id, choice.spaceIndex)) return;
        this.doMortgage(player, choice.spaceIndex);
      } else if (choice.action === "unmortgage") {
        if (!this.canUnmortgage(player.id, choice.spaceIndex)) return;
        if (player.cash < this.unmortgageCost(choice.spaceIndex)) return;
        this.doUnmortgage(player, choice.spaceIndex);
      } else {
        if (!this.trySellHouse(player, choice.spaceIndex)) return;
      }
    }
  }

  /**
   * Sells one house (or a hotel, reverting to 4 houses) back to the bank at half its build cost —
   * the only way to bring a property's improvement level down to 0, which mortgaging and trading
   * both require. Mirrors tryBuild: must sell from the group's most-developed propert(y/ies) first,
   * the reverse of even-building's "build the least-developed first."
   */
  private trySellHouse(player: PlayerState, spaceIndex: number): boolean {
    const space = BOARD[spaceIndex];
    if (space.type !== "property") return false;
    const record = this.state.ownership[spaceIndex];
    if (record.ownerId !== player.id) return false;
    if (record.houses === 0 && !record.hotel) return false;

    const groupIndices = GROUP_MEMBERS[space.group];
    const maxLevel = Math.max(...groupIndices.map((i) => this.improvementLevel(this.state.ownership[i])));
    if (this.improvementLevel(record) < maxLevel) return false;

    const saleValue = Math.floor(space.houseCost / 2);
    if (record.hotel) {
      if (this.state.housesRemaining < 4) return false; // not enough house pieces to revert to
      record.hotel = false;
      record.houses = 4;
      this.state.housesRemaining -= 4;
      this.state.hotelsRemaining += 1;
      this.logEvent(`${player.name} sells the hotel on ${space.name} for $${saleValue}.`, "BUILD");
    } else {
      record.houses -= 1;
      this.state.housesRemaining += 1;
      this.logEvent(`${player.name} sells a house on ${space.name} (${record.houses}/4) for $${saleValue}.`, "BUILD");
    }
    player.cash += saleValue;
    return true;
  }

  /** One trade proposal attempt per player per turn — no counter-offer negotiation. Logs the full
   * proposal the moment it's made (not just the outcome), and restates those same terms in the
   * decline line too (executeTrade already restates them on an accept) — the whole lifecycle of a
   * trade reads from the log alone, without cross-referencing an earlier line to know what was
   * actually on the table. */
  private runTradePhase(player: PlayerState) {
    if (player.bankrupt) return;
    const bot = this.bots.get(player.id)!;
    const offer = bot.proposeTrade(this.getSnapshot(), player.id);
    if (!offer || !this.isValidTradeOffer(player, offer)) return;

    const counterparty = this.state.players.find((p) => p.id === offer.toPlayerId);
    if (!counterparty || counterparty.bankrupt) return;

    const given = describeTradeSide(offer.offeredProperties, offer.offeredCash, offer.offeredGetOutOfJailFreeCards);
    const received = describeTradeSide(offer.requestedProperties, offer.requestedCash, offer.requestedGetOutOfJailFreeCards);
    this.logEvent(`${player.name} offers ${counterparty.name}: ${given} for ${received}.`, "TRADE");

    const counterpartyBot = this.bots.get(counterparty.id)!;
    if (!counterpartyBot.evaluateTrade(this.getSnapshot(), counterparty.id, offer)) {
      this.logEvent(`${counterparty.name} declines the offer (${given} for ${received}).`, "TRADE");
      return;
    }
    this.executeTrade(player, counterparty, offer);
  }

  /** Defensive validation against a bot proposing something illegal — silently ignored, not a crash. */
  private isValidTradeOffer(player: PlayerState, offer: TradeOffer): boolean {
    if (offer.fromPlayerId !== player.id || offer.toPlayerId === player.id) return false;
    const counterparty = this.state.players.find((p) => p.id === offer.toPlayerId);
    if (!counterparty || counterparty.bankrupt) return false;

    const isTradeable = (spaceIndex: number, ownerId: string) => {
      const space = BOARD[spaceIndex];
      if (!space || (space.type !== "property" && space.type !== "railroad" && space.type !== "utility")) return false;
      const record = this.state.ownership[spaceIndex];
      return record.ownerId === ownerId && record.houses === 0 && !record.hotel;
    };
    if (!offer.offeredProperties.every((i) => isTradeable(i, player.id))) return false;
    if (!offer.requestedProperties.every((i) => isTradeable(i, counterparty.id))) return false;

    if (offer.offeredCash < 0 || offer.offeredCash > player.cash) return false;
    if (offer.requestedCash < 0 || offer.requestedCash > counterparty.cash) return false;
    if (offer.offeredGetOutOfJailFreeCards < 0 || offer.offeredGetOutOfJailFreeCards > player.getOutOfJailFreeCards) return false;
    if (offer.requestedGetOutOfJailFreeCards < 0 || offer.requestedGetOutOfJailFreeCards > counterparty.getOutOfJailFreeCards) return false;

    for (const condition of offer.conditions) {
      const space = BOARD[condition.spaceIndex];
      if (!space || space.type !== "property") return false;
      const parties = [offer.fromPlayerId, offer.toPlayerId];
      if (!parties.includes(condition.ownerId) || !parties.includes(condition.protectedPlayerId)) return false;
      if (condition.ownerId === condition.protectedPlayerId) return false;
      if (condition.kind === "cap" && condition.capLevel === undefined) return false;
      if (condition.kind === "waive" && !(condition.usesRemaining && condition.usesRemaining >= 1)) return false;
    }
    return true;
  }

  private executeTrade(from: PlayerState, to: PlayerState, offer: TradeOffer) {
    for (const index of offer.offeredProperties) this.state.ownership[index].ownerId = to.id;
    for (const index of offer.requestedProperties) this.state.ownership[index].ownerId = from.id;

    from.cash += offer.requestedCash - offer.offeredCash;
    to.cash += offer.offeredCash - offer.requestedCash;
    from.getOutOfJailFreeCards += offer.requestedGetOutOfJailFreeCards - offer.offeredGetOutOfJailFreeCards;
    to.getOutOfJailFreeCards += offer.offeredGetOutOfJailFreeCards - offer.requestedGetOutOfJailFreeCards;
    for (let i = 0; i < offer.offeredGetOutOfJailFreeCards; i++) this.transferGoojfCard(from.id, to.id);
    for (let i = 0; i < offer.requestedGetOutOfJailFreeCards; i++) this.transferGoojfCard(to.id, from.id);

    this.state.tradeConditions.push(...offer.conditions);

    const given = describeTradeSide(offer.offeredProperties, offer.offeredCash, offer.offeredGetOutOfJailFreeCards);
    const received = describeTradeSide(offer.requestedProperties, offer.requestedCash, offer.requestedGetOutOfJailFreeCards);
    this.logEvent(`${to.name} accepts. ${from.name} trades ${given} to ${to.name} for ${received}.`, "TRADE");
    for (const condition of offer.conditions) {
      this.logEvent(`Trade condition: ${describeTradeCondition(condition, this.state.players)}.`, "TRADE");
    }

    // Checked once per distinct group touched (not per property) — a trade can move more than
    // one member of the same group at once, and re-checking an already-announced group per index
    // would log the same completion twice.
    for (const group of new Set(offer.offeredProperties.map((i) => (BOARD[i] as Ownable).group))) {
      this.checkMonopolyFormed(to, group);
    }
    for (const group of new Set(offer.requestedProperties.map((i) => (BOARD[i] as Ownable).group))) {
      this.checkMonopolyFormed(from, group);
    }
  }

  /** Logs a note the moment a player's holdings complete an entire group — all properties of one
   * color, all four railroads, or both utilities. */
  private checkMonopolyFormed(player: PlayerState, group: string) {
    const groupIndices = GROUP_MEMBERS[group];
    if (!groupIndices.every((i) => this.state.ownership[i].ownerId === player.id)) return;
    const label = group === "railroad" ? "all four railroads" : group === "utility" ? "both utilities" : `the ${group} monopoly`;
    this.logEvent(`${player.name} completes ${label}!`);
  }

  private handleBankruptcy(player: PlayerState, creditor: PlayerState | null) {
    this.logEvent(`${player.name} cannot pay and is bankrupt${creditor ? ` (owed to ${creditor.name})` : ""}.`);
    player.bankrupt = true;
    const groupsTransferred = new Set<string>();
    for (const [indexStr, record] of Object.entries(this.state.ownership)) {
      if (record.ownerId !== player.id) continue;
      const index = Number(indexStr);
      if (creditor) {
        record.ownerId = creditor.id;
        groupsTransferred.add((BOARD[index] as Ownable).group);
      } else {
        if (record.hotel) {
          this.state.hotelsRemaining += 1;
        }
        this.state.housesRemaining += record.houses;
        this.state.ownership[index] = { ownerId: null, houses: 0, hotel: false, mortgaged: false };
      }
    }
    if (creditor) {
      for (const group of groupsTransferred) this.checkMonopolyFormed(creditor, group);
    }
    // Real rule: cards bankrupt-to-a-player transfer with everything else; bankrupt-to-the-bank
    // returns them to the bottom of their deck, freeing them to be drawn again.
    for (let i = 0; i < player.getOutOfJailFreeCards; i++) {
      if (creditor) this.transferGoojfCard(player.id, creditor.id);
      else this.releaseGoojfCard(player.id);
    }
    if (creditor) creditor.getOutOfJailFreeCards += player.getOutOfJailFreeCards;
    player.getOutOfJailFreeCards = 0;
    player.cash = 0;
    this.checkForWinner();
  }

  private checkForWinner() {
    const active = this.activePlayers();
    if (active.length === 1) {
      this.state.winnerId = active[0].id;
      this.logEvent(`${active[0].name} wins the game!`);
    }
  }

  private runBuildPhase(player: PlayerState) {
    if (player.bankrupt) return;
    const bot = this.bots.get(player.id)!;
    for (let i = 0; i < MAX_BUILD_ACTIONS_PER_TURN; i++) {
      const choice = bot.chooseHouseToBuild(this.getSnapshot(), player.id);
      if (choice === null) return;
      if (!this.tryBuild(player, choice)) return;
    }
  }

  /** 0-4 houses, 5 = hotel — a single comparable scale for the even-building rule. */
  private improvementLevel(record: OwnershipRecord): number {
    return record.hotel ? 5 : record.houses;
  }

  private tryBuild(player: PlayerState, spaceIndex: number): boolean {
    const space = BOARD[spaceIndex];
    if (space.type !== "property") return false;
    const record = this.state.ownership[spaceIndex];
    if (record.ownerId !== player.id || record.mortgaged) return false;
    const groupIndices = GROUP_MEMBERS[space.group];
    const hasMonopoly = groupIndices.every((i) => this.state.ownership[i].ownerId === player.id);
    if (!hasMonopoly || record.hotel) return false;
    // A monopoly must be fully active to build on — any mortgaged sibling blocks the whole group.
    if (groupIndices.some((i) => this.state.ownership[i].mortgaged)) return false;
    // Even-building: only the least-developed propert(y/ies) in the group may be built on. This
    // also gives the "hotel requires every property at 4 houses" rule for free — a property at 4
    // only qualifies once every sibling has caught up to the shared minimum of 4.
    const minLevel = Math.min(...groupIndices.map((i) => this.improvementLevel(this.state.ownership[i])));
    if (this.improvementLevel(record) > minLevel) return false;

    if (record.houses < 4) {
      if (this.state.housesRemaining <= 0 || player.cash < space.houseCost) return false;
      record.houses += 1;
      this.state.housesRemaining -= 1;
      player.cash -= space.houseCost;
      this.logEvent(`${player.name} builds a house on ${space.name} (${record.houses}/4).`, "BUILD");
      return true;
    }
    if (this.state.hotelsRemaining <= 0 || player.cash < space.houseCost) return false;
    record.houses = 0;
    record.hotel = true;
    this.state.housesRemaining += 4;
    this.state.hotelsRemaining -= 1;
    player.cash -= space.houseCost;
    this.logEvent(`${player.name} builds a hotel on ${space.name}.`, "BUILD");
    return true;
  }
}
