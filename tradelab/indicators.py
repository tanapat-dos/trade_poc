"""Technical indicators. All functions take/return pandas Series aligned to
the input index, computed with only past data (no lookahead)."""

import numpy as np
import pandas as pd


def sma(close: pd.Series, window: int) -> pd.Series:
    return close.rolling(window).mean()


def ema(close: pd.Series, window: int) -> pd.Series:
    return close.ewm(span=window, adjust=False).mean()


def momentum(close: pd.Series, lookback: int, skip: int = 0) -> pd.Series:
    """Total return over `lookback` days, optionally skipping the most
    recent `skip` days (classic 12-1 momentum uses skip ~ 21)."""
    past = close.shift(lookback + skip)
    recent = close.shift(skip)
    return recent / past - 1.0


def rsi(close: pd.Series, window: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = -delta.clip(upper=0.0)
    avg_gain = gain.ewm(alpha=1.0 / window, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / window, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    out = 100 - 100 / (1 + rs)
    return out.fillna(50.0)


def atr(df: pd.DataFrame, window: int = 14) -> pd.Series:
    high, low, close = df["High"], df["Low"], df["Close"]
    prev_close = close.shift(1)
    tr = pd.concat(
        [high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1
    ).max(axis=1)
    return tr.ewm(alpha=1.0 / window, adjust=False).mean()


def rolling_high(close: pd.Series, window: int) -> pd.Series:
    """Highest close of the PRIOR `window` days (excludes today)."""
    return close.shift(1).rolling(window).max()


def rolling_low(close: pd.Series, window: int) -> pd.Series:
    """Lowest close of the PRIOR `window` days (excludes today)."""
    return close.shift(1).rolling(window).min()
