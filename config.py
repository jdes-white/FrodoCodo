"""Configuration for the Saturday race screener."""

# The four tracks that rotate through Saturday metro racing.
# Override at runtime with --tracks if a different set is racing
# (e.g. carnival week, Eagle Farm, Morphettville).
DEFAULT_TRACKS = ["Randwick", "Rosehill", "Flemington", "Caulfield"]

# Promo windows are generally races 1-6 on the card.
RACE_RANGE = (1, 6)

# Betfair Exchange API — Delayed App Key (free, personal, non-commercial use).
# Set these as environment variables. Never hardcode credentials in code.
#   BETFAIR_USERNAME   your Betfair login
#   BETFAIR_PASSWORD   your Betfair password
#   BETFAIR_APP_KEY    the Delayed key from the Betfair Developer Account Demo Tool
BETFAIR_LOGIN_URL = "https://identitysso.betfair.com/api/login"
BETFAIR_API_URL = "https://api.betfair.com/exchange/betting/json-rpc/v1"
