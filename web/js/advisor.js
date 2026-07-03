// "What should I do today?" — runs the momentum rules on the latest real
// prices and produces a plain-English to-do list. Mirrors tradelab/advisor.py.

import { smaArr } from "./engine.js";

export function todaysPlan(data, spy, held, budget, opts = {}) {
  const {
    topN = 5, lookbackDays = 126, skipDays = 21,
    holdRank = 10, stopLossPct = 15,
  } = opts;

  const plan = { marketHealthy: true, marketNote: "", sells: [], buys: [], notes: [], rankings: [] };

  // 1. Market health (200-day rule)
  const spySma = smaArr(spy.c, 200);
  const last = spy.c.length - 1;
  const spyNow = spy.c[last], smaNow = spySma[last];
  plan.marketHealthy = smaNow != null && spyNow > smaNow;
  const pct = smaNow ? spyNow / smaNow - 1 : 0;
  plan.marketNote = plan.marketHealthy
    ? `The overall market (S&P 500) is ${(pct * 100).toFixed(1)}% above its 200-day average — healthy. New buying is allowed.`
    : `The overall market (S&P 500) is ${(pct * 100).toFixed(1)}% BELOW its 200-day average — storm warning. The strategy stops buying and waits in cash.`;

  // 2. Strength ranking
  const scored = [];
  for (const [t, td] of data) {
    const i = td.c.length - 1;
    const j = i - skipDays, k = i - skipDays - lookbackDays;
    if (k < 0) continue;
    scored.push([t, td.c[j] / td.c[k] - 1]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  const ranks = new Map();
  scored.forEach(([t], i) => ranks.set(t, i + 1));
  plan.rankings = scored.map(([t, s], i) => ({ rank: i + 1, stock: t, gain: s }));

  // 3. What to sell
  for (const [t, info] of Object.entries(held)) {
    const rank = ranks.get(t);
    const loss = info.entry ? info.now / info.entry - 1 : 0;
    if (loss <= -stopLossPct / 100) {
      plan.sells.push([t, `down ${(loss * 100).toFixed(0)}% from where you bought — safety rule says cut losses at -${stopLossPct}%`]);
    } else if (rank == null) {
      plan.sells.push([t, "no longer in the tracked stock list"]);
    } else if (rank > holdRank) {
      plan.sells.push([t, `dropped to #${rank} in the strength ranking (we only keep stocks in the top ${holdRank})`]);
    }
  }

  // 4. What to buy
  const selling = new Set(plan.sells.map(([t]) => t));
  const keeping = Object.keys(held).filter((t) => !selling.has(t));
  const slots = topN - keeping.length;
  if (!plan.marketHealthy) {
    plan.notes.push("No buys today — waiting for the market to get healthy again.");
  } else if (slots <= 0) {
    plan.notes.push("Portfolio is already full — nothing to buy.");
  } else {
    const freed = [...selling].reduce((a, t) => a + (held[t]?.value || 0), 0);
    const perPosition = (budget + freed) / slots;
    const candidates = plan.rankings
      .slice(0, topN)
      .map((r) => r.stock)
      .filter((t) => !keeping.includes(t) && !selling.has(t));
    for (const t of candidates.slice(0, slots)) {
      const r = plan.rankings.find((x) => x.stock === t);
      plan.buys.push([t, Math.round(perPosition * 100) / 100,
        `currently #${r.rank} strongest stock (${(r.gain * 100).toFixed(1)}% over the lookback period)`]);
    }
  }
  return plan;
}
