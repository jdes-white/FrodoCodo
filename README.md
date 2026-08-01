# Saturday Race Screener

Manual, on-demand script. Run it Saturday morning, get back a ranked
shortlist of which race/track fits which of the three saved strategies.
No scheduler, no live promo-checking — that's fixed logic already, and
placement stays manual.

## What's tested vs not

- **`scoring.py`** — the actual strategy math — is tested. Run
  `python test_scoring.py` and it reproduces the exact numbers worked out
  by hand against today's four screenshotted races. Trust this part.
- **`betfair_auth.py`** and **`betfair_client.py`** — written to Betfair's
  documented API shape, but this sandbox has no network access to
  Betfair's servers, so neither has been run against a live account.
  First run on your machine is effectively the first real test of these
  two files. The most likely thing to need adjusting is the race-number
  regex in `betfair_client.py` (`_race_number`), once you can see what
  Betfair's actual AU racing event names look like.

## Setup

1. **Get a Betfair Delayed App Key** (free, personal use):
   - Log in at betfair.com.au, go to the Betfair Developer Account Demo Tool.
   - Run `createDeveloperAppKeys` — this gives you a Delayed key immediately.
     You don't need the Live key; this script only reads prices.
2. **Set credentials as environment variables** — never hardcode them:
   ```bash
   export BETFAIR_USERNAME="your_username"
   export BETFAIR_PASSWORD="your_password"
   export BETFAIR_APP_KEY="your_delayed_app_key"
   ```
3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```
4. **Run it:**
   ```bash
   python main.py
   # or, on a non-standard Saturday:
   python main.py --tracks "Eagle Farm,Morphettville"
   ```

## Reading the output

Higher is better on all three columns. They're not directly comparable
to each other (different formulas, different scales) — use each column
to rank races within its own strategy, not across strategies.

| Column | Strategy | What it measures |
|---|---|---|
| Neds | Neds Backup | Favourite reliability x gap-to-third |
| TABtouch | Money Back Run 2nd | Gap-to-third only |
| Stack | SB/TAB Top 3 stacking | Combined top-two dominance vs 3rd+4th |

## Known gaps / next steps if this proves useful

- Scores are structural (how reliably the safety net fires), not a fully
  monetised dollar EV — that would need stake caps and the cash-vs-bonus-bet
  conversion factor per bookie added on top.
- Assumes at least 4 runners have live back prices; scratchings close to
  the jump could shrink a field below that late.
- Race-number parsing needs a first live check — see above.
