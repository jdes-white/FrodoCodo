"""Fetches horse racing win-market data from the Betfair Exchange API.

NOTE: written to Betfair's documented Sports AP-ING shape, but not yet run
against live data from this environment. The race-number parsing in
_race_number() is the part most likely to need a tweak once you see what
Betfair's actual event names look like for AU metro racing — adjust the
regex there if it doesn't match first time.
"""
import datetime
import re

import requests

from config import BETFAIR_API_URL, RACE_RANGE


def _rpc_call(session_token, app_key, method, params):
    headers = {
        "X-Application": app_key,
        "X-Authentication": session_token,
        "Content-Type": "application/json",
    }
    body = [{
        "jsonrpc": "2.0",
        "method": f"SportsAPING/v1.0/{method}",
        "params": params,
        "id": 1,
    }]
    resp = requests.post(BETFAIR_API_URL, json=body, headers=headers)
    resp.raise_for_status()
    result = resp.json()[0]
    if "error" in result:
        raise RuntimeError(f"Betfair API error: {result['error']}")
    return result["result"]


def get_races_for_track(session_token, app_key, track_name):
    """Return win-market catalogues for races 1-6 at a track, today.

    Returns an empty list if the track isn't racing today — the caller
    should treat that as "skip silently", not an error.
    """
    market_filter = {
        "eventTypeIds": ["7"],  # Horse Racing
        "marketCountries": ["AU"],
        "marketTypeCodes": ["WIN"],
        "textQuery": track_name,
        "marketStartTime": {
            "from": _today_start_iso(),
            "to": _today_end_iso(),
        },
    }
    catalogues = _rpc_call(session_token, app_key, "listMarketCatalogue", {
        "filter": market_filter,
        "maxResults": "50",
        "marketProjection": ["EVENT", "RUNNER_DESCRIPTION", "MARKET_START_TIME"],
    })
    return [
        c for c in catalogues
        if RACE_RANGE[0] <= _race_number(c) <= RACE_RANGE[1]
    ]


def get_prices(session_token, app_key, market_id):
    """Return best-back price per runner for a given market."""
    books = _rpc_call(session_token, app_key, "listMarketBook", {
        "marketIds": [market_id],
        "priceProjection": {"priceData": ["EX_BEST_OFFERS"]},
    })
    return books[0]["runners"] if books else []


def _race_number(catalogue):
    # Betfair AU racing event names are typically something like "R4 1200m".
    # Adjust this regex if the live format differs.
    name = catalogue.get("event", {}).get("name", "")
    match = re.search(r"R(\d+)", name)
    return int(match.group(1)) if match else -1


def _today_start_iso():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT00:00:00Z")


def _today_end_iso():
    return datetime.datetime.utcnow().strftime("%Y-%m-%dT23:59:59Z")
