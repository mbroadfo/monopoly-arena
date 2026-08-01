# Monopoly Arena

A Monopoly simulation engine and animated web UI for pitting AI bots against each other (or against you) to find the best strategies.

## Structure

- `packages/engine` — TypeScript rules engine (board, dice, cards, turns, houses/hotels, bankruptcy). Bots are plain objects implementing the `Bot` interface (`shouldBuyProperty`, `chooseHouseToBuild`, `shouldPayToLeaveJail`), so the engine has no idea what's driving a player.
- `packages/web` — Vite + React app that renders the board on Canvas (tokens, houses/hotels, ownership) with step/auto-play controls and a live bankroll panel + event log.

## Getting started

```bash
npm install
npm test          # run engine tests
npm run dev        # launch the web UI (http://localhost:5173)
```

## Current state

Implemented: full board, buying, rent (properties/railroads/utilities), house/hotel building, a representative subset of Chance/Community Chest cards, jail, doubles, bankruptcy (with property transfer to creditor), win detection. Two reference bots (`NaiveBot`, `RandomBot`).

Not yet implemented (good next phases):
- Trading/negotiation between players
- Mortgaging properties
- Auctions when a player declines to buy
- Full 16-card Chance/Community Chest decks
- Even-building rule enforcement for houses
- Pluggable "bring your own bot" API (e.g. an HTTP/LLM-backed bot)
- Batch headless simulation mode + stats dashboard (win rate, avg game length, property value over time) for strategy comparison across thousands of games
