"""Strategy library.

Every strategy answers two questions each day, using only data up to that
day's close (the engine executes the resulting orders at the NEXT open):

  entry_candidates(date) -> ordered list of tickers it wants to hold
  wants_exit(ticker, date, position) -> reason string, or None to keep

To add your own strategy: subclass Strategy, implement those two methods,
and register it in STRATEGIES at the bottom. That's it — the engine,
risk rules, and UI pick it up automatically.
"""

import pandas as pd

from . import indicators as ind


class Position:
    """Lightweight record the engine passes to wants_exit."""

    def __init__(self, ticker, entry_date, entry_price, shares):
        self.ticker = ticker
        self.entry_date = entry_date
        self.entry_price = entry_price
        self.shares = shares
        self.high_water = entry_price  # highest close since entry
        self.days_held = 0


class Strategy:
    name = "base"
    # UI metadata: {param: (label, min, max, default, step)}
    param_spec = {}

    def __init__(self, params: dict, data: dict):
        """data is {ticker: OHLCV DataFrame}; precompute indicators here."""
        self.params = params
        self.data = data

    def entry_candidates(self, date) -> list:
        raise NotImplementedError

    def wants_exit(self, ticker, date, position) -> str | None:
        raise NotImplementedError


class MomentumStrategy(Strategy):
    """Cross-sectional momentum — "follow the flow".

    Every `rebalance_days`, rank the universe by trailing return over
    `lookback_days` (skipping the most recent `skip_days`, per the academic
    12-1 convention) and hold the top `top_n`. A stock is sold when it falls
    below rank `hold_rank` at a rebalance — the buffer avoids churning
    positions that hover around the cutoff.
    """

    name = "momentum"
    param_spec = {
        "lookback_days": ("Momentum lookback (days)", 21, 252, 126, 21),
        "skip_days": ("Skip recent days", 0, 42, 21, 7),
        "top_n": ("Number of stocks to hold", 1, 15, 5, 1),
        "hold_rank": ("Sell when rank falls below", 1, 30, 10, 1),
        "rebalance_days": ("Rebalance every N trading days", 5, 63, 21, 1),
    }

    def __init__(self, params, data):
        super().__init__(params, data)
        lb = int(params["lookback_days"])
        skip = int(params["skip_days"])
        scores = {
            t: ind.momentum(df["Close"], lb, skip) for t, df in data.items()
        }
        self.scores = pd.DataFrame(scores)  # date x ticker
        self._last_rebalance = None
        self._current_ranks = {}

    def _rebalance_due(self, date):
        if self._last_rebalance is None:
            return True
        idx = self.scores.index
        n_days = idx.searchsorted(date) - idx.searchsorted(self._last_rebalance)
        return n_days >= int(self.params["rebalance_days"])

    def _rank_now(self, date):
        if date not in self.scores.index:
            return {}
        row = self.scores.loc[date].dropna().sort_values(ascending=False)
        return {t: i + 1 for i, t in enumerate(row.index)}

    def entry_candidates(self, date):
        if not self._rebalance_due(date):
            return []
        self._last_rebalance = date
        self._current_ranks = self._rank_now(date)
        top_n = int(self.params["top_n"])
        return [t for t, r in self._current_ranks.items() if r <= top_n]

    def wants_exit(self, ticker, date, position):
        # Only re-evaluated on rebalance days (ranks refresh there).
        if not self._current_ranks:
            return None
        rank = self._current_ranks.get(ticker)
        if rank is None or rank > int(self.params["hold_rank"]):
            return f"fell to rank {rank or 'n/a'} (limit {self.params['hold_rank']})"
        return None


class SmaCrossStrategy(Strategy):
    """Trend-following: buy when the fast SMA crosses above the slow SMA,
    sell when it crosses back below."""

    name = "sma_cross"
    param_spec = {
        "fast": ("Fast SMA (days)", 5, 100, 20, 5),
        "slow": ("Slow SMA (days)", 20, 250, 50, 10),
    }

    def __init__(self, params, data):
        super().__init__(params, data)
        fast, slow = int(params["fast"]), int(params["slow"])
        self.above = {}
        for t, df in data.items():
            f, s = ind.sma(df["Close"], fast), ind.sma(df["Close"], slow)
            self.above[t] = (f > s) & f.notna() & s.notna()

    def entry_candidates(self, date):
        out = []
        for t, above in self.above.items():
            if date not in above.index:
                continue
            i = above.index.get_loc(date)
            if i > 0 and above.iloc[i] and not above.iloc[i - 1]:
                out.append(t)  # fresh cross today
        return out

    def wants_exit(self, ticker, date, position):
        above = self.above.get(ticker)
        if above is None or date not in above.index:
            return None
        if not above.loc[date]:
            return "fast SMA crossed below slow SMA"
        return None


class RsiDipStrategy(Strategy):
    """Mean reversion: buy short-term panic dips in long-term uptrends.
    Enter when RSI < buy threshold while price > 200-day SMA; exit when
    RSI recovers above the exit threshold or after max_hold days.

    Note: this is a DAYS-scale strategy (research shows the edge decays
    within ~2 weeks). Included for comparison, not as the 1-3 month core.
    """

    name = "rsi_dip"
    param_spec = {
        "rsi_window": ("RSI window", 2, 21, 3, 1),
        "buy_below": ("Buy when RSI below", 5, 40, 15, 5),
        "exit_above": ("Exit when RSI above", 40, 90, 65, 5),
        "max_hold_days": ("Time stop (days)", 3, 30, 10, 1),
        "trend_sma": ("Uptrend filter SMA (days)", 50, 250, 200, 50),
    }

    def __init__(self, params, data):
        super().__init__(params, data)
        w = int(params["rsi_window"])
        trend = int(params["trend_sma"])
        self.rsi = {t: ind.rsi(df["Close"], w) for t, df in data.items()}
        self.uptrend = {
            t: df["Close"] > ind.sma(df["Close"], trend) for t, df in data.items()
        }

    def entry_candidates(self, date):
        out = []
        for t in self.data:
            r, up = self.rsi[t], self.uptrend[t]
            if date in r.index and r.loc[date] < self.params["buy_below"] and up.loc[date]:
                out.append((t, r.loc[date]))
        out.sort(key=lambda x: x[1])  # most oversold first
        return [t for t, _ in out]

    def wants_exit(self, ticker, date, position):
        if position.days_held >= int(self.params["max_hold_days"]):
            return f"time stop ({position.days_held} days)"
        r = self.rsi.get(ticker)
        if r is not None and date in r.index and r.loc[date] > self.params["exit_above"]:
            return f"RSI recovered above {self.params['exit_above']}"
        return None


class BreakoutStrategy(Strategy):
    """Donchian breakout: buy a close above the prior N-day high, exit on a
    close below the prior M-day low. Classic turtle-style trend entry."""

    name = "breakout"
    param_spec = {
        "entry_window": ("Breakout window (days)", 10, 120, 55, 5),
        "exit_window": ("Exit window (days)", 5, 60, 20, 5),
    }

    def __init__(self, params, data):
        super().__init__(params, data)
        ew, xw = int(params["entry_window"]), int(params["exit_window"])
        self.hi = {t: ind.rolling_high(df["Close"], ew) for t, df in data.items()}
        self.lo = {t: ind.rolling_low(df["Close"], xw) for t, df in data.items()}

    def entry_candidates(self, date):
        out = []
        for t, df in self.data.items():
            if date not in df.index:
                continue
            close, hi = df["Close"].loc[date], self.hi[t].get(date)
            if hi is not None and pd.notna(hi) and close > hi:
                out.append((t, close / hi - 1))
        out.sort(key=lambda x: -x[1])  # strongest breakout first
        return [t for t, _ in out]

    def wants_exit(self, ticker, date, position):
        df = self.data.get(ticker)
        lo = self.lo.get(ticker)
        if df is None or date not in df.index:
            return None
        low_level = lo.get(date)
        if low_level is not None and pd.notna(low_level) and df["Close"].loc[date] < low_level:
            return f"closed below {self.params['exit_window']}-day low"
        return None


STRATEGIES = {
    s.name: s
    for s in [MomentumStrategy, SmaCrossStrategy, RsiDipStrategy, BreakoutStrategy]
}
