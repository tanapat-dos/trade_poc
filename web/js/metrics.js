// Performance numbers computed from the daily equity curve + trade list.

export function computeMetrics(equityVals, benchVals, trades) {
  const n = equityVals.length;
  const first = equityVals[0], last = equityVals[n - 1];
  const totalReturn = last / first - 1;
  const years = n / 252;
  const cagr = years > 0 ? Math.pow(last / first, 1 / years) - 1 : 0;

  const rets = [];
  for (let i = 1; i < n; i++) rets.push(equityVals[i] / equityVals[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1));
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(252) : 0;

  let peak = -Infinity, maxDD = 0;
  for (const v of equityVals) {
    peak = Math.max(peak, v);
    maxDD = Math.min(maxDD, v / peak - 1);
  }

  const closed = trades.filter((t) => t.exitDate !== null);
  const wins = closed.filter((t) => t.pnl > 0);
  const losses = closed.filter((t) => t.pnl <= 0);
  const grossWin = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));

  const benchTotal = benchVals.length ? benchVals[benchVals.length - 1] / benchVals[0] - 1 : 0;

  return {
    totalReturn, cagr, maxDD, sharpe,
    finalEquity: last,
    benchFinal: benchVals[benchVals.length - 1],
    vsBench: totalReturn - benchTotal,
    nClosed: closed.length,
    nOpen: trades.length - closed.length,
    winRate: closed.length ? wins.length / closed.length : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : Infinity,
    avgWin: wins.length ? wins.reduce((a, t) => a + t.pnlPct, 0) / wins.length : null,
    avgLoss: losses.length ? losses.reduce((a, t) => a + t.pnlPct, 0) / losses.length : null,
  };
}

// -> [{ month: "2025-07", ret: 0.071 }, ...]
export function monthlyReturns(equityDates, equityVals) {
  const lastOfMonth = new Map(); // "YYYY-MM" -> equity at month end
  for (let i = 0; i < equityDates.length; i++) {
    lastOfMonth.set(equityDates[i].slice(0, 7), equityVals[i]);
  }
  const months = [...lastOfMonth.keys()].sort();
  const out = [];
  let prev = equityVals[0];
  for (const m of months) {
    const v = lastOfMonth.get(m);
    out.push({ month: m, ret: v / prev - 1 });
    prev = v;
  }
  return out;
}

export function drawdownSeries(equityVals) {
  let peak = -Infinity;
  return equityVals.map((v) => {
    peak = Math.max(peak, v);
    return v / peak - 1;
  });
}
