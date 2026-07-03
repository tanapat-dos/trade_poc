"""Performance metrics computed from the daily equity curve and trade list."""

import numpy as np
import pandas as pd

TRADING_DAYS = 252


def compute_metrics(equity: pd.Series, benchmark: pd.Series, trades: list) -> dict:
    rets = equity.pct_change().dropna()
    n_days = len(equity)
    years = n_days / TRADING_DAYS

    total_return = equity.iloc[-1] / equity.iloc[0] - 1
    cagr = (equity.iloc[-1] / equity.iloc[0]) ** (1 / years) - 1 if years > 0 else 0.0

    peak = equity.cummax()
    dd = equity / peak - 1
    max_dd = dd.min()

    vol = rets.std() * np.sqrt(TRADING_DAYS)
    sharpe = (rets.mean() / rets.std() * np.sqrt(TRADING_DAYS)) if rets.std() > 0 else 0.0
    downside = rets[rets < 0].std()
    sortino = (rets.mean() / downside * np.sqrt(TRADING_DAYS)) if downside and downside > 0 else 0.0

    closed = [t for t in trades if t.exit_date is not None]
    wins = [t for t in closed if t.pnl > 0]
    losses = [t for t in closed if t.pnl <= 0]
    gross_win = sum(t.pnl for t in wins)
    gross_loss = abs(sum(t.pnl for t in losses))

    bench_total = benchmark.iloc[-1] / benchmark.iloc[0] - 1 if len(benchmark) else 0.0

    return {
        "Total return": f"{total_return:+.1%}",
        "CAGR": f"{cagr:+.1%}",
        "vs SPY buy & hold": f"{total_return - bench_total:+.1%}",
        "Max drawdown": f"{max_dd:.1%}",
        "Sharpe": f"{sharpe:.2f}",
        "Sortino": f"{sortino:.2f}",
        "Volatility (ann.)": f"{vol:.1%}",
        "Trades (closed/open)": f"{len(closed)}/{len(trades) - len(closed)}",
        "Win rate": f"{len(wins) / len(closed):.0%}" if closed else "n/a",
        "Profit factor": f"{gross_win / gross_loss:.2f}" if gross_loss > 0 else "inf",
        "Avg win": f"{np.mean([t.pnl_pct for t in wins]):+.1%}" if wins else "n/a",
        "Avg loss": f"{np.mean([t.pnl_pct for t in losses]):+.1%}" if losses else "n/a",
        "Final equity": f"${equity.iloc[-1]:,.2f}",
    }


def monthly_returns(equity: pd.Series) -> pd.DataFrame:
    """Year x month table of % returns — the user's monthly report card."""
    monthly = equity.resample("ME").last().pct_change()
    first = equity.resample("ME").last()
    if len(first) > 0:
        # first month return measured from starting equity
        monthly.iloc[0] = first.iloc[0] / equity.iloc[0] - 1
    df = pd.DataFrame({
        "Year": monthly.index.year,
        "Month": monthly.index.strftime("%b"),
        "Return": monthly.values,
    })
    order = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
             "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    pivot = df.pivot(index="Year", columns="Month", values="Return")
    return pivot.reindex(columns=[m for m in order if m in pivot.columns])


def drawdown_series(equity: pd.Series) -> pd.Series:
    return equity / equity.cummax() - 1


def trades_dataframe(trades: list) -> pd.DataFrame:
    rows = []
    for t in trades:
        rows.append({
            "Ticker": t.ticker,
            "Entry": t.entry_date.date() if t.entry_date is not None else None,
            "Entry $": round(t.entry_price, 2),
            "Shares": round(t.shares, 4),
            "Exit": t.exit_date.date() if t.exit_date is not None else "open",
            "Exit $": round(t.exit_price, 2) if t.exit_price else None,
            "P&L $": round(t.pnl, 2) if t.pnl is not None else None,
            "P&L %": f"{t.pnl_pct:+.1%}" if t.pnl_pct is not None else None,
            "Exit reason": t.reason,
        })
    return pd.DataFrame(rows)
