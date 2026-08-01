# Handoff: Saturday Race Screener

Read this first. It carries the context that a plain code-and-chat handoff
would lose — the reasoning behind each decision, not just the decisions.

## How to use this file

Open this folder in Claude Code and start with something like: "Read
HANDOFF.md, then run main.py against real Betfair credentials and fix
whatever breaks." Everything settled below doesn't need re-deriving —
only the open items at the bottom are still live questions.

## Goal

Manual, on-demand script, run by hand each Saturday morning. Pulls horse
racing win-market odds for the day's metro meetings, scores every race
(1-6) against three specific promotional betting strategies, prints a
ranked shortlist. It does not place bets or check live promo
availability — both stay manual, on purpose.

## The three strategies being screened for

**Neds Backup** — back the 2nd favourite to win, nominate the favourite
as "Backup." Refund fires only if the favourite wins AND the pick
specifically fills 2nd. Basis: favourite reliability (how short/dominant)
x gap-to-third — both factors have to be strong, multiplied together so
weakness in either drags the score down.

**TABtouch Money Back Run 2nd** — pays on any 2nd-place finish
regardless of who wins. Favourite reliability is irrelevant here. Basis:
gap-to-third only.

**SB/TAB Top 3 stacking** — fav and 2nd fav backed as separate legs, one
on each bookie, each independently insured down to 3rd. Total loss needs
two OTHER runners to beat both legs combined. Basis: combined dominance
of the top two over the field, gap needs to hold through both 3rd AND
4th (not just 3rd), since it takes two outsiders to shut out both legs.

Formulas are in `scoring.py`, run on implied probability (`1 / decimal
odds`) of the top four market runners. `test_scoring.py` reproduces the
exact numbers worked out by hand against a real race day — that's the
source of truth if anything looks off later.

## Settled decisions — don't relitigate these

- **Data source: Betfair Exchange API, Delayed App Key (free).** Not
  scraping — TAB has no public developer API, and scraping bookie sites
  carries real account risk (TABtouch is known to pull promo access from
  detected "smarties," Neds has tightened rules before). Betfair's
  win market is used as a structural proxy for market consensus, not as
  the literal TAB price board.
- **Manual, on-demand only.** No scheduler, no n8n, no automation beyond
  "run the script." This is a once-a-week Saturday habit, not a daemon.
- **Tracks:** Randwick, Rosehill, Flemington, Caulfield — the four that
  rotate through Saturday metro racing. Script checks all four every
  run; whichever aren't racing that week get skipped silently, no error.
  `--tracks` flag overrides this for carnival weeks / non-standard cards.
- **Races 1-6 only** — where these promos generally apply.
- **Console-printed ranked list** is the output format for now.
- **Scores are structural, not full dollar EV.** Deliberate scope
  decision — a true EV would need stake caps and the cash-vs-bonus-bet
  conversion factor per bookie. Fine to add later, not now.

## Current state of the code

- `scoring.py` — done, tested, trustworthy.
- `betfair_auth.py` / `betfair_client.py` — written to Betfair's
  documented API shape but never run against a live account (no network
  access existed to test them). Treat the first real run as the actual
  test of these two files, not the rest of the project.
- `main.py` — orchestrator, straightforward, ties the above together.

## Immediate next step

Run `main.py` with real Betfair credentials (see README.md for the App
Key setup) and fix whatever breaks in the Betfair integration layer. The
most likely failure point is `_race_number()` in `betfair_client.py` —
it assumes Betfair's AU racing event names contain something like "R4",
which hasn't been confirmed against a live payload.

**Do not change `scoring.py`'s formulas without checking in on the
reasoning first** — that logic is the actual strategy, already
validated against known numbers, and isn't something to "fix" based on
a guess about what looks right.

## Not yet requested — don't build unprompted

- Full dollar EV (stake caps, bonus-bet conversion factors per bookie).
- Handling late scratchings shrinking a field below 4 priced runners.
- Any output format beyond console printing.
