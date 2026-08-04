# Monopoly Arena

A Monopoly simulation engine and animated web UI for pitting AI bots against each other (or against you) to find the best strategies.

## Structure

- `packages/engine` — TypeScript rules engine (board, dice, cards, turns, houses/hotels, mortgages, auctions, trading, bankruptcy). Bots are plain objects implementing the `Bot` interface (`shouldBuyProperty`, `chooseHouseToBuild`, `shouldPayToLeaveJail`, `raiseCash`, `chooseFinanceAction`, `auctionBid`, `proposeTrade`, `evaluateTrade`), so the engine has no idea what's driving a player.
- `packages/web` — Vite + React app that renders the board as a DOM/CSS grid (tokens, houses/hotels, mortgages, ownership) with step/auto-play controls, a live bankroll panel + event log, and a scrubbable timeline under the bankroll chart — drag to any past turn or step one turn at a time (with the same movement replay as live play), all built on a full per-turn state history so nothing needs to be replayed from scratch. Player tokens are classic-piece icons (top hat, car, dog, boot, ship, cat) that animate around the board turn by turn, with a pause between distinct movements within a turn (e.g. a dice roll followed by a card that sends the player to jail); animation speed scales with the speed slider and switches off in favor of instant movement once the slider is fast enough that animating would hold the simulation back. A pulsing badge — the owning player's own icon and color — marks a completed color-group monopoly in the properties panel at a glance, and the same icon/color pairing carries through to the player list on the right.

## Getting started

```bash
npm install
npm test          # run engine tests
npm run dev        # launch the web UI (http://localhost:5173)
```

## Current state

Implemented: full board, dice-roll-determined starting turn order (ties re-roll among just the tied players), buying, auctions (when a player declines to buy), single-shot trading (properties/cash/Get Out of Jail Free cards, plus an optional rent waiver/cap condition on any property, tied to the trade's two counterparties), rent (properties/railroads/utilities), house/hotel building with even-building enforcement (and selling houses/hotels back to the bank — required before a property can be mortgaged or traded), mortgaging/unmortgaging (including automatic cash-raising to avoid bankruptcy), the full 16-card Chance and Community Chest decks, jail, doubles, bankruptcy (with property transfer to creditor), win detection. Four reference bots (`NaiveBot`, `RandomBot`, `OrangeRushBot`, `RailroadBaronBot`).

Not yet implemented (good next phases):

- Multi-round trade negotiation (counter-offers) — trading today is a single propose/accept-or-reject cycle
- Pluggable "bring your own bot" API (e.g. an HTTP/LLM-backed bot)
- Batch headless simulation mode + stats dashboard (win rate, avg game length, property value over time) for strategy comparison across thousands of games
