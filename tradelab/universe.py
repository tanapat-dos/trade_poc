"""Stock universes.

The default universe is ~100 of the largest, most liquid S&P 500 names,
hardcoded so backtests are reproducible and never depend on a live fetch.
You can also pass an explicit ticker list in a strategy config.

NOTE on survivorship bias: this is the CURRENT large-cap list. Stocks that
crashed out of the index in the past are missing, which flatters long
backtests. For a 1-2 year lookback the effect is small, but keep it in
mind before trusting 10-year numbers.
"""

SP100 = [
    # Mega-cap tech
    "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AVGO",
    "ORCL", "CRM", "ADBE", "AMD", "QCOM", "TXN", "INTC", "IBM", "NOW",
    "INTU", "MU", "AMAT", "LRCX", "KLAC", "PANW", "ANET", "PLTR",
    # Communication / media
    "NFLX", "DIS", "CMCSA", "TMUS", "VZ", "T",
    # Financials
    "BRK-B", "JPM", "V", "MA", "BAC", "WFC", "GS", "MS", "SCHW", "AXP",
    "C", "BLK", "SPGI", "PGR", "CB",
    # Healthcare
    "LLY", "UNH", "JNJ", "ABBV", "MRK", "TMO", "ABT", "DHR", "PFE",
    "AMGN", "ISRG", "GILD", "VRTX", "BSX", "MDT", "CVS",
    # Consumer
    "WMT", "PG", "KO", "PEP", "COST", "MCD", "NKE", "SBUX", "TGT",
    "HD", "LOW", "TJX", "BKNG", "CMG", "MDLZ", "CL", "KMB",
    # Industrials
    "CAT", "DE", "UNP", "UPS", "HON", "RTX", "BA", "LMT", "GE", "MMM",
    "ETN", "EMR", "ITW", "CSX",
    # Energy
    "XOM", "CVX", "COP", "SLB", "EOG", "OXY",
    # Utilities / REITs / materials
    "NEE", "DUK", "SO", "LIN", "APD", "FCX", "AMT", "PLD",
    # Payments / misc
    "PYPL", "ABNB", "UBER",
]

BENCHMARK = "SPY"


def get_universe(spec) -> list:
    """Resolve a universe spec from config: 'sp100' or an explicit list."""
    if isinstance(spec, list):
        return spec
    if isinstance(spec, str) and spec.lower() in ("sp100", "sp500", "default"):
        return list(SP100)
    raise ValueError(f"Unknown universe spec: {spec!r}")
