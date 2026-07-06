// Server-side daily strategy runner.
//
// Runs the SAME "Follow the winners" momentum rules the browser uses, but
// unattended: it fetches today's real prices, reads the current paper
// positions, decides what to buy/sell, and (unless dryRun) places the orders.
//
// Used by:
//   - functions/daily.mjs      (scheduled — every weekday morning)
//   - functions/run-daily.mjs  (manual HTTP trigger, for testing)
//
// SAFETY: hardcoded to the Alpaca PAPER endpoint. Keys come from the caller
// (Netlify environment variables), never from the repo.

import { SP100, BENCHMARK } from "../../web/js/universe.js";
import { parsePricesCsv } from "../../web/js/data.js";
import { yahooJsonToCsv } from "../functions/prices.mjs";
import { todaysPlan } from "../../web/js/advisor.js";

const PAPER = "https://paper-api.alpaca.markets/v2";
const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

const iso = (d) => d.toISOString().slice(0, 10);

async function alpaca(path, key, secret, opts = {}) {
  const r = await fetch(PAPER + path, {
    ...opts,
    headers: {
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
      "content-type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await r.text();
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { msg = JSON.parse(text).message || msg; } catch { /* keep */ }
    throw new Error(`${path}: ${msg}`);
  }
  return text ? JSON.parse(text) : null;
}

async function fetchYahoo(symbol, d1, d2) {
  const p1 = Math.floor(Date.parse(d1) / 1000);
  const p2 = Math.floor(Date.parse(d2) / 1000) + 86400;
  const url = `${YAHOO}${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}&interval=1d&events=div%2Csplit`;
  try {
    const r = await fetch(url, { headers: { "user-agent": UA } });
    if (!r.ok) return null;
    const csv = yahooJsonToCsv(await r.json());
    return csv ? parsePricesCsv(csv) : null;
  } catch { return null; }
}

// Download the whole universe with limited concurrency.
async function loadUniverse(d1, d2) {
  const data = new Map();
  const queue = [...SP100];
  const workers = Array.from({ length: 8 }, async () => {
    while (queue.length) {
      const s = queue.shift();
      const td = await fetchYahoo(s, d1, d2);
      if (td) data.set(s, td);
    }
  });
  await Promise.all(workers);
  const spy = await fetchYahoo(BENCHMARK, d1, d2);
  return { data, spy };
}

/**
 * Run one day of the strategy.
 * @param {object} o
 * @param {string} o.key      Alpaca paper API key id
 * @param {string} o.secret   Alpaca paper secret
 * @param {number} o.budget   Total dollars the strategy manages (e.g. 1000)
 * @param {boolean} o.dryRun  If true, decide but DON'T place orders
 * @param {boolean} o.requireOpen  If true, skip entirely when market is closed
 * @returns {object} summary
 */
export async function runDaily({ key, secret, budget = 1000, dryRun = false, requireOpen = false }) {
  const startedAt = new Date().toISOString();

  const clock = await alpaca("/clock", key, secret);
  if (requireOpen && !clock.is_open) {
    return { startedAt, skipped: true, reason: "market closed", marketOpen: false };
  }

  // Don't stack orders: if something is still queued, do nothing this run.
  const openOrders = await alpaca("/orders?status=open&limit=100", key, secret);
  if (openOrders.length) {
    return {
      startedAt, skipped: true, marketOpen: clock.is_open,
      reason: `${openOrders.length} order(s) still pending from a previous run`,
    };
  }

  const end = iso(new Date());
  const d1 = iso(new Date(Date.now() - 550 * 864e5));
  const { data, spy } = await loadUniverse(d1, end);
  if (!spy || data.size < 10) {
    throw new Error(`not enough price data (got ${data.size} symbols, spy=${!!spy})`);
  }

  const positions = await alpaca("/positions", key, secret);
  const held = {};
  let invested = 0;
  for (const p of positions) {
    held[p.symbol] = { entry: +p.avg_entry_price, now: +p.current_price, value: +p.market_value };
    invested += +p.market_value;
  }
  const freeBudget = Math.max(0, budget - invested);

  const plan = todaysPlan(data, spy, held, freeBudget);

  const summary = {
    startedAt,
    marketOpen: clock.is_open,
    marketHealthy: plan.marketHealthy,
    marketNote: plan.marketNote,
    budget, invested: Math.round(invested * 100) / 100,
    dryRun,
    sells: plan.sells.map(([t, r]) => ({ symbol: t, reason: r })),
    buys: plan.buys.map(([t, d, r]) => ({ symbol: t, dollars: d, reason: r })),
    executed: [],
    errors: [],
  };

  if (dryRun) return summary;

  // Sells first (frees cash), then buys.
  for (const [t] of plan.sells) {
    try {
      await alpaca(`/positions/${t}`, key, secret, { method: "DELETE" });
      summary.executed.push(`SELL ${t}`);
    } catch (e) { summary.errors.push(`sell ${t}: ${e.message}`); }
  }
  for (const [t, d] of plan.buys) {
    try {
      await alpaca("/orders", key, secret, {
        method: "POST",
        body: JSON.stringify({
          symbol: t, notional: d.toFixed(2),
          side: "buy", type: "market", time_in_force: "day",
        }),
      });
      summary.executed.push(`BUY $${d.toFixed(2)} ${t}`);
    } catch (e) { summary.errors.push(`buy ${t}: ${e.message}`); }
  }

  return summary;
}
