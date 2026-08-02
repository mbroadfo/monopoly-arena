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
}

export interface DiceRoll {
  d1: number;
  d2: number;
  total: number;
  isDouble: boolean;
}

export type FinanceAction = { action: "mortgage" | "unmortgage"; spaceIndex: number };

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
  /** Called once per turn after building; may mortgage or unmortgage at most one property per call. */
  chooseFinanceAction(state: GameState, playerId: string): FinanceAction | null;
  /**
   * Called during an auction (triggered when a player declines to buy a property they land on).
   * Return a bid strictly greater than currentBid to stay in, or null to pass. Called repeatedly,
   * round-robin among still-active bidders, until only one remains or everyone has passed.
   */
  auctionBid(state: GameState, playerId: string, spaceIndex: number, currentBid: number, highBidderId: string | null): number | null;
}

export interface Bot extends BotDecisions {
  name: string;
}
