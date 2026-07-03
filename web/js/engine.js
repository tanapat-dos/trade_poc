// The "follow the winners" (momentum) backtest engine — JavaScript port of
// tradelab/engine.py + the momentum strategy, with the same honesty rules:
//   * decisions use a day's CLOSE, orders execute at the NEXT day's OPEN
//   * every fill pays slippage
//   * safety exits check the day's actual LOW; gaps fill at the open
//   * new buys are blocked while the S&P 500 is below its 200-day average

export function smaArr(values, window) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= window) sum -= values[i - window];
    if (i >= window - 1) out[i] = sum / window;
  }
  return out;
}

export function runBacktest(cfg, data, spy) {
  const {
    start, end, capital,
    lookbackDays, skipDays, topN, holdRank, rebalanceDays,
    maxPositions, positionPct, stopLossPct, trailingStopPct,
    regimeFilter, slippageBps,
  } = cfg;
  const slip = slippageBps / 10000;

  // Trading calendar = SPY dates inside the window.
  const cal = [];
  for (let i = 0; i < spy.dates.length; i++) {
    if (spy.dates[i] >= start && spy.dates[i] <= end) cal.push(i);
  }
  if (cal.length < 10) throw new Error("Backtest window too short / no benchmark data.");
  const spySma = smaArr(spy.c, 200);

  const bar = (t, d) => {
    const td = data.get(t);
    if (!td) return null;
    const i = td.idx.get(d);
    return i == null ? null : { o: td.o[i], h: td.h[i], l: td.l[i], c: td.c[i] };
  };

  const rankAll = (d) => {
    const scored = [];
    for (const [t, td] of data) {
      const i = td.idx.get(d);
      if (i == null) continue;
      const j = i - skipDays, k = i - skipDays - lookbackDays;
      if (k < 0) continue;
      scored.push([t, td.c[j] / td.c[k] - 1]);
    }
    scored.sort((a, b) => b[1] - a[1]);
    const ranks = new Map();
    scored.forEach(([t], i) => ranks.set(t, i + 1));
    return ranks;
  };

  let cash = capital;
  const positions = new Map();
  const trades = [];
  const equityDates = [], equityVals = [];
  let pendingBuys = [];
  const pendingSells = new Map();
  let lastRebalIdx = null;
  let currentRanks = null;

  const closePos = (t, d, price, reason) => {
    const p = positions.get(t);
    positions.delete(t);
    const fill = price * (1 - slip);
    cash += p.shares * fill;
    const tr = trades.find((x) => x.ticker === t && x.exitDate === null);
    if (tr) {
      tr.exitDate = d;
      tr.exitPrice = fill;
      tr.pnl = (fill - tr.entryPrice) * tr.shares;
      tr.pnlPct = fill / tr.entryPrice - 1;
      tr.reason = reason;
    }
  };

  for (let k = 0; k < cal.length; k++) {
    const spyI = cal[k];
    const d = spy.dates[spyI];

    // 1. Execute yesterday's sell decisions at today's open
    for (const [t, reason] of pendingSells) {
      const b = bar(t, d);
      if (b && positions.has(t)) closePos(t, d, b.o, reason);
    }
    pendingSells.clear();

    // ...then yesterday's buy decisions
    for (const t of pendingBuys) {
      if (positions.has(t) || positions.size >= maxPositions) continue;
      const b = bar(t, d);
      if (!b) continue;
      let port = cash;
      for (const [pt, p] of positions) {
        const pb = bar(pt, d);
        port += p.shares * (pb ? pb.c : p.highWater);
      }
      const budget = Math.min((port * positionPct) / 100, cash);
      const fill = b.o * (1 + slip);
      const shares = budget / fill;
      if (shares <= 0 || shares * fill > cash + 1e-9) continue;
      cash -= shares * fill;
      positions.set(t, { entryDate: d, entryPrice: fill, shares, highWater: fill, daysHeld: 0 });
      trades.push({ ticker: t, entryDate: d, entryPrice: fill, shares, exitDate: null, exitPrice: null, pnl: null, pnlPct: null, reason: "" });
    }
    pendingBuys = [];

    // 2. Safety exits — check stops against today's actual low
    for (const [t, p] of [...positions]) {
      const b = bar(t, d);
      if (!b) continue;
      const stops = [];
      if (stopLossPct > 0) stops.push(p.entryPrice * (1 - stopLossPct / 100));
      if (trailingStopPct > 0) stops.push(p.highWater * (1 - trailingStopPct / 100));
      if (!stops.length) continue;
      const stop = Math.max(...stops);
      if (b.l <= stop) closePos(t, d, Math.min(b.o, stop), `safety exit at $${stop.toFixed(2)}`);
    }

    // 3. End of day: mark to market, update high-water marks
    let port = cash;
    for (const [t, p] of positions) {
      const b = bar(t, d);
      if (b) {
        p.highWater = Math.max(p.highWater, b.c);
        p.daysHeld++;
        port += p.shares * b.c;
      } else {
        port += p.shares * p.highWater;
      }
    }
    equityDates.push(d);
    equityVals.push(port);

    // Strategy exits: holdings that fell down the strength ranking
    if (currentRanks) {
      for (const [t] of positions) {
        const r = currentRanks.get(t);
        if (r == null || r > holdRank) {
          pendingSells.set(t, `dropped to #${r ?? "–"} in the strength ranking (limit ${holdRank})`);
        }
      }
    }

    // Strategy entries: monthly re-rank, only in a healthy market
    const regimeOK = !regimeFilter || (spySma[spyI] != null && spy.c[spyI] > spySma[spyI]);
    if (regimeOK) {
      const slots = maxPositions - (positions.size - pendingSells.size);
      const due = lastRebalIdx === null || k - lastRebalIdx >= rebalanceDays;
      if (slots > 0 && due) {
        lastRebalIdx = k;
        currentRanks = rankAll(d);
        const cands = [...currentRanks.entries()]
          .filter(([, r]) => r <= topN)
          .sort((a, b) => a[1] - b[1])
          .map(([t]) => t)
          .filter((t) => !positions.has(t) && !pendingSells.has(t));
        pendingBuys = cands.slice(0, slots);
      }
    }
  }

  // Benchmark: buy SPY at the first day's open with the same money + slippage
  const firstI = cal[0];
  const spyFill = spy.o[firstI] * (1 + slip);
  const benchVals = cal.map((i) => (spy.c[i] * capital) / spyFill);

  const warnings = [];
  const closed = trades.filter((t) => t.exitDate !== null);
  if (closed.length < 30) {
    warnings.push(`Only ${closed.length} finished trades — that's a small sample; ` +
      "test a longer period before trusting the result.");
  }
  warnings.push("The stock list is today's giants — companies that collapsed in the " +
    "past aren't included, so multi-year results look rosier than reality.");

  return { equityDates, equityVals, benchVals, trades, warnings };
}
