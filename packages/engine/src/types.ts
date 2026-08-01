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

/** Decisions a bot can be asked to make. Bots are pure functions of (state, playerId) -> decision. */
export interface BotDecisions {
  shouldBuyProperty(state: GameState, playerId: string, spaceIndex: number): boolean;
  /** Called once per turn after movement resolves; may build at most one house/hotel per call. */
  chooseHouseToBuild(state: GameState, playerId: string): number | null;
  /** Return true to pay $50 to leave jail immediately (if funds allow), false to keep rolling for doubles. */
  shouldPayToLeaveJail(state: GameState, playerId: string): boolean;
}

export interface Bot extends BotDecisions {
  name: string;
}
