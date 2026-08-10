# NEAT Monopoly strategy doctrine

A reference for future NEAT phases. This captures a full expert-strategy doctrine proposed while
scoping the "richer encoding / coaching / fair trades" phase — most of it is out of scope for that
phase's 17-input, buy/bid/build/trade-only architecture, and is preserved here for when the bot's
observation vector and decision coverage grow to match it (see `README.md`'s roadmap: async-aware
engine core, then a genuinely broader decision set).

**Applied now**: a small subset directly informed `neat/coaching.ts`'s seed weights within the
current 17-input encoding — see that file's comments for exactly which points and why.
**Deferred**: everything requiring inputs, outputs, or reference bots this phase doesn't build
(marked inline below where relevant).

## Design principle

Separate expert strategy from game rules. The rules engine determines legal actions; the strategy
layer supplies preferences, valuations, and situational guidance. Expert advice should mostly tell
NEAT *what information matters*, not *what move to make* — encode concepts (marginal ROI, monopoly
completion, blocking value, liquidity risk, housing scarcity, opponent exposure, positional threat)
as inputs, and let evolution decide how much each matters.

## The doctrine

1. **Cash is ammunition, not score.** A bot shouldn't maximize cash — it exists to survive bad
   landings and acquire/improve assets. Reserve should be a function of exposure (opponent rents,
   board position, mortgage capacity), not a fixed dollar floor. Candidate features: cash on hand,
   liquidatable/mortgageable equity, maximum opponent rent, expected rent exposure over the next
   6-12 spaces, distance to dangerous monopolies, bankruptcy probability before passing GO.

2. **Buy aggressively early.** Default rule: buy almost every unowned property landed on unless it
   creates serious near-term insolvency risk. Even mediocre properties provide rent, trade
   leverage, monopoly blocking, mortgage capacity, and auction value. Declining a property doesn't
   forfeit it if auctions are on — it just reframes the question as "what's it worth at auction?"

3. **Monopoly completion dominates raw property count**, nonlinearly: one property < a two-property
   blocking position << a completed monopoly. Suggested composition:
   `StrategicValue = IncomeValue + MonopolyCompletionValue + BlockingValue + TradeValue`.

4. **Orange/red are premium groups — encode the underlying reasons, not the conclusion.** Jail
   traffic makes them strong; give NEAT the landing-probability and rent-potential features and let
   it discover the conclusion, rather than an `isOrange` input that hands over the answer.

5. **Three houses is often the economic sweet spot** — rent frequently jumps more from 2→3 houses
   than the marginal cost justifies, more than 3→4→hotel does, especially while a second monopoly
   sits undeveloped. Needs marginal-rent-per-house-cost (`DevelopmentROI = ΔRent × LandingProbability
   / HouseCost`) and landing-probability features to let evolution discover the spread-before-hotels
   pattern itself, rather than hard-coding "stop at 3."

6. **The 32-house shortage is a weapon.** Converting four houses to a hotel returns the houses to
   the bank; sometimes *not* building the hotel denies opponents' undeveloped monopolies the houses
   they need. Needs: houses/hotels remaining in the bank, houses controlled per player, opponents'
   undeveloped monopolies, houses a hotel conversion would release. (Not encodable in the current
   17-input single-candidate view — this is a whole-board, cross-turn tactical read.)

7. **Jail's value flips over the game.** Early: get out and circulate while unowned property
   remains. Late: staying in jail while collecting rent and dodging developed opponent monopolies
   can be better. `JailValue = OpponentDevelopmentRisk − UnownedPropertyOpportunity`. Requires jail
   to be a NEAT-driven decision at all — currently `shouldPayToLeaveJail` is delegated to NaiveBot.

8. **Railroads are strong utility assets; utilities are weaker.** Railroads need no development
   capital, produce distributed income, scale well with accumulation, and trade well. Encode the
   underlying economics (acquisition cost, income scaling with count, trade leverage), not a
   hard-coded "utilities bad."

9. **Trade evaluation should optimize relative position, not raw asset value.**
   `TradeUtility = ΔMyPower − λ·ΔOpponentPower`, weighing who can build immediately, who has more
   cash, which monopoly is stronger, turn order, player positions, and existing monopoly counts. A
   sophisticated bot sometimes refuses an economically "fair" trade because it strengthens a
   dangerous opponent. (The current phase's `scoreTradeCandidate` is a simpler version of this —
   `myGain`/`counterpartyGain` via `scoreProperty`, no opponent-danger term yet.)

10. **Blocking ownership has real value beyond its rent stream** — the last property in an
    opponent's near-complete group is worth more to you than its own income, because holding it
    denies them the group. Needs per-opponent group-completion-target features across the whole
    board, not just the one candidate space in view.

11. **Mortgage selectively**, roughly: protect developed monopolies → protect monopoly potential →
    mortgage isolated low-value assets first. Borrowing against weak assets (e.g. mortgaging a
    cheap isolated property) to fund development on a strong monopoly can be excellent. Currently
    `raiseCash`/`chooseFinanceAction` are delegated to NaiveBot, not NEAT-driven.

12. **Don't overvalue Boardwalk/Park Place.** Expensive, only two properties, low landing frequency,
    high variance — humans overrate them; a bot doesn't have to. Potentially exploitable against
    human-biased trade partners once trading is richer.

13. **Position changes valuation.** Building right now matters more if an opponent is a few spaces
    from landing on the property than if everyone just passed it. Needs
    `distance(opponent → property)` and ideally `P(opponent lands before owner's next turn)` —
    genuinely richer positional awareness than the current single-candidate view supports.

14. **Opponents' cash changes optimal aggression.** The same rent increase that merely inconveniences
    a $2,000-cash opponent can bankrupt one holding $620. `KillPotential = PotentialRent /
    OpponentLiquidity` as one feature among several — the point is that bankruptcy thresholds matter
    more than incremental rent.

15. **Train toward win/loss, shaped for gradient.** Primary objective is winning, not net worth,
    cash, property count, or rent collected — those are intermediate signals. Suggested shape:
    `Fitness = 1000·Win + Survival + NetWorth + MonopolyPower + RentEfficiency − BankruptcyPenalty`,
    with auxiliary terms kept small enough that a bot can't maximize them at the expense of actually
    winning. (Close to what `train.ts`'s current `WIN_BONUS + netWorth` already does; the auxiliary
    terms here are more granular than today's.)

## Future reference-roster personalities

For a future self-play-adjacent or expanded fixed-roster training run — NEAT trained against a
diverse cast, not just one canonical opponent, avoiding overfitting to a single bot's blind spots:

| Personality | Character |
|---|---|
| Acquisition Shark | Buys everything, aggressively seeks monopolies |
| Orange Baron | Prioritizes high-probability groups, rapid 3-house development |
| Cash Turtle | Keeps large reserves, avoids risky trades |
| Housing Cartel | Exploits house shortages, avoids hotels |
| Deal Maker | Aggressive trading and monopoly swaps |
| Blocker | Values denying opponents monopolies |
| Railroad Mogul | Accumulates railroads, diversified holdings |
| Developer | Mortgages aggressively to fund houses |
| Late-Game Jailbird | Maximizes jail safety after development |
| Opportunist | Heavy positional awareness, targets opponent liquidity |

## Toward a future observation/action redesign

The natural end state of this doctrine is a much larger NEAT phase: a 75-150 input observation
vector (per-opponent, per-group, and positional features rather than one candidate space at a
time) and NEAT-driven outputs covering BUY / AUCTION / BUILD / SELL / MORTGAGE / UNMORTGAGE /
TRADE / JAIL — i.e. taking over the five decisions still delegated to NaiveBot today. That's a
substantially larger undertaking than an incremental encoding tweak (new inputs *and* new outputs,
likely no longer a single shared scalar-scoring function reused across decisions) and should get
its own scoped plan when picked up, not be folded into an in-flight smaller phase.
