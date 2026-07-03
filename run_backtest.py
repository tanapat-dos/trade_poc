"""CLI backtest runner — same engine as the web app, driven by a YAML config.

Usage:
    .venv/bin/python run_backtest.py configs/momentum.yaml
"""

import sys

import pandas as pd
import yaml

from tradelab.data import load_universe_prices, load_prices
from tradelab.engine import run_backtest
from tradelab.metrics import compute_metrics, monthly_returns, trades_dataframe
from tradelab.universe import get_universe, BENCHMARK


def main(config_path: str):
    with open(config_path) as f:
        cfg = yaml.safe_load(f)

    start, end = str(cfg["start"]), str(cfg["end"])
    data_start = (pd.Timestamp(start) - pd.Timedelta(days=550)).strftime("%Y-%m-%d")

    tickers = get_universe(cfg.get("universe", "sp100"))
    print(f"Downloading {len(tickers)} tickers ({data_start} → {end})…")
    data = load_universe_prices(
        tickers, data_start, end,
        progress_cb=lambda i, n, t: print(f"  [{i}/{n}] {t}", end="\r"),
    )
    print(f"\nLoaded {len(data)} tickers.")
    spy = load_prices(BENCHMARK, data_start, end)
    if spy.empty:
        sys.exit("Failed to load SPY benchmark data.")

    result = run_backtest(
        cfg["strategy"], cfg.get("params", {}), data, spy,
        start, end,
        capital=float(cfg.get("capital", 1000)),
        risk=cfg.get("risk"),
        costs=cfg.get("costs"),
        fractional_shares=bool(cfg.get("fractional_shares", True)),
    )

    print("\n=== " + cfg.get("name", cfg["strategy"]) + " ===")
    for k, v in compute_metrics(result.equity, result.benchmark, result.trades).items():
        print(f"  {k:24s} {v}")

    print("\nMonthly returns:")
    mt = monthly_returns(result.equity)
    print(mt.map(lambda v: f"{v:+.1%}" if pd.notna(v) else "").to_string())

    print("\nTrades:")
    tdf = trades_dataframe(result.trades)
    print(tdf.to_string(index=False) if not tdf.empty else "  (none)")

    for w in result.warnings:
        print(f"\n⚠️  {w}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
