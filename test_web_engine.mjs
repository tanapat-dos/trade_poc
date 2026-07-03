// Node sanity check for the web engine: fetches real data from Yahoo using
// the SAME conversion the Netlify function uses, then runs the same momentum
// backtest the browser would. Compare ballpark vs the Python engine.
//   node test_web_engine.mjs

import { SP100 } from "./web/js/universe.js";
import { parsePricesCsv } from "./web/js/data.js";
import { yahooJsonToCsv } from "./netlify/functions/prices.mjs";
import { runBacktest } from "./web/js/engine.js";
import { computeMetrics, monthlyReturns } from "./web/js/metrics.js";
import { todaysPlan } from "./web/js/advisor.js";

const D1 = "2023-12-29", D2 = "2026-07-03";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

async function yahoo(symbol) {
  const p1 = Math.floor(Date.parse(D1) / 1000);
  const p2 = Math.floor(Date.parse(D2) / 1000) + 86400;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d`;
  try {
    const r = await fetch(url, { headers: { "user-agent": UA } });
    if (!r.ok) return null;
    const csv = yahooJsonToCsv(await r.json());
    return csv ? parsePricesCsv(csv) : null;
  } catch { return null; }
}

const data = new Map();
let done = 0;
const queue = [...SP100];
await Promise.all(Array.from({ length: 6 }, async () => {
  while (queue.length) {
    const s = queue.shift();
    const td = await yahoo(s);
    if (td) data.set(s, td);
    process.stdout.write(`\r${++done}/${SP100.length} downloaded`);
  }
}));
const spy = await yahoo("SPY");
console.log(`\nLoaded ${data.size} tickers, SPY rows: ${spy?.dates.length}`);

const cfg = {
  start: "2025-07-01", end: "2026-07-01", capital: 1000,
  lookbackDays: 126, skipDays: 21, topN: 5, holdRank: 10, rebalanceDays: 21,
  maxPositions: 5, positionPct: 20, stopLossPct: 15, trailingStopPct: 20,
  regimeFilter: true, slippageBps: 5,
};
const result = runBacktest(cfg, data, spy);
const m = computeMetrics(result.equityVals, result.benchVals, result.trades);

console.log("\n=== momentum-top5 (JS engine, yahoo data) ===");
console.log(`  Final equity      $${m.finalEquity.toFixed(2)} (${(m.totalReturn * 100).toFixed(1)}%)`);
console.log(`  vs SPY            ${(m.vsBench * 100).toFixed(1)}%`);
console.log(`  Max drawdown      ${(m.maxDD * 100).toFixed(1)}%`);
console.log(`  Sharpe            ${m.sharpe.toFixed(2)}`);
console.log(`  Trades            ${m.nClosed} closed / ${m.nOpen} open`);
console.log(`  Win rate          ${m.winRate == null ? "n/a" : (m.winRate * 100).toFixed(0) + "%"}`);
console.log(`  Profit factor     ${m.profitFactor.toFixed(2)}`);

console.log("\nMonthly:");
for (const { month, ret } of monthlyReturns(result.equityDates, result.equityVals)) {
  console.log(`  ${month}  ${(ret * 100).toFixed(1)}%`);
}

console.log("\nFirst 5 trades:");
for (const t of result.trades.slice(0, 5)) {
  console.log(`  ${t.ticker} ${t.entryDate} $${t.entryPrice.toFixed(2)} -> ${t.exitDate ?? "open"} ${t.reason}`);
}

const plan = todaysPlan(data, spy, {}, 1000);
console.log("\nAdvisor: market healthy =", plan.marketHealthy);
console.log("Buys:", plan.buys.map(([t, d]) => `${t} $${d}`).join(", "));
