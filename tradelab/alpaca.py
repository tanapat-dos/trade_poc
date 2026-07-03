"""Alpaca PAPER trading connector.

SAFETY: the paper-trading URL is hardcoded. This module can only ever touch
the pretend-money account — it cannot place real trades, period.

Keys come from a local .env file (gitignored) or environment variables:
    ALPACA_API_KEY=...
    ALPACA_SECRET_KEY=...
Get them free at https://alpaca.markets -> sign up -> Paper Trading -> API Keys.
"""

import os

import pandas as pd
import requests

PAPER_URL = "https://paper-api.alpaca.markets/v2"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_FILE = os.path.join(ROOT, ".env")


def _load_env_file():
    """Read .env into os.environ (without overwriting real env vars)."""
    if not os.path.exists(ENV_FILE):
        return
    with open(ENV_FILE) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def save_keys(api_key: str, secret_key: str):
    """Write keys to the gitignored .env file."""
    lines = []
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE) as f:
            lines = [
                l for l in f.read().splitlines()
                if not l.startswith(("ALPACA_API_KEY=", "ALPACA_SECRET_KEY="))
            ]
    lines += [f"ALPACA_API_KEY={api_key.strip()}", f"ALPACA_SECRET_KEY={secret_key.strip()}"]
    with open(ENV_FILE, "w") as f:
        f.write("\n".join(lines) + "\n")
    os.environ["ALPACA_API_KEY"] = api_key.strip()
    os.environ["ALPACA_SECRET_KEY"] = secret_key.strip()


def get_keys():
    _load_env_file()
    return os.environ.get("ALPACA_API_KEY"), os.environ.get("ALPACA_SECRET_KEY")


def is_configured() -> bool:
    key, secret = get_keys()
    return bool(key and secret)


def _headers():
    key, secret = get_keys()
    return {"APCA-API-KEY-ID": key or "", "APCA-API-SECRET-KEY": secret or ""}


def _get(path, **params):
    r = requests.get(f"{PAPER_URL}{path}", headers=_headers(), params=params, timeout=15)
    r.raise_for_status()
    return r.json()


def check_connection():
    """Returns (ok, message)."""
    try:
        acct = _get("/account")
        return True, f"Connected — paper account {acct.get('account_number', '')}"
    except requests.HTTPError as e:
        if e.response is not None and e.response.status_code in (401, 403):
            return False, "Keys were rejected — double-check you copied the PAPER keys."
        return False, f"Connection problem: {e}"
    except Exception as e:
        return False, f"Connection problem: {e}"


def get_account() -> dict:
    return _get("/account")


def get_positions() -> list:
    return _get("/positions")


def get_open_orders() -> list:
    return _get("/orders", status="open", limit=100)


def portfolio_history(period="3M") -> pd.Series:
    """Daily equity history of the paper account."""
    js = _get("/account/portfolio/history", period=period, timeframe="1D")
    ts = pd.to_datetime(pd.Series(js.get("timestamp", [])), unit="s")
    eq = pd.Series(js.get("equity", []), index=ts, dtype=float)
    return eq.dropna()


def buy_notional(symbol: str, dollars: float) -> dict:
    """Market-buy a dollar amount (fractional shares OK). Paper only."""
    r = requests.post(
        f"{PAPER_URL}/orders", headers=_headers(), timeout=15,
        json={
            "symbol": symbol,
            "notional": str(round(dollars, 2)),
            "side": "buy",
            "type": "market",
            "time_in_force": "day",
        },
    )
    r.raise_for_status()
    return r.json()


def sell_all(symbol: str) -> dict:
    """Close the whole position in one ticker. Paper only."""
    r = requests.delete(f"{PAPER_URL}/positions/{symbol}", headers=_headers(), timeout=15)
    r.raise_for_status()
    return r.json()
