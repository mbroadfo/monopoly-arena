import { BOARD, GROUP_MEMBERS } from "./board.js";
import { CHANCE_CARDS, COMMUNITY_CHEST_CARDS, type Card } from "./cards.js";
import { rollDice, type Rng } from "./dice.js";
import type { Bot, GameState, OwnershipRecord, PlayerState, PropertySpace } from "./types.js";

const STARTING_CASH = 1500;
const GO_SALARY = 200;
const JAIL_SPACE_INDEX = 10;
const GO_TO_JAIL_SPACE_INDEX = 30;
const MAX_JAIL_TURNS = 3;
const JAIL_FINE = 50;
const TOTAL_HOUSES = 32;
const TOTAL_HOTELS = 12;
const MAX_BUILD_ACTIONS_PER_TURN = 50;

interface Deck {
  cards: Card[];
  discard: Card[];
}

function draw(deck: Deck, rng: Rng): Card {
  if (deck.cards.length === 0) {
    deck.cards = shuffle(deck.discard, rng);
    deck.discard = [];
  }
  const card = deck.cards.shift()!;
  deck.discard.push(card);
  return card;
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export interface GameOptions {
  playerNames: string[];
  bots: Bot[];
  rng?: Rng;
}

export class Game {
  state: GameState;
  private bots: Map<string, Bot> = new Map();
  private rng: Rng;
  private chanceDeck: Deck;
  private communityChestDeck: Deck;

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
    };
  }

  getSnapshot(): GameState {
    return structuredClone(this.state);
  }

  isGameOver(): boolean {
    return this.state.winnerId !== null;
  }

  private log(message: string) {
    this.state.log.push(message);
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

    if (player.inJail) {
      this.handleJailTurn(player);
      if (player.bankrupt || this.isGameOver()) return;
    }

    let keepRolling = true;
    while (keepRolling && !player.bankrupt) {
      keepRolling = this.rollAndMove(player);
      if (this.isGameOver()) return;
    }

    this.runBuildPhase(player);
    this.checkForWinner();
    this.advanceToNextPlayer();
  }

  private handleJailTurn(player: PlayerState) {
    const bot = this.bots.get(player.id)!;
    if (player.getOutOfJailFreeCards > 0 && bot.shouldPayToLeaveJail(this.getSnapshot(), player.id)) {
      player.getOutOfJailFreeCards -= 1;
      player.inJail = false;
      player.jailTurns = 0;
      this.log(`${player.name} uses a Get Out of Jail Free card.`);
      return;
    }
    if (bot.shouldPayToLeaveJail(this.getSnapshot(), player.id) && player.cash >= JAIL_FINE) {
      player.cash -= JAIL_FINE;
      player.inJail = false;
      player.jailTurns = 0;
      this.log(`${player.name} pays $${JAIL_FINE} to leave jail.`);
      return;
    }
    const roll = rollDice(this.rng);
    this.log(`${player.name} (in jail) rolls ${roll.d1}+${roll.d2}.`);
    if (roll.isDouble) {
      player.inJail = false;
      player.jailTurns = 0;
      this.log(`${player.name} rolls doubles and leaves jail.`);
      this.movePlayer(player, roll.total);
      this.resolveSpace(player);
      return;
    }
    player.jailTurns += 1;
    if (player.jailTurns >= MAX_JAIL_TURNS) {
      if (player.cash >= JAIL_FINE) {
        player.cash -= JAIL_FINE;
      } else {
        this.handleBankruptcy(player, null);
        return;
      }
      player.inJail = false;
      player.jailTurns = 0;
      this.log(`${player.name} has served max jail time and pays $${JAIL_FINE}.`);
      this.movePlayer(player, roll.total);
      this.resolveSpace(player);
    } else {
      this.log(`${player.name} stays in jail (turn ${player.jailTurns}/${MAX_JAIL_TURNS}).`);
    }
  }

  /** Rolls, moves, and resolves the landing space. Returns true if the player rolled doubles and should go again. */
  private rollAndMove(player: PlayerState): boolean {
    const roll = rollDice(this.rng);
    this.log(`${player.name} rolls ${roll.d1}+${roll.d2} (${roll.total}).`);

    if (roll.isDouble) {
      this.state.doublesStreak += 1;
      if (this.state.doublesStreak === 3) {
        this.log(`${player.name} rolled doubles three times in a row and goes to jail.`);
        this.sendToJail(player);
        return false;
      }
    } else {
      this.state.doublesStreak = 0;
    }

    this.movePlayer(player, roll.total);
    this.resolveSpace(player);
    return roll.isDouble && !player.inJail;
  }

  private movePlayer(player: PlayerState, spaces: number) {
    const before = player.position;
    player.position = (player.position + spaces) % 40;
    if (player.position < before) {
      player.cash += GO_SALARY;
      this.log(`${player.name} passes GO and collects $${GO_SALARY}.`);
    }
  }

  private sendToJail(player: PlayerState) {
    player.position = JAIL_SPACE_INDEX;
    player.inJail = true;
    player.jailTurns = 0;
  }

  private resolveSpace(player: PlayerState) {
    const space = BOARD[player.position];
    this.log(`${player.name} lands on ${space.name}.`);

    switch (space.type) {
      case "go":
      case "jail":
      case "free-parking":
        return;
      case "go-to-jail":
        this.log(`${player.name} is sent to jail.`);
        this.sendToJail(player);
        return;
      case "tax":
        this.payBank(player, space.amount ?? 0, `${space.name}`);
        return;
      case "chance":
        this.applyCard(player, draw(this.chanceDeck, this.rng));
        return;
      case "community-chest":
        this.applyCard(player, draw(this.communityChestDeck, this.rng));
        return;
      case "property":
      case "railroad":
      case "utility":
        this.resolveOwnableSpace(player, space.index);
        return;
    }
  }

  private resolveOwnableSpace(player: PlayerState, spaceIndex: number) {
    const record = this.state.ownership[spaceIndex];
    const space = BOARD[spaceIndex] as PropertySpace | Extract<(typeof BOARD)[number], { type: "railroad" | "utility" }>;
    if (record.ownerId === null) {
      const bot = this.bots.get(player.id)!;
      const price = space.price;
      if (player.cash >= price && bot.shouldBuyProperty(this.getSnapshot(), player.id, spaceIndex)) {
        player.cash -= price;
        record.ownerId = player.id;
        this.log(`${player.name} buys ${space.name} for $${price}.`);
      } else {
        this.log(`${player.name} declines to buy ${space.name}.`);
      }
      return;
    }
    if (record.ownerId === player.id || record.mortgaged) return;

    const owner = this.state.players.find((p) => p.id === record.ownerId)!;
    const rent = this.calculateRent(space, record, owner);
    this.log(`${player.name} owes ${owner.name} $${rent} rent for ${space.name}.`);
    this.payPlayer(player, owner, rent);
  }

  private calculateRent(
    space: PropertySpace | Extract<(typeof BOARD)[number], { type: "railroad" | "utility" }>,
    record: OwnershipRecord,
    owner: PlayerState,
  ): number {
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
    if (record.hotel) return space.rent[5];
    if (record.houses > 0) return space.rent[record.houses];
    const hasMonopoly = GROUP_MEMBERS[space.group].every((i) => this.state.ownership[i].ownerId === owner.id);
    return hasMonopoly ? space.rent[0] * 2 : space.rent[0];
  }

  private applyCard(player: PlayerState, card: Card) {
    this.log(`${player.name} draws: "${card.text}"`);
    const effect = card.effect;
    switch (effect.kind) {
      case "advance-to": {
        const before = player.position;
        player.position = effect.spaceIndex;
        if (player.position < before || effect.spaceIndex === 0) {
          player.cash += GO_SALARY;
          this.log(`${player.name} passes GO and collects $${GO_SALARY}.`);
        }
        this.resolveSpace(player);
        return;
      }
      case "advance-spaces":
        this.movePlayer(player, effect.spaces);
        this.resolveSpace(player);
        return;
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
    if (player.cash < amount) {
      this.handleBankruptcy(player, null);
      return;
    }
    player.cash -= amount;
    this.log(`${player.name} pays $${amount} for ${reason}.`);
  }

  private payPlayer(payer: PlayerState, payee: PlayerState, amount: number) {
    if (amount <= 0) return;
    if (payer.cash < amount) {
      this.handleBankruptcy(payer, payee);
      return;
    }
    payer.cash -= amount;
    payee.cash += amount;
  }

  private handleBankruptcy(player: PlayerState, creditor: PlayerState | null) {
    this.log(`${player.name} cannot pay and is bankrupt${creditor ? ` (owed to ${creditor.name})` : ""}.`);
    player.bankrupt = true;
    for (const [indexStr, record] of Object.entries(this.state.ownership)) {
      if (record.ownerId !== player.id) continue;
      const index = Number(indexStr);
      if (creditor) {
        record.ownerId = creditor.id;
      } else {
        if (record.hotel) {
          this.state.hotelsRemaining += 1;
        }
        this.state.housesRemaining += record.houses;
        this.state.ownership[index] = { ownerId: null, houses: 0, hotel: false, mortgaged: false };
      }
    }
    player.cash = 0;
    this.checkForWinner();
  }

  private checkForWinner() {
    const active = this.activePlayers();
    if (active.length === 1) {
      this.state.winnerId = active[0].id;
      this.log(`${active[0].name} wins the game!`);
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

  private tryBuild(player: PlayerState, spaceIndex: number): boolean {
    const space = BOARD[spaceIndex];
    if (space.type !== "property") return false;
    const record = this.state.ownership[spaceIndex];
    if (record.ownerId !== player.id || record.mortgaged) return false;
    const hasMonopoly = GROUP_MEMBERS[space.group].every((i) => this.state.ownership[i].ownerId === player.id);
    if (!hasMonopoly || record.hotel) return false;

    if (record.houses < 4) {
      if (this.state.housesRemaining <= 0 || player.cash < space.houseCost) return false;
      record.houses += 1;
      this.state.housesRemaining -= 1;
      player.cash -= space.houseCost;
      this.log(`${player.name} builds a house on ${space.name} (${record.houses}/4).`);
      return true;
    }
    if (this.state.hotelsRemaining <= 0 || player.cash < space.houseCost) return false;
    record.houses = 0;
    record.hotel = true;
    this.state.housesRemaining += 4;
    this.state.hotelsRemaining -= 1;
    player.cash -= space.houseCost;
    this.log(`${player.name} builds a hotel on ${space.name}.`);
    return true;
  }
}
