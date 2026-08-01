export type CardEffect =
  | { kind: "advance-to"; spaceIndex: number }
  | { kind: "advance-spaces"; spaces: number }
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

/** Representative subset of the real card decks (not the full 16-card sets). */
export const CHANCE_CARDS: Card[] = [
  { text: "Advance to GO (Collect $200)", effect: { kind: "advance-to", spaceIndex: 0 } },
  { text: "Advance to Boardwalk", effect: { kind: "advance-to", spaceIndex: 39 } },
  { text: "Advance to Illinois Avenue", effect: { kind: "advance-to", spaceIndex: 24 } },
  { text: "Bank pays you dividend of $50", effect: { kind: "collect", amount: 50 } },
  { text: "Get out of Jail Free", effect: { kind: "get-out-of-jail-free" } },
  { text: "Go directly to Jail", effect: { kind: "go-to-jail" } },
  { text: "Make general repairs: $25 per house, $100 per hotel", effect: { kind: "repairs", perHouse: 25, perHotel: 100 } },
  { text: "Pay poor tax of $15", effect: { kind: "pay", amount: 15 } },
  { text: "You have been elected Chairman of the Board. Pay each player $50", effect: { kind: "pay-each-player", amount: 50 } },
  { text: "Your building loan matures. Collect $150", effect: { kind: "collect", amount: 150 } },
];

export const COMMUNITY_CHEST_CARDS: Card[] = [
  { text: "Advance to GO (Collect $200)", effect: { kind: "advance-to", spaceIndex: 0 } },
  { text: "Bank error in your favor. Collect $200", effect: { kind: "collect", amount: 200 } },
  { text: "Doctor's fee. Pay $50", effect: { kind: "pay", amount: 50 } },
  { text: "From sale of stock you get $45", effect: { kind: "collect", amount: 45 } },
  { text: "Get out of Jail Free", effect: { kind: "get-out-of-jail-free" } },
  { text: "Go directly to Jail", effect: { kind: "go-to-jail" } },
  { text: "Holiday fund matures. Receive $100", effect: { kind: "collect", amount: 100 } },
  { text: "Income tax refund. Collect $20", effect: { kind: "collect", amount: 20 } },
  { text: "It is your birthday. Collect $10 from every player", effect: { kind: "collect-from-each-player", amount: 10 } },
  { text: "Pay hospital fees of $100", effect: { kind: "pay", amount: 100 } },
];
