# TradeLab — test trading ideas safely

A plain-English lab for S&P 500 swing-trading strategies, in two modes:

- 🕰️ **Time machine (backtest)** — replay the past year and see what your
  $1,000 *would have* become under a set of rules.
- 📡 **Live practice (paper trading)** — a pretend-money account on **Alpaca**
  that follows the same rules on the **real, live market**. Real prices, fake
  money, zero risk. The app is hard-wired to Alpaca's paper endpoint and
  physically cannot place real-money trades.

Built for a **$1,000 account, 1–3 month holding horizon**, graded monthly
(daily ups and downs are fine; the month should end green).

TradeLab exists in **two flavors** that share the same logic:

| | Where it runs | Best for |
|---|---|---|
| **Web version** (`web/` + `netlify/`) | Netlify — or locally with `node dev_server.mjs` | Testing from anywhere, phone included; deploy once, use forever |
| **Python version** (`app.py` + `tradelab/`) | Your machine (Streamlit) | Tinkering with strategy code, adding new strategies |

## Deploy to Netlify (the web version)

No build step, no npm packages — just static files plus two tiny functions.

**Option A — with the Netlify CLI (fastest):**
```bash
npx netlify-cli login     # opens browser, one time
npx netlify-cli init      # create the site, one time
npx netlify-cli deploy --prod
```

**Option B — via GitHub:** push this folder to a GitHub repo, then in
[app.netlify.com](https://app.netlify.com) → *Add new site* → *Import an
existing project* → pick the repo. `netlify.toml` tells Netlify everything
(publish `web/`, functions in `netlify/functions/`). No build command needed.

**Test locally first** (mimics Netlify exactly):
```bash
node dev_server.mjs       # -> http://localhost:8888
```

How it works: the backtest engine runs **in the visitor's browser**; the two
serverless functions just (1) proxy Yahoo Finance price data with CDN caching
and (2) forward Alpaca calls to the **paper-trading endpoint only** (hardcoded
— the site cannot touch real money). Alpaca keys are stored in the visitor's
own browser (localStorage), never on the server.

## Quick start (the Python version)

```bash
# one-time setup
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# the app (both modes live here)
.venv/bin/streamlit run app.py

# or run a backtest config from the command line
.venv/bin/python run_backtest.py configs/momentum.yaml
```

First run downloads ~2 years of daily prices for ~110 large caps (about a
minute) and caches them in `data_cache/` — after that everything is instant.

## What is Alpaca? (the 30-second version)

[Alpaca](https://alpaca.markets) is a US stock broker designed for programs:
instead of tapping buttons in an app, your code says "buy $200 of AAPL" over
an API. Its free **paper trading** account is a flight simulator — live market
data, pretend money. Sign up free (no deposit needed), flip the dashboard
switch to **Paper**, generate API keys, and paste them into the app's Live
Practice tab. Keys are stored in a local `.env` file that git ignores.

Daily routine once connected: open the Live tab → **Check today's plan** →
read the robot's to-do list (with reasons) → click execute if you agree. The
strategy is slow by design; once a day or even once a week is plenty.

## The strategies

| Strategy | Idea | Horizon | Fit for you |
|---|---|---|---|
| **momentum** | Buy the 5 strongest stocks of the last 6 months, rebalance monthly — "follow the flow" | 1–3 months | ⭐ recommended |
| **sma_cross** | Buy 20/50-day moving-average upcrosses, sell downcrosses | weeks–months | good |
| **breakout** | Buy new 55-day highs, exit 20-day lows (turtle style) | weeks–months | good |
| **rsi_dip** | Buy short-term panic in uptrends, sell the bounce | 2–10 days | comparison only |

**Why momentum is the "follow good traders" strategy:** you can't see other
traders' orders, but you *can* see where the winners' money already went —
price strength. Cross-sectional momentum (Jegadeesh & Titman 1993, and ~30
years of follow-up research) is the most-replicated version of "follow the
smart flow": stocks that beat the market over the last 3–12 months tend to
keep doing so over the next 1–3 months. A more literal version — cloning
hedge-fund 13F filings from SEC data — is a possible v2 (see roadmap).

## Risk rules (all configurable)

- **Regime filter** — only buy when SPY > its 200-day average. The single most
  protective rule in the literature: roughly halves historical drawdowns by
  keeping you out of bear markets.
- **Position sizing** — default 20% of equity per position, max 5 positions.
- **Trailing stop** — default 20% (wide on purpose: research consistently shows
  tight stops shake momentum strategies out of their winners).
- **Fixed stop** — default 15% hard floor per position.
- **Slippage** — every fill pays 5 bps by default. No free lunches.

## How the engine stays honest

1. **No lookahead** — signals are computed on day T's close and execute at day
   T+1's open. You can never trade on information you wouldn't have had.
2. **Stops use real lows** — a stop "fires" only if the day's actual low
   touched it, and gap-downs fill at the open, not at your stop price.
3. **SPY benchmark always shown** — a strategy is only good if it beats doing
   nothing (buying SPY and going fishing).
4. **Warnings** — the app flags low trade counts (statistically meaningless)
   and the survivorship bias in using today's index members.

### Known limitations (read before trusting long backtests)

- The universe is ~110 of **today's** biggest stocks. Companies that collapsed
  out of the index are missing, which flatters multi-year results
  (survivorship bias). Fine for 1–2 year tests, optimistic for 10-year ones.
- Daily bars only — intraday moves between open/low/close are approximated.
- If one parameter set looks amazing and its neighbors don't, it's noise, not
  edge. Prefer settings that work across a *range* of values.

## Changing the logic

- **Tweak parameters**: sliders in the app, or edit `configs/*.yaml`.
- **New strategy**: subclass `Strategy` in [strategies.py](tradelab/strategies.py),
  implement `entry_candidates()` and `wants_exit()`, add it to `STRATEGIES`.
  The engine and UI pick it up automatically.
- **New risk rule**: engine loop in [engine.py](tradelab/engine.py) — it's ~200
  readable lines, on purpose (no black-box library).

## Project layout

```
netlify.toml            Netlify config (publish web/, functions)
web/                    ── THE NETLIFY-DEPLOYABLE WEB APP ──
  index.html            Time machine + live practice + glossary
  style.css
  js/engine.js          Momentum backtester (browser port, validated vs Python)
  js/advisor.js         "What should I do today?" live plan
  js/alpaca.js          Browser Alpaca client (keys in localStorage)
  js/data.js, metrics.js, universe.js, main.js
netlify/functions/
  prices.mjs            Yahoo Finance proxy with CDN caching
  alpaca.mjs            Alpaca proxy — paper endpoint HARDCODED
dev_server.mjs          Local Netlify imitation (node dev_server.mjs)
test_web_engine.mjs     Engine validation script (node test_web_engine.mjs)

app.py                  ── THE PYTHON/STREAMLIT VERSION ──
run_backtest.py         CLI runner (YAML-config driven)
configs/                Ready-made strategy configs
tradelab/
  universe.py           S&P 100 ticker list
  data.py               yfinance download + CSV cache
  indicators.py         SMA, RSI, momentum, ATR, Donchian
  strategies.py         The strategy library — add yours here
  engine.py             Daily event-loop backtester
  metrics.py            CAGR, drawdown, Sharpe, monthly report card
  alpaca.py             Alpaca PAPER account connector (paper URL hardcoded)
  advisor.py            "What should I do today?" — live momentum plan
data_cache/             Cached price CSVs (delete to force refresh)
.env                    Your Alpaca paper keys (gitignored, created by the app)
```

## Roadmap ideas

- **13F cloning strategy** — literally follow top hedge funds via free SEC
  EDGAR data (45-day filing lag is OK for low-turnover managers).
- **Insider cluster-buying overlay** — free Form 4 data; buying clusters by
  multiple executives historically add ~5–10% annualized signal.
- Parameter sweep view — heatmap of results across a parameter grid.
- Walk-forward split — auto in-sample/out-of-sample validation.
- ~~Paper-trading bridge~~ ✅ done — the Live Practice tab.
- Scheduled daily check — run the "today's plan" automatically every market
  morning and notify (the Opus 4.7 setup-guide PDF describes the fully
  autonomous cloud-routine version of this).
