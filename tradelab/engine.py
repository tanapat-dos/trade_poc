"""The backtest engine.

Correctness rules baked in:
  * Signals use data up to day T's close; orders execute at day T+1's OPEN.
  * Every fill pays slippage (default 5 bps) — no free lunches.
  * Stops are checked against the day's actual low; gap-downs fill at the
    open, not at the stop price (the market doesn't honor your stop level).
  * Cash can never go negative; position sizes are % of *current* equity.

The engine owns portfolio/risk logic (sizing, stops, regime filter,
max positions); strategies only emit entry/exit wishes.
"""

from dataclasses import dataclass, field

import pandas as pd

from . import indicators as ind
from .strategies import Position, STRATEGIES


@dataclass
class Trade:
    ticker: str
    entry_date: pd.Timestamp
    entry_price: float
    shares: float
    exit_date: pd.Timestamp = None
    exit_price: float = None
    pnl: float = None
    pnl_pct: float = None
    reason: str = ""


@dataclass
class BacktestResult:
    equity: pd.Series = None            # daily equity curve
    benchmark: pd.Series = None         # SPY buy-and-hold, same capital
    trades: list = field(default_factory=list)
    config: dict = field(default_factory=dict)
    warnings: list = field(default_factory=list)


DEFAULT_RISK = {
    "max_positions": 5,
    "position_pct": 20.0,        # % of current equity per new position
    "stop_loss_pct": 15.0,       # fixed stop below entry; 0 disables
    "trailing_stop_pct": 20.0,   # trail below highest close; 0 disables
    "max_hold_days": 0,          # 0 disables
    "regime_filter": True,       # block new entries when SPY < 200-day SMA
    "regime_sma": 200,
}

DEFAULT_COSTS = {"slippage_bps": 5.0, "commission": 0.0}


def run_backtest(
    strategy_name: str,
    strategy_params: dict,
    data: dict,                 # {ticker: OHLCV df} incl. warmup history
    benchmark_df: pd.DataFrame, # SPY OHLCV
    start: str,
    end: str,
    capital: float = 1000.0,
    risk: dict = None,
    costs: dict = None,
    fractional_shares: bool = True,
) -> BacktestResult:
    risk = {**DEFAULT_RISK, **(risk or {})}
    costs = {**DEFAULT_COSTS, **(costs or {})}
    slip = costs["slippage_bps"] / 10_000.0
    commission = costs["commission"]

    strat_cls = STRATEGIES[strategy_name]
    strat = strat_cls(strategy_params, data)

    # Trading calendar = benchmark dates inside the window.
    cal = benchmark_df.index
    cal = cal[(cal >= pd.Timestamp(start)) & (cal <= pd.Timestamp(end))]
    if len(cal) < 10:
        raise ValueError("Backtest window too short or no benchmark data.")

    regime_ok = pd.Series(True, index=benchmark_df.index)
    if risk["regime_filter"]:
        regime_ok = benchmark_df["Close"] > ind.sma(
            benchmark_df["Close"], int(risk["regime_sma"])
        )

    cash = capital
    positions: dict[str, Position] = {}
    trades: list[Trade] = []
    equity_curve = {}
    # Orders decided on yesterday's close, to execute at today's open.
    pending_buys: list[str] = []
    pending_sells: dict[str, str] = {}  # ticker -> reason

    def bar(ticker, date):
        df = data.get(ticker)
        if df is None or date not in df.index:
            return None
        return df.loc[date]

    def close_position(ticker, date, price, reason):
        nonlocal cash
        pos = positions.pop(ticker)
        fill = price * (1 - slip)
        cash += pos.shares * fill - commission
        for t in trades:
            if t.ticker == ticker and t.exit_date is None:
                t.exit_date = date
                t.exit_price = fill
                t.pnl = (fill - t.entry_price) * t.shares
                t.pnl_pct = fill / t.entry_price - 1
                t.reason = reason
                break

    for date in cal:
        # ---- 1. Execute yesterday's decisions at today's open ----
        for ticker, reason in list(pending_sells.items()):
            b = bar(ticker, date)
            if b is not None and ticker in positions:
                close_position(ticker, date, b["Open"], reason)
        pending_sells.clear()

        for ticker in pending_buys:
            if ticker in positions or len(positions) >= int(risk["max_positions"]):
                continue
            b = bar(ticker, date)
            if b is None:
                continue
            port_value = cash + sum(
                p.shares * (bar(t, date)["Close"] if bar(t, date) is not None else p.high_water)
                for t, p in positions.items()
            )
            budget = min(port_value * risk["position_pct"] / 100.0, cash)
            fill = b["Open"] * (1 + slip)
            shares = budget / fill if fractional_shares else int(budget // fill)
            if shares <= 0 or shares * fill > cash:
                continue
            cash -= shares * fill + commission
            positions[ticker] = Position(ticker, date, fill, shares)
            trades.append(Trade(ticker, date, fill, shares))
        pending_buys = []

        # ---- 2. Intraday stop checks against today's low ----
        for ticker, pos in list(positions.items()):
            b = bar(ticker, date)
            if b is None:
                continue
            stop_levels = []
            if risk["stop_loss_pct"] > 0:
                stop_levels.append(pos.entry_price * (1 - risk["stop_loss_pct"] / 100))
            if risk["trailing_stop_pct"] > 0:
                stop_levels.append(pos.high_water * (1 - risk["trailing_stop_pct"] / 100))
            if not stop_levels:
                continue
            stop = max(stop_levels)
            if b["Low"] <= stop:
                # Gap through the stop fills at the open, not the stop.
                fill_price = min(b["Open"], stop)
                close_position(ticker, date, fill_price, f"stop hit at {stop:.2f}")

        # ---- 3. End of day: mark to market, update trails, decide ----
        port_value = cash
        for ticker, pos in positions.items():
            b = bar(ticker, date)
            if b is not None:
                pos.high_water = max(pos.high_water, b["Close"])
                pos.days_held += 1
                port_value += pos.shares * b["Close"]
            else:
                port_value += pos.shares * pos.high_water
        equity_curve[date] = port_value

        # Strategy exit wishes -> sell at tomorrow's open
        for ticker, pos in positions.items():
            reason = strat.wants_exit(ticker, date, pos)
            if reason is None and risk["max_hold_days"] and pos.days_held >= int(risk["max_hold_days"]):
                reason = f"max hold {risk['max_hold_days']} days"
            if reason:
                pending_sells[ticker] = reason

        # Strategy entry wishes -> buy at tomorrow's open (regime permitting)
        allowed = bool(regime_ok.get(date, True))
        if allowed:
            slots = int(risk["max_positions"]) - (len(positions) - len(pending_sells))
            if slots > 0:
                cands = [
                    t for t in strat.entry_candidates(date)
                    if t not in positions and t not in pending_sells
                ]
                pending_buys = cands[:slots]

    equity = pd.Series(equity_curve).sort_index()

    # Benchmark: buy SPY at the first day's open with the same capital+slippage.
    bench_window = benchmark_df.loc[equity.index[0]: equity.index[-1]]
    spy_fill = bench_window["Open"].iloc[0] * (1 + slip)
    benchmark = bench_window["Close"] * (capital / spy_fill)

    warnings = []
    closed = [t for t in trades if t.exit_date is not None]
    if len(closed) < 30:
        warnings.append(
            f"Only {len(closed)} closed trades — results are statistically weak; "
            "test a longer period before trusting them."
        )
    warnings.append(
        "Universe is today's large caps (survivorship bias) — treat multi-year "
        "results as optimistic."
    )

    return BacktestResult(
        equity=equity,
        benchmark=benchmark,
        trades=trades,
        config={
            "strategy": strategy_name, "params": strategy_params,
            "risk": risk, "costs": costs, "capital": capital,
            "start": str(equity.index[0].date()), "end": str(equity.index[-1].date()),
            "fractional_shares": fractional_shares,
        },
        warnings=warnings,
    )
