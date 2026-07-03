"""Today's plan — runs the momentum strategy on LIVE data and produces a
plain-English to-do list (what to buy, what to sell, and why).

Used by the app's live paper-trading tab. Same logic as the backtest:
rank by trailing return, hold the top N, sell rank-losers and big losers,
stand aside when the whole market is below its 200-day average.
"""

from dataclasses import dataclass, field

import pandas as pd

from . import indicators as ind


@dataclass
class Plan:
    market_healthy: bool = True
    market_note: str = ""
    sells: list = field(default_factory=list)   # (ticker, reason)
    buys: list = field(default_factory=list)    # (ticker, dollars, reason)
    rankings: pd.DataFrame = None
    notes: list = field(default_factory=list)


def todays_plan(
    data: dict,               # {ticker: OHLCV df, recent history}
    spy: pd.DataFrame,        # SPY history
    held: dict,               # {ticker: {"entry": avg_entry_price, "now": current_price, "value": $}}
    budget: float,
    top_n: int = 5,
    lookback_days: int = 126,
    skip_days: int = 21,
    hold_rank: int = 10,
    stop_loss_pct: float = 15.0,
) -> Plan:
    plan = Plan()

    # 1. Market health check (the 200-day safety rule)
    spy_sma = ind.sma(spy["Close"], 200)
    spy_now, sma_now = spy["Close"].iloc[-1], spy_sma.iloc[-1]
    plan.market_healthy = bool(spy_now > sma_now)
    pct = spy_now / sma_now - 1
    if plan.market_healthy:
        plan.market_note = (
            f"The overall market (S&P 500) is {pct:+.1%} above its 200-day average "
            "— healthy. New buying is allowed."
        )
    else:
        plan.market_note = (
            f"The overall market (S&P 500) is {pct:+.1%} BELOW its 200-day average "
            "— storm warning. The strategy stops buying and waits in cash."
        )

    # 2. Rank everything by momentum
    scores = {}
    for t, df in data.items():
        s = ind.momentum(df["Close"], lookback_days, skip_days)
        if len(s.dropna()):
            scores[t] = s.dropna().iloc[-1]
    ranking = (
        pd.Series(scores).sort_values(ascending=False).rename("6-month gain")
    )
    ranks = {t: i + 1 for i, t in enumerate(ranking.index)}
    plan.rankings = pd.DataFrame({
        "Rank": range(1, len(ranking) + 1),
        "Stock": ranking.index,
        "Past gain": [f"{v:+.1%}" for v in ranking.values],
    }).set_index("Rank")

    # 3. What to sell
    for t, info in held.items():
        rank = ranks.get(t)
        loss = info["now"] / info["entry"] - 1 if info.get("entry") else 0.0
        if loss <= -stop_loss_pct / 100:
            plan.sells.append((t, f"down {loss:.0%} from where you bought — "
                                  f"safety rule says cut losses at -{stop_loss_pct:.0f}%"))
        elif rank is None:
            plan.sells.append((t, "no longer in the tracked stock list"))
        elif rank > hold_rank:
            plan.sells.append((t, f"dropped to #{rank} in the strength ranking "
                                  f"(we only keep stocks in the top {hold_rank})"))

    # 4. What to buy
    selling = {t for t, _ in plan.sells}
    keeping = [t for t in held if t not in selling]
    slots = top_n - len(keeping)
    if not plan.market_healthy:
        plan.notes.append("No buys today — waiting for the market to get healthy again.")
    elif slots <= 0:
        plan.notes.append("Portfolio is already full — nothing to buy.")
    else:
        freed_cash = sum(held[t]["value"] for t in selling)
        cash_available = budget + freed_cash
        per_position = cash_available / slots if slots else 0
        candidates = [t for t in ranking.index[:top_n] if t not in keeping and t not in selling]
        for t in candidates[:slots]:
            plan.buys.append((
                t, round(per_position, 2),
                f"currently #{ranks[t]} strongest stock "
                f"({ranking[t]:+.1%} over the lookback period)",
            ))
    return plan
