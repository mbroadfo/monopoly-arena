export type SpaceType =
  | "go"
  | "property"
  | "railroad"
  | "utility"
  | "tax"
  | "chance"
  | "community-chest"
  | "jail"
  | "go-to-jail"
  | "free-parking";

export type ColorGroup =
  | "brown"
  | "lightblue"
  | "pink"
  | "orange"
  | "red"
  | "yellow"
  | "green"
  | "darkblue"
  | "railroad"
  | "utility";

export interface PropertySpace {
  index: number;
  type: "property";
  name: string;
  group: ColorGroup;
  price: number;
  rent: [number, number, number, number, number, number]; // base, 1-4 houses, hotel
  houseCost: number;
}

export interface RailroadSpace {
  index: number;
  type: "railroad";
  name: string;
  group: "railroad";
  price: number;
}

export interface UtilitySpace {
  index: number;
  type: "utility";
  name: string;
  group: "utility";
  price: number;
}

export interface PlainSpace {
  index: number;
  type: "go" | "tax" | "chance" | "community-chest" | "jail" | "go-to-jail" | "free-parking";
  name: string;
  amount?: number; // for tax spaces
}

export type Space = PropertySpace | RailroadSpace | UtilitySpace | PlainSpace;

export type Ownable = PropertySpace | RailroadSpace | UtilitySpace;

export interface OwnershipRecord {
  ownerId: string | null;
  houses: number; // 0-4
  hotel: boolean;
  mortgaged: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  cash: number;
  position: number;
  inJail: boolean;
  jailTurns: number;
  bankrupt: boolean;
  getOutOfJailFreeCards: number;
}

export interface GameState {
  turn: number;
  spaces: Space[];
  ownership: Record<number, OwnershipRecord>;
  players: PlayerState[];
  currentPlayerIndex: number;
  housesRemaining: number;
  hotelsRemaining: number;
  log: string[];
  winnerId: string | null;
  doublesStreak: number;
  tradeConditions: TradeCondition[];
  moves: MoveEvent[];
}

/**
 * One movement within the current turn, in order — a turn can produce several (a doubles
 * chain, or a dice roll followed by a card that moves the player again). Reset at the start
 * of each `playTurn()` call so it only ever reflects the turn just played; lets the UI animate
 * each movement distinctly (e.g. a pause between "rolled onto Community Chest" and "card sent
 * to jail") instead of only seeing the final resting position.
 */
export interface MoveEvent {
  playerId: string;
  from: number;
  to: number;
  /** "walk" = animate stepping tile-by-tile; "teleport" = direct jump (jail). */
  type: "walk" | "teleport";
  /** Meaningless for "teleport". */
  direction: "forward" | "backward";
  /**
   * Ownership as it stood immediately after this move's landing was fully resolved (buy/auction/
   * rent/card effects) — lets the web layer patch ownership-driven visuals (property outlines,
   * monopoly badges, house/hotel markers) in step with a turn's animation instead of only once
   * the whole turn finishes.
   */
  ownershipAfter: GameState["ownership"];
}

export interface DiceRoll {
  d1: number;
  d2: number;
  total: number;
  isDouble: boolean;
}

export type FinanceAction = { action: "mortgage" | "unmortgage" | "sell-house"; spaceIndex: number };

/**
 * A rent side-agreement attached to a trade, tied to the two players who made the deal —
 * not an official Monopoly rule, but not disallowed either. Only applies to `type: "property"`
 * spaces (railroads/utilities aren't tiered by improvement level the same way). Stays active
 * only while `ownerId` still holds the property; if it's traded again to someone else, the
 * entry simply stops matching rather than being actively cleaned up.
 */
export interface TradeCondition {
  spaceIndex: number;
  ownerId: string;
  protectedPlayerId: string;
  kind: "waive" | "cap";
  /** Index into space.rent (0 = base, 1-4 = houses, 5 = hotel). Required for "cap". */
  capLevel?: 0 | 1 | 2 | 3 | 4 | 5;
  /** Free passes remaining, decremented on each use. Required for "waive". */
  usesRemaining?: number;
}

export interface TradeOffer {
  fromPlayerId: string;
  toPlayerId: string;
  offeredProperties: number[];
  offeredCash: number;
  offeredGetOutOfJailFreeCards: number;
  requestedProperties: number[];
  requestedCash: number;
  requestedGetOutOfJailFreeCards: number;
  conditions: TradeCondition[];
}

/** Decisions a bot can be asked to make. Bots are pure functions of (state, playerId) -> decision. */
export interface BotDecisions {
  shouldBuyProperty(state: GameState, playerId: string, spaceIndex: number): boolean;
  /** Called once per turn after movement resolves; may build at most one house/hotel per call. */
  chooseHouseToBuild(state: GameState, playerId: string): number | null;
  /** Return true to pay $50 to leave jail immediately (if funds allow), false to keep rolling for doubles. */
  shouldPayToLeaveJail(state: GameState, playerId: string): boolean;
  /**
   * Called when a debt can't be covered by cash on hand, with the shortfall still owed.
   * Return the index of an owned, unmortgaged, house-free property to mortgage, or null
   * to give up (triggering bankruptcy). Called repeatedly until the shortfall is covered.
   */
  raiseCash(state: GameState, playerId: string, amountNeeded: number): number | null;
  /**
   * Called once per turn after building; may mortgage, unmortgage, or sell one house/hotel back
   * to the bank per call. A property must have its houses/hotel sold off (down to 0) before it
   * can be mortgaged or traded — selling from the same turn's earlier call is fair game, since
   * this is called repeatedly.
   */
  chooseFinanceAction(state: GameState, playerId: string): FinanceAction | null;
  /**
   * Called during an auction (triggered when a player declines to buy a property they land on).
   * Return a bid strictly greater than currentBid to stay in, or null to pass. Called repeatedly,
   * round-robin among still-active bidders, until only one remains or everyone has passed.
   */
  auctionBid(state: GameState, playerId: string, spaceIndex: number, currentBid: number, highBidderId: string | null): number | null;
  /** Called once per turn; return a trade to propose to another player, or null to skip. */
  proposeTrade(state: GameState, playerId: string): TradeOffer | null;
  /** Called on the other player's bot when this player is offered a trade. */
  evaluateTrade(state: GameState, playerId: string, offer: TradeOffer): boolean;
}

export interface Bot extends BotDecisions {
  name: string;
}
