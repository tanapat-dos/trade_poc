"""Historical data download and local caching.

Daily OHLCV via yfinance, cached as CSV under data_cache/ so repeated
backtests don't re-hit the network. Delete the cache dir to force refresh.
"""

import os
import time

import pandas as pd
import yfinance as yf

CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data_cache")

REQUIRED_COLS = ["Open", "High", "Low", "Close", "Volume"]


def _cache_path(ticker: str, start: str, end: str) -> str:
    safe = ticker.replace("/", "-")
    return os.path.join(CACHE_DIR, f"{safe}_{start}_{end}.csv")


def load_prices(ticker: str, start: str, end: str) -> pd.DataFrame:
    """Return a daily OHLCV frame indexed by date, or empty frame on failure.

    Prices are split/dividend adjusted (auto_adjust=True) so indicator math
    is consistent across corporate actions.
    """
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = _cache_path(ticker, start, end)
    if os.path.exists(path):
        df = pd.read_csv(path, index_col=0, parse_dates=True)
        return df

    df = None
    for attempt in range(3):
        try:
            df = yf.download(
                ticker, start=start, end=end,
                auto_adjust=True, progress=False, threads=False,
            )
            break
        except Exception:
            if attempt == 2:
                break
            time.sleep(2 * (attempt + 1))
    if df is None or df.empty:
        df = _load_stooq(ticker, start, end)
    if df is None or df.empty:
        return pd.DataFrame()

    # yfinance sometimes returns MultiIndex columns even for one ticker
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    df = df[[c for c in REQUIRED_COLS if c in df.columns]].dropna()
    df.index = pd.to_datetime(df.index).tz_localize(None)
    df.to_csv(path)
    return df


def _load_stooq(ticker: str, start: str, end: str) -> pd.DataFrame:
    """Fallback source: stooq.com free daily CSV (no API key)."""
    sym = ticker.replace("-", ".").lower() + ".us"
    url = f"https://stooq.com/q/d/l/?s={sym}&i=d"
    try:
        df = pd.read_csv(url, index_col=0, parse_dates=True)
    except Exception:
        return pd.DataFrame()
    if df.empty or "Close" not in df.columns:
        return pd.DataFrame()
    return df.loc[start:end]


def load_universe_prices(tickers: list, start: str, end: str, progress_cb=None) -> dict:
    """Download all tickers, returning {ticker: DataFrame}. Skips failures."""
    out = {}
    total = len(tickers)
    for i, t in enumerate(tickers):
        df = load_prices(t, start, end)
        if not df.empty and len(df) > 30:
            out[t] = df
        if progress_cb:
            progress_cb(i + 1, total, t)
    return out
