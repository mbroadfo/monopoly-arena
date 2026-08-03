export type CardEffect =
  | { kind: "advance-to"; spaceIndex: number }
  | { kind: "advance-spaces"; spaces: number }
  | { kind: "advance-to-nearest-railroad" }
  | { kind: "advance-to-nearest-utility" }
  | { kind: "go-back-spaces"; spaces: number }
  | { kind: "collect"; amount: number }
  | { kind: "pay"; amount: number }
  | { kind: "go-to-jail" }
  | { kind: "get-out-of-jail-free" }
  | { kind: "pay-each-player"; amount: number }
  | { kind: "collect-from-each-player"; amount: number }
  | { kind: "repairs"; perHouse: number; perHotel: number };

export interface Card {
  text: string;
  effect: CardEffect;
}

/** The real 16-card Chance deck. */
export const CHANCE_CARDS: Card[] = [
  { text: "Advance to GO (Collect $200)", effect: { kind: "advance-to", spaceIndex: 0 } },
  { text: "Advance to Boardwalk", effect: { kind: "advance-to", spaceIndex: 39 } },
  { text: "Advance to Illinois Avenue. If you pass GO, collect $200", effect: { kind: "advance-to", spaceIndex: 24 } },
  { text: "Advance to St. Charles Place. If you pass GO, collect $200", effect: { kind: "advance-to", spaceIndex: 11 } },
  {
    text: "Advance to the nearest Railroad. If unowned, you may buy it. If owned, pay owner twice the rental",
    effect: { kind: "advance-to-nearest-railroad" },
  },
  {
    text: "Advance to the nearest Railroad. If unowned, you may buy it. If owned, pay owner twice the rental",
    effect: { kind: "advance-to-nearest-railroad" },
  },
  {
    text: "Advance to the nearest Utility. If unowned, you may buy it. If owned, throw dice and pay owner 10 times the amount thrown",
    effect: { kind: "advance-to-nearest-utility" },
  },
  { text: "Bank pays you dividend of $50", effect: { kind: "collect", amount: 50 } },
  { text: "Get out of Jail Free", effect: { kind: "get-out-of-jail-free" } },
  { text: "Go back 3 spaces", effect: { kind: "go-back-spaces", spaces: 3 } },
  { text: "Go directly to Jail", effect: { kind: "go-to-jail" } },
  { text: "Make general repairs on all your property: $25 per house, $100 per hotel", effect: { kind: "repairs", perHouse: 25, perHotel: 100 } },
  { text: "Pay poor tax of $15", effect: { kind: "pay", amount: 15 } },
  { text: "Take a trip to Reading Railroad. If you pass GO, collect $200", effect: { kind: "advance-to", spaceIndex: 5 } },
  { text: "You have been elected Chairman of the Board. Pay each player $50", effect: { kind: "pay-each-player", amount: 50 } },
  { text: "Your building loan matures. Collect $150", effect: { kind: "collect", amount: 150 } },
];

/** The real 16-card Community Chest deck. */
export const COMMUNITY_CHEST_CARDS: Card[] = [
  { text: "Advance to GO (Collect $200)", effect: { kind: "advance-to", spaceIndex: 0 } },
  { text: "Bank error in your favor. Collect $200", effect: { kind: "collect", amount: 200 } },
  { text: "Doctor's fee. Pay $50", effect: { kind: "pay", amount: 50 } },
  { text: "From sale of stock you get $50", effect: { kind: "collect", amount: 50 } },
  { text: "Get out of Jail Free", effect: { kind: "get-out-of-jail-free" } },
  { text: "Go directly to Jail", effect: { kind: "go-to-jail" } },
  { text: "Grand Opera Night. Collect $50 from every player for opening night seats", effect: { kind: "collect-from-each-player", amount: 50 } },
  { text: "Holiday fund matures. Receive $100", effect: { kind: "collect", amount: 100 } },
  { text: "Income tax refund. Collect $20", effect: { kind: "collect", amount: 20 } },
  { text: "It is your birthday. Collect $10 from every player", effect: { kind: "collect-from-each-player", amount: 10 } },
  { text: "Life insurance matures. Collect $100", effect: { kind: "collect", amount: 100 } },
  { text: "Pay hospital fees of $100", effect: { kind: "pay", amount: 100 } },
  { text: "Pay school fees of $50", effect: { kind: "pay", amount: 50 } },
  { text: "Receive $25 consultancy fee", effect: { kind: "collect", amount: 25 } },
  { text: "You are assessed for street repairs: $40 per house, $115 per hotel", effect: { kind: "repairs", perHouse: 40, perHotel: 115 } },
  { text: "You have won second prize in a beauty contest. Collect $10", effect: { kind: "collect", amount: 10 } },
];
