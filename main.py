"""Saturday morning race screener.

Run manually each Saturday morning. Pulls win-market odds for races 1-6
at whichever of the four rotating tracks are actually racing today, scores
every race against the three saved strategies, and prints a ranked
shortlist. Placement stays manual — this only tells you where to look.

Usage:
    python main.py
    python main.py --tracks "Eagle Farm,Morphettville"   # override the default four
"""
import argparse
import os

from betfair_auth import get_session_token
from betfair_client import get_prices, get_races_for_track
from config import DEFAULT_TRACKS
from scoring import score_race


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--tracks",
        help="Comma-separated override, e.g. 'Eagle Farm,Morphettville'",
    )
    args = parser.parse_args()

    tracks = args.tracks.split(",") if args.tracks else DEFAULT_TRACKS
    app_key = os.environ.get("BETFAIR_APP_KEY")
    session_token = get_session_token()

    results = []
    for track in tracks:
        races = get_races_for_track(session_token, app_key, track)
        if not races:
            continue  # not racing today — skip silently, no error

        for race in races:
            runners = get_prices(session_token, app_key, race["marketId"])
            odds = sorted(
                r["ex"]["availableToBack"][0]["price"]
                for r in runners
                if r.get("ex", {}).get("availableToBack")
            )
            scores = score_race(odds)
            if scores is None:
                continue  # fewer than 4 runners with live prices

            results.append({
                "track": track,
                "race": race.get("event", {}).get("name", "?"),
                **scores,
            })

    print_shortlist(results)


def print_shortlist(results):
    if not results:
        print("No qualifying races found — none of the four tracks racing today, "
              "or nothing in R1-R6 had enough runners priced.")
        return

    print(f"{'Track':<12}{'Race':<10}{'Neds':>8}{'TABtouch':>10}{'Stack':>8}")
    for r in sorted(results, key=lambda x: -x["neds"]):
        print(f"{r['track']:<12}{r['race']:<10}{r['neds']:>8}{r['tabtouch']:>9}%{r['stack']:>8}")


if __name__ == "__main__":
    main()
