"""TradeLab — test trading ideas safely, in plain English.

Run with:  .venv/bin/streamlit run app.py
"""

from datetime import date, timedelta

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from tradelab import alpaca
from tradelab.advisor import todays_plan
from tradelab.data import load_universe_prices, load_prices
from tradelab.engine import run_backtest, DEFAULT_RISK, DEFAULT_COSTS
from tradelab.metrics import (
    compute_metrics, monthly_returns, drawdown_series, trades_dataframe,
)
from tradelab.strategies import STRATEGIES
from tradelab.universe import get_universe, BENCHMARK

st.set_page_config(page_title="TradeLab", layout="wide", page_icon="📈")

# ---------------------------------------------------------------- helpers

STRATEGY_MENU = {
    "momentum": {
        "label": "🏆 Follow the winners (recommended)",
        "story": (
            "Buy the **5 stocks that went up the most** over the last 6 months — "
            "if lots of money is flowing into a stock, it tends to keep rising for "
            "a few more months. Once a month, kick out anything that stopped "
            "winning and replace it with a new winner. "
            "This is the closest thing to your *'find the good traders and follow "
            "the flow'* idea: you can't see their orders, but rising prices show "
            "where their money already went."
        ),
    },
    "sma_cross": {
        "label": "📈 Ride the trend",
        "story": (
            "Watch each stock's average price over the last 20 days vs the last "
            "50 days. When the recent average climbs above the longer one, the "
            "stock is picking up speed — **buy**. When it drops back below — "
            "**sell**. Simple 'get on the train, get off the train' logic."
        ),
    },
    "breakout": {
        "label": "🚀 Buy record breakers",
        "story": (
            "Buy a stock the day it beats its **highest price of the last 55 "
            "days** (strength begets strength), and sell it if it sinks to its "
            "lowest price of the last 20 days."
        ),
    },
    "rsi_dip": {
        "label": "🛒 Buy the panic dip (short-term)",
        "story": (
            "When a healthy stock suddenly drops hard for a few days, buy the "
            "panic and sell the bounce a few days later. This one trades a lot "
            "and holds for only days — included so you can compare styles."
        ),
    },
}


@st.cache_data(show_spinner=False, ttl=24 * 3600)
def fetch_data(tickers: tuple, start: str, end: str):
    prog = st.progress(0.0, text="Downloading price history… (only slow the first time)")

    def cb(i, total, t):
        prog.progress(i / total, text=f"Downloading {t} ({i}/{total})")

    data = load_universe_prices(list(tickers), start, end, progress_cb=cb)
    prog.empty()
    return data


def money(x):
    return f"${x:,.2f}"


# ---------------------------------------------------------------- header

st.title("📈 TradeLab")
st.markdown(
    "**Your idea:** buy cheap, sell expensive. **The hard part:** *which* stocks, "
    "*when*, and *when to get out*. A **strategy** is just a fixed set of rules that "
    "answers those questions automatically — no feelings involved.\n\n"
    "This app lets you try strategies two ways, both 100% safe:"
)
c1, c2 = st.columns(2)
c1.info("🕰️ **Time machine** — replay the past year and see what your $1,000 "
        "*would have* become if a robot followed the rules.")
c2.info("📡 **Live practice** — a pretend-money account (via Alpaca) that trades "
        "on the **real market, today's real prices**. Watch it like a tamagotchi.")

tab_back, tab_live, tab_learn = st.tabs(
    ["🕰️ Time machine (test on the past)", "📡 Live practice (real market, pretend money)", "📖 What do these words mean?"]
)

# ================================================================ TAB 1: BACKTEST
with tab_back:
    left, right = st.columns([1, 2.4], gap="large")

    with left:
        st.subheader("1. Pick a strategy")
        strategy_name = st.radio(
            "Strategy", list(STRATEGY_MENU.keys()),
            format_func=lambda s: STRATEGY_MENU[s]["label"],
            label_visibility="collapsed",
        )
        st.caption(STRATEGY_MENU[strategy_name]["story"])

        st.subheader("2. Money & time")
        capital = st.number_input(
            "Pretend starting money ($)", 100, 1_000_000, 1000, 100,
            help="How much the robot starts with. You said $1,000 — that's the default.")
        today = date.today()
        start_date = st.date_input("Start the time machine at", today - timedelta(days=365),
                                   help="How far back to rewind. One year back is a good start.")
        end_date = st.date_input("…and play forward until", today)

        with st.expander("⚙️ Fine-tuning (safe to ignore)"):
            st.markdown("**Strategy dials**")
            params = {}
            for key, (label, lo, hi, default, step) in STRATEGIES[strategy_name].param_spec.items():
                params[key] = st.slider(label, lo, hi, default, step,
                                        key=f"{strategy_name}.{key}")

            st.markdown("**Safety rules**")
            risk = dict(DEFAULT_RISK)
            risk["max_positions"] = st.slider(
                "Max stocks owned at once", 1, 15, 5,
                help="Don't put all eggs in one basket — but too many baskets and none matters.")
            risk["position_pct"] = st.slider(
                "Money per stock (% of total)", 5, 100, 20, 5,
                help="20% × 5 stocks = fully invested.")
            risk["stop_loss_pct"] = st.slider(
                "Emergency exit: sell if a stock falls this % below what you paid", 0, 30, 15,
                help="0 turns it off. This caps how bad one mistake can get.")
            risk["trailing_stop_pct"] = st.slider(
                "Give-back limit: sell if a stock falls this % from its best price", 0, 40, 20,
                help="Locks in profit on winners. Research says keep this WIDE (15-25%) — "
                     "tight limits kick you out of your best stocks too early.")
            risk["regime_filter"] = st.checkbox(
                "🌦️ Storm shelter: stop buying when the WHOLE market is falling", value=True,
                help="When the S&P 500 is below its 200-day average, history says crashes "
                     "get much worse. This rule roughly halved losses in past disasters.")

            st.markdown("**Realism**")
            costs = dict(DEFAULT_COSTS)
            costs["slippage_bps"] = st.slider(
                "Slippage (price you actually get is slightly worse)", 0, 25, 5,
                help="In real life you never get the exact printed price. 5 = 0.05% worse per trade.")
            fractional = st.checkbox("Allow buying fractions of a share", value=True,
                                     help="Needed with $1,000 — one whole share of some stocks costs more than that.")

        run_clicked = st.button("🚀 Run the time machine", type="primary", use_container_width=True)

    with right:
        if run_clicked:
            data_start = (pd.Timestamp(start_date) - pd.Timedelta(days=550)).strftime("%Y-%m-%d")
            data_end = pd.Timestamp(end_date).strftime("%Y-%m-%d")
            tickers = tuple(get_universe("sp100"))
            with st.spinner("Loading price history…"):
                data = fetch_data(tickers, data_start, data_end)
                spy = load_prices(BENCHMARK, data_start, data_end)
            if spy.empty or len(data) < 10:
                st.error("Couldn't download price data — check your internet and try again.")
                st.stop()
            st.session_state["bt"] = dict(
                strategy_name=strategy_name, params=params, data=data, spy=spy,
                start=str(start_date), end=str(end_date), capital=capital,
                risk=risk, costs=costs, fractional=fractional,
            )

        if "bt" not in st.session_state:
            st.markdown("### 👈 Set it up and hit **Run the time machine**")
            st.markdown(
                "You'll get:\n"
                "- 📈 a line showing your money day by day — next to what "
                "**doing nothing** (just buying the whole S&P 500) would have made\n"
                "- 🗓️ a month-by-month report card (you said: months should end green)\n"
                "- 🧾 every single buy & sell the robot made, with its reason\n\n"
                "*First run downloads a year of prices for ~110 big US stocks "
                "(about a minute). After that it's instant.*"
            )
        else:
            cfg = st.session_state["bt"]
            with st.spinner("Replaying history…"):
                result = run_backtest(
                    cfg["strategy_name"], cfg["params"], cfg["data"], cfg["spy"],
                    cfg["start"], cfg["end"], capital=cfg["capital"],
                    risk=cfg["risk"], costs=cfg["costs"],
                    fractional_shares=cfg["fractional"],
                )
            m = compute_metrics(result.equity, result.benchmark, result.trades)
            final = result.equity.iloc[-1]
            bench_final = result.benchmark.iloc[-1]

            st.subheader("The verdict")
            k1, k2, k3, k4 = st.columns(4)
            k1.metric("Your money would now be", money(final), m["Total return"],
                      help="Started with " + money(cfg["capital"]))
            k2.metric("If you'd just bought the S&P 500 instead", money(bench_final),
                      help="The 'do nothing' option. A strategy is only worth the "
                           "effort if it beats this.")
            k3.metric("Scariest moment", m["Max drawdown"],
                      help="The biggest fall from a high point along the way. "
                           "Ask yourself honestly: would you have panicked and quit here?")
            k4.metric("Trades that made money", m["Win rate"],
                      help="Surprise: great strategies can win only half the time — "
                           "the wins just need to be bigger than the losses.")

            beat = final - bench_final
            if beat > 0:
                st.success(f"✅ The robot beat 'do nothing' by **{money(beat)}**.")
            else:
                st.error(f"❌ The robot LOST to 'do nothing' by **{money(-beat)}** — "
                         "in this period, just buying the S&P 500 was better.")
            for w in result.warnings:
                st.warning("⚠️ " + w)

            fig = go.Figure()
            fig.add_trace(go.Scatter(x=result.equity.index, y=result.equity.values,
                                     name="Robot strategy", line=dict(width=2.5)))
            fig.add_trace(go.Scatter(x=result.benchmark.index, y=result.benchmark.values,
                                     name="Do nothing (buy S&P 500)",
                                     line=dict(width=1.5, dash="dash")))
            fig.update_layout(title="Your money, day by day", height=400,
                              legend=dict(orientation="h", y=1.12), yaxis_tickprefix="$")
            st.plotly_chart(fig, use_container_width=True)

            ca, cb = st.columns(2)
            with ca:
                mt = monthly_returns(result.equity)
                fig_hm = go.Figure(go.Heatmap(
                    z=mt.values, x=mt.columns, y=mt.index.astype(str),
                    colorscale="RdYlGn", zmid=0, showscale=False,
                    text=[[f"{v:+.1%}" if pd.notna(v) else "" for v in row] for row in mt.values],
                    texttemplate="%{text}",
                ))
                fig_hm.update_layout(title="Monthly report card (green = month ended up)", height=260)
                st.plotly_chart(fig_hm, use_container_width=True)
            with cb:
                dd = drawdown_series(result.equity)
                fig_dd = go.Figure(go.Scatter(x=dd.index, y=dd.values, fill="tozeroy",
                                              line=dict(color="crimson", width=1)))
                fig_dd.update_layout(title="Pain meter (how far below the best point)",
                                     height=260, yaxis_tickformat=".0%")
                st.plotly_chart(fig_dd, use_container_width=True)

            st.subheader("🧾 Every decision the robot made")
            st.caption("Each row: what it bought, when, and why it eventually sold.")
            tdf = trades_dataframe(result.trades)
            if tdf.empty:
                st.info("The rules never triggered a single trade in this period.")
            else:
                st.dataframe(tdf, use_container_width=True, height=350)

            with st.expander("🤓 All the numbers (for when you get curious)"):
                st.table(pd.Series(m, name="Value"))

# ================================================================ TAB 2: LIVE
with tab_live:
    st.subheader("Practice on the real market — with pretend money")
    st.markdown(
        "This uses **Alpaca**, a stock broker built for programs. Its free "
        "**paper trading** account is a flight simulator: real live market prices, "
        "fake money. 🔒 **This app is hard-wired to the pretend account only — it "
        "physically cannot spend real money.**"
    )

    if not alpaca.is_configured():
        st.markdown("### One-time setup (about 5 minutes)")
        st.markdown(
            "1. Go to **[alpaca.markets](https://alpaca.markets)** → *Sign up* (free, "
            "no bank account or deposit needed)\n"
            "2. In the dashboard, make sure the switch at the top-left says "
            "**Paper** (pretend money) — not Live\n"
            "3. Find **API Keys** on the right side → *Generate new keys*\n"
            "4. Copy the two codes and paste them below — they're saved only on "
            "your computer (in a file git will never upload)"
        )
        with st.form("alpaca_setup"):
            key_in = st.text_input("API Key ID", type="password")
            sec_in = st.text_input("Secret Key", type="password")
            if st.form_submit_button("Connect", type="primary"):
                if key_in and sec_in:
                    alpaca.save_keys(key_in, sec_in)
                    ok, msg = alpaca.check_connection()
                    if ok:
                        st.success(msg)
                        st.rerun()
                    else:
                        st.error(msg)
                else:
                    st.error("Please paste both keys.")
    else:
        ok, msg = alpaca.check_connection()
        if not ok:
            st.error(msg + " — you can re-enter keys by deleting the .env file.")
            st.stop()

        acct = alpaca.get_account()
        positions = alpaca.get_positions()
        equity = float(acct["equity"])
        cash = float(acct["cash"])
        invested = equity - cash

        st.markdown("### 📊 Your pretend account right now")
        a1, a2, a3, a4 = st.columns(4)
        a1.metric("Total value", money(equity))
        a2.metric("Cash (not invested)", money(cash))
        a3.metric("In stocks", money(invested))
        day_pl = equity - float(acct.get("last_equity", equity))
        a4.metric("Today so far", money(day_pl), f"{day_pl / equity:+.2%}" if equity else "")

        hist = alpaca.portfolio_history("3M")
        if len(hist) > 1:
            fig_h = go.Figure(go.Scatter(x=hist.index, y=hist.values, line=dict(width=2)))
            fig_h.update_layout(title="Your pretend account over the last 3 months",
                                height=280, yaxis_tickprefix="$")
            st.plotly_chart(fig_h, use_container_width=True)

        if positions:
            st.markdown("**Stocks you own:**")
            rows = []
            for p in positions:
                pl = float(p["unrealized_pl"])
                rows.append({
                    "Stock": p["symbol"],
                    "Worth now": money(float(p["market_value"])),
                    "You paid": money(float(p["avg_entry_price"]) * float(p["qty"])),
                    "Profit/Loss": f"{money(pl)} ({float(p['unrealized_plpc']):+.1%})",
                })
            st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True)
        else:
            st.info("You don't own any stocks yet. Ask for today's plan below 👇")

        st.divider()
        st.markdown("### 🤖 Ask the strategy: *what should I do today?*")
        st.caption(
            'Runs the **"Follow the winners"** strategy (the recommended one from the '
            "time machine) on today's real prices, and explains its to-do list. "
            "Nothing happens until you press the buttons."
        )
        budget = st.number_input(
            "How much pretend money should the robot play with, total?",
            100, 100_000, 1000, 100,
            help="Paper accounts start with $100,000 — but you wanted to simulate $1,000, "
                 "so the robot will only ever use this much of it.")

        if st.button("🔍 Check today's plan", type="primary"):
            data_end = date.today().strftime("%Y-%m-%d")
            data_start = (pd.Timestamp(data_end) - pd.Timedelta(days=550)).strftime("%Y-%m-%d")
            tickers = tuple(get_universe("sp100"))
            with st.spinner("Getting fresh prices…"):
                live_data = fetch_data(tickers, data_start, data_end)
                spy_live = load_prices(BENCHMARK, data_start, data_end)
            held = {
                p["symbol"]: {
                    "entry": float(p["avg_entry_price"]),
                    "now": float(p["current_price"]),
                    "value": float(p["market_value"]),
                }
                for p in positions
            }
            new_money = max(0.0, budget - invested)
            st.session_state["plan"] = todays_plan(
                live_data, spy_live, held, new_money,
            )

        if "plan" in st.session_state:
            plan = st.session_state["plan"]
            (st.success if plan.market_healthy else st.warning)("🌦️ " + plan.market_note)
            for note in plan.notes:
                st.info(note)

            if not plan.sells and not plan.buys:
                st.success("✅ Nothing to do today — the current portfolio is exactly "
                           "what the strategy wants. Doing nothing is a decision too.")

            if plan.sells:
                st.markdown("**🔴 The strategy says SELL:**")
                for t, reason in plan.sells:
                    st.markdown(f"- **{t}** — {reason}")
            if plan.buys:
                st.markdown("**🟢 The strategy says BUY:**")
                for t, dollars, reason in plan.buys:
                    st.markdown(f"- **{t}** ({money(dollars)}) — {reason}")

            if plan.sells or plan.buys:
                st.caption("Orders placed outside US market hours (9:30–16:00 New York "
                           "time, Mon–Fri) simply wait and execute at the next open.")
                if st.button("✅ Yes — do all of this in my pretend account"):
                    results = []
                    for t, _ in plan.sells:
                        try:
                            alpaca.sell_all(t)
                            results.append(f"🔴 Sold {t}")
                        except Exception as e:
                            results.append(f"⚠️ Couldn't sell {t}: {e}")
                    for t, dollars, _ in plan.buys:
                        try:
                            alpaca.buy_notional(t, dollars)
                            results.append(f"🟢 Bought {money(dollars)} of {t}")
                        except Exception as e:
                            results.append(f"⚠️ Couldn't buy {t}: {e}")
                    for r in results:
                        st.write(r)
                    st.success("Done! Refresh the page in a minute to see your positions update.")
                    del st.session_state["plan"]

            with st.expander("🏆 See today's full strength ranking"):
                st.dataframe(plan.rankings, use_container_width=True, height=400)

        st.divider()
        st.markdown(
            "**💡 How to use this mode:** check the plan once a day or even once a "
            "week (this strategy moves slowly, that's by design). Watch the account "
            "chart grow — or not — and compare it with the time machine's promises. "
            "If after 1–2 months you trust it, *then* think about real money."
        )

# ================================================================ TAB 3: GLOSSARY
with tab_learn:
    st.subheader("Plain-English dictionary")
    st.markdown("""
| Word you'll see | What it actually means |
|---|---|
| **Strategy** | A fixed recipe of rules: what to buy, when, and when to sell. The robot follows it with zero emotions. |
| **Backtest / time machine** | Replaying the past with your rules to see what *would have* happened. Great for learning, but the past never repeats exactly. |
| **Paper trading** | Trading with pretend money on the real live market. A flight simulator for investing. |
| **Alpaca** | An American stock broker that programs can talk to. We use only its pretend-money (paper) mode. |
| **S&P 500 / SPY** | The 500 biggest US companies bundled together. "SPY" is the fund you'd buy to own the whole bundle at once — our "do nothing" comparison. |
| **Portfolio** | Simply: all the stocks you own right now. |
| **Position** | One stock you own. "5 positions" = you own 5 different stocks. |
| **Momentum** | The tendency of stocks that rose recently to keep rising for a while. Where money flows, more money follows. |
| **200-day average** | The average price over ~10 months. Above it = healthy weather. Below = storms happen — our robot stops buying. |
| **Stop loss** | An emergency exit: automatically sell if a stock falls X% below what you paid. Caps the damage of a bad pick. |
| **Trailing stop** | A give-back limit: sell if a stock falls X% from the *highest* point it reached — so winners can't turn into losers. |
| **Drawdown** | How far your total money fell from its best point. The -20% moments are where people panic and quit — know your number. |
| **Win rate** | % of trades that made money. Weirdly unimportant alone: 40% win rate is great if wins are 3× bigger than losses. |
| **Slippage** | Real fills are slightly worse than the printed price. We charge the robot for it so results stay honest. |
| **Rebalance** | Scheduled housekeeping: kick out stocks that no longer fit the rules, add ones that do. Ours does it monthly. |
| **Fractional shares** | Buying 0.3 of a share. Lets $1,000 spread across 5 stocks even when one share costs $800. |
""")
    st.markdown(
        "**The one lesson from all the research:** nobody beats the market with "
        "secret genius picks. The realistic goal is a simple, boring set of rules, "
        "followed with discipline, that wins *slightly* more than it loses — and "
        "safety rules that stop one bad month from wiping you out."
    )
