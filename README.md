# Monopoly Arena

A Monopoly simulation engine and animated web UI for pitting AI bots against each other (or against you) to find the best strategies.

## Structure

- `packages/engine` — TypeScript rules engine (board, dice, cards, turns, houses/hotels, mortgages, auctions, trading, bankruptcy). Bots are plain objects implementing the `Bot` interface (`shouldBuyProperty`, `chooseHouseToBuild`, `shouldPayToLeaveJail`, `raiseCash`, `chooseFinanceAction`, `auctionBid`, `proposeTrade`, `evaluateTrade`), so the engine has no idea what's driving a player.
- `packages/web` — Vite + React app that renders the board as a DOM/CSS grid (tokens, houses/hotels, mortgages, ownership) with step/auto-play controls, a live bankroll panel + event log, and a scrubbable timeline under the bankroll chart — drag to any past turn or step one turn at a time (with the same movement replay as live play), all built on a full per-turn state history so nothing needs to be replayed from scratch. Player tokens are classic-piece icons (top hat, car, dog, boot, ship, cat) that animate around the board turn by turn, with a pause between distinct movements within a turn (e.g. a dice roll followed by a card that sends the player to jail); animation speed scales with the speed slider and switches off in favor of instant movement once the slider is fast enough that animating would hold the simulation back. A pulsing badge — the owning player's own icon and color — marks a completed color-group monopoly in the properties panel at a glance, and the same icon/color pairing carries through to the player list on the right.

## Architecture

An npm workspaces monorepo with two packages: a rules engine with no UI dependencies, and a web
app that's purely a renderer/driver for it. The engine never imports anything from `packages/web`.

### `packages/engine`

The engine is a single mutable `Game` class (`game.ts`) plus a handful of pure data/helper
modules it operates on:

- **`types.ts`** — the shape of everything: `GameState` (the one object that holds all mutable
  game data — `players`, `ownership`, `spaces`, `log`, `turn`, etc.), `PlayerState`,
  `OwnershipRecord`, the `Space` union (`PropertySpace` / `RailroadSpace` / `UtilitySpace` /
  `PlainSpace`), `TradeOffer`/`TradeCondition`, and `MoveEvent` (see below). Also defines the
  `Bot`/`BotDecisions` interface — the entire surface a bot can act through.
- **`board.ts`** — the static 40-space board layout (`BOARD`) and `GROUP_MEMBERS` (space indices
  grouped by color/railroad/utility, derived from `BOARD` once at module load — nothing else
  hand-maintains a second copy of "which spaces are in the orange group").
- **`cards.ts`** — the real 16-card Chance and Community Chest decks and the `CardEffect` union
  they resolve into (`advance-to`, `advance-to-nearest-railroad/utility`, `go-back-spaces`,
  `pay-each-player`, `repairs`, etc.).
- **`dice.ts`** — `rollDice(rng)`; the engine never calls `Math.random()` directly. Every random
  decision — dice, shuffling, auto-determined turn order — goes through an injectable `Rng`
  (`() => number`), which is how the test suite gets fully deterministic games (seeded
  `mulberry32`, or a fixed alternating sequence for tests that need every roll to be identical).
- **`bots/`** — four reference bots (`naive`, `random`, `orangeRush`, `railroadBaron`) plus
  `shared.ts` (mortgage-candidate ranking, monopoly-completion-trade detection, etc.) that they
  draw on. Bots are **pure functions of `(state, playerId) → decision`** — each of the 8
  `BotDecisions` methods (`shouldBuyProperty`, `chooseHouseToBuild`, `raiseCash`, `auctionBid`,
  `proposeTrade`, `evaluateTrade`, ...) is called with a snapshot and returns a plain value. A bot
  cannot mutate game state, hold a reference to the `Game`, or see any other player's private
  info beyond what `GameState` already exposes — so a bot can be as simple as an object literal.

**Turn flow** (`Game.playTurn()`): jail handling (pay fine / use card / roll for doubles / stay
put) → a roll-and-move loop that keeps going through doubles chains (capped at 3 in a row before
jail) → trade phase (one propose/accept-or-reject per turn) → build phase → mortgage/unmortgage/
sell-house finance phase → win check → advance to the next non-bankrupt player. Every mutation
(`buy`, `payPlayer`, `sendToJail`, `applyCard`, ...) is a private method on `Game` that mutates
`this.state` directly and appends a human-readable line to `state.log`; `getSnapshot()` returns a
`structuredClone` of that state, so external callers (bots, the web layer, tests) only ever see
an immutable copy and can't accidentally corrupt the live game.

**Move tracking**: every call to `movePlayer`/`sendToJail`/the movement-card effects pushes a
`MoveEvent` (`{ playerId, from, to, type: "walk" | "teleport", direction }`) onto
`state.moves`, reset at the start of each `playTurn()`. This exists purely so the web layer can
animate a turn's actual movement (including multi-step doubles chains or a dice roll followed by
a card that sends the player to jail) instead of only ever seeing the final resting position —
the engine itself never reads `state.moves` back.

### `packages/web`

A Vite + React app (`main.tsx` → `App.tsx`) that treats the engine as a black box: it holds one
`Game` instance in a ref and never reaches into its private methods.

- **`useGame.ts`** — the state-management core. Wraps a `Game` in a `useRef` and exposes a
  `state: GameState` for every component to render from, plus playback controls (`step`,
  `reset`, `playing`/`setPlaying`, `speedMs`). Three things live here that aren't just "call the
  engine and re-render":
  - **History for the timeline**: rather than storing a full `GameState` snapshot per turn (which
    would duplicate the ever-growing `log` array in every single one — O(turns²) memory over a
    long game), it stores a lightweight `TurnRecord` per turn (everything except `spaces`, a
    constant, and `log`, replaced by `logLength`) and reconstructs any past turn's display state
    by slicing the *current* log up to that length — safe because the engine's log is
    append-only. `scrubTurn`/`isLive`/`scrubTo`/`stepTurn` (consumed by `Timeline.tsx`) are built
    on top of this.
  - **Movement animation**: `animateTurn()` replays a turn's `MoveEvent`s against the pre-turn
    snapshot — hopping tile-by-tile for a `"walk"`, fading out/in for a `"teleport"` — via a
    `displayOverride` state that the rendered `state` prefers over the live snapshot while an
    animation is in flight. Timings scale with the speed slider and animation can be disabled
    entirely (a checkbox strips both the JS-side stepping *and* the token's CSS position
    transition, so a disabled toggle is really instant, not just faster).
  - **Bot roster**: `BOT_CHOICES` + `newGame()` construct a fresh `Game` from four selected bots;
    changing a lineup selector or hitting Reset just swaps in a new `Game` instance.
- **`Board.tsx`** — renders the 40 spaces on an 11×11 CSS grid (`boardLayout.ts`'s
  `spaceToGrid`/`EDGE_DEPTH_RATIO` math handles the corner tracks being wider than the 9 inner
  ones). A handful of small `edge*` functions (`edgeFlexDirection`, `edgeContentRotation`,
  `edgeTextStyle`) are the single source of truth for "which way does content on this side of the
  board face" — every tile's icon, price, and house/hotel markers derive from the same one
  rotation value rather than each having its own per-edge special case. Player tokens are an
  absolutely-positioned overlay layer (not children of their tile, so they can move and animate
  independently), positioned by `spaceToPercent`; the Jail tile is a special case
  (`jailZoneAnchor`) with two sub-positions — the inset cell for imprisoned tokens, the outer
  "Just Visiting" strip for everyone else landing there or passing through.
- **`boardLayout.ts`** — shared layout math (`spaceToGrid`, `spaceToPercent`, `spaceBounds`),
  the color palettes (`GROUP_COLORS`, `PLAYER_COLORS`), and `TOKEN_ICONS` — the same
  icon-per-player-index used for board tokens, the monopoly badge, and the player panel, so a
  given player reads identically everywhere.
- **Other components** are each a thin, mostly-presentational view over the same `state`:
  `PlayerPanel` (compact scoreboard, with `countOwnedProperties`/`countMonopolies`/
  `countHouseEquivalents` derived locally from `state.ownership` — no new engine state needed for
  any of it), `PropertiesPanel` (deed rack grouped by color, monopoly badges), `BankrollChart`
  (hand-rolled SVG line chart, no charting library), `Timeline` (the scrub slider), `LineupPicker`
  (bot-selection dropdowns, shown only before the first turn), `LogFeed` (tailing view over
  `state.log`).

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
