"""Handles Betfair session authentication using the Delayed App Key.

NOTE: written to Betfair's documented login flow, but not yet run against
a live account from this environment (no network access to Betfair's
servers from this sandbox). Treat the first run as a test of this file,
not a guarantee it's perfect out of the box.
"""
import os

import requests

from config import BETFAIR_LOGIN_URL


def get_session_token():
    """Log in to Betfair and return a session token (ssoid)."""
    username = os.environ.get("BETFAIR_USERNAME")
    password = os.environ.get("BETFAIR_PASSWORD")
    app_key = os.environ.get("BETFAIR_APP_KEY")

    if not all([username, password, app_key]):
        raise EnvironmentError(
            "Set BETFAIR_USERNAME, BETFAIR_PASSWORD and BETFAIR_APP_KEY "
            "as environment variables before running."
        )

    headers = {
        "X-Application": app_key,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
    }
    payload = {"username": username, "password": password}

    resp = requests.post(BETFAIR_LOGIN_URL, data=payload, headers=headers)
    resp.raise_for_status()
    data = resp.json()

    if data.get("status") != "SUCCESS":
        raise RuntimeError(f"Betfair login failed: {data.get('error')}")

    return data["token"]
