# Monopoly Arena

A Monopoly simulation engine and animated web UI for pitting AI bots against each other (or against you) to find the best strategies.

## Structure

- `packages/engine` — TypeScript rules engine (board, dice, cards, turns, houses/hotels, mortgages, auctions, trading, bankruptcy). Bots are plain objects implementing the `Bot` interface (`shouldBuyProperty`, `chooseHouseToBuild`, `shouldPayToLeaveJail`, `raiseCash`, `chooseFinanceAction`, `auctionBid`, `proposeTrade`, `evaluateTrade`), so the engine has no idea what's driving a player.
- `packages/web` — Vite + React app that renders the board as a DOM/CSS grid (tokens, houses/hotels, mortgages, ownership) with step/auto-play controls and a live bankroll panel + event log.

## Getting started

```bash
npm install
npm test          # run engine tests
npm run dev        # launch the web UI (http://localhost:5173)
```

## Current state

Implemented: full board, buying, auctions (when a player declines to buy), single-shot trading (properties/cash/Get Out of Jail Free cards, plus an optional rent waiver/cap condition on any property, tied to the trade's two counterparties), rent (properties/railroads/utilities), house/hotel building, mortgaging/unmortgaging (including automatic cash-raising to avoid bankruptcy), a representative subset of Chance/Community Chest cards, jail, doubles, bankruptcy (with property transfer to creditor), win detection. Four reference bots (`NaiveBot`, `RandomBot`, `OrangeRushBot`, `RailroadBaronBot`).

Not yet implemented (good next phases):

- Multi-round trade negotiation (counter-offers) — trading today is a single propose/accept-or-reject cycle
- Full 16-card Chance/Community Chest decks
- Even-building rule enforcement for houses
- Pluggable "bring your own bot" API (e.g. an HTTP/LLM-backed bot)
- Batch headless simulation mode + stats dashboard (win rate, avg game length, property value over time) for strategy comparison across thousands of games
