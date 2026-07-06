// UI glue: tabs, time machine, live practice.

import { SP100, BENCHMARK } from "./universe.js";
import { fetchUniverse, fetchPrices } from "./data.js";
import { runBacktest } from "./engine.js";
import { computeMetrics, monthlyReturns, drawdownSeries } from "./metrics.js";
import { todaysPlan } from "./advisor.js";
import * as alpaca from "./alpaca.js";

const $ = (id) => document.getElementById(id);
const money = (x) => "$" + Number(x).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (x, digits = 1) => (x >= 0 ? "+" : "") + (x * 100).toFixed(digits) + "%";

const PLOT_LAYOUT = {
  paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
  font: { color: "#e6e9f0" }, margin: { l: 55, r: 20, t: 45, b: 40 },
  xaxis: { gridcolor: "#2c3447" }, yaxis: { gridcolor: "#2c3447" },
};

// ---------------- tabs ----------------
document.querySelectorAll(".tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    for (const name of ["back", "live", "learn"]) {
      $("tab-" + name).hidden = name !== btn.dataset.tab;
    }
    if (btn.dataset.tab === "live") initLive();
  });
});

// ---------------- defaults ----------------
const today = new Date();
const iso = (d) => d.toISOString().slice(0, 10);
$("end-date").value = iso(today);
$("start-date").value = iso(new Date(today.getTime() - 365 * 864e5));

// slider value labels
for (const [slider, label] of [
  ["lookback", "v-lookback"], ["topn", "v-topn"], ["holdrank", "v-holdrank"],
  ["rebal", "v-rebal"], ["stop", "v-stop"], ["trail", "v-trail"],
]) {
  $(slider).addEventListener("input", () => { $(label).textContent = $(slider).value; });
}

// ---------------- shared data cache ----------------
let cachedData = null, cachedSpy = null, cachedRange = "";

async function loadMarketData(d1, d2, progressEl) {
  const rangeKey = d1 + ":" + d2;
  if (cachedData && cachedRange === rangeKey) return { data: cachedData, spy: cachedSpy };
  progressEl.hidden = false;
  const data = await fetchUniverse(SP100, d1, d2, (done, total, sym) => {
    progressEl.textContent = `Downloading price history… ${done}/${total} (${sym}) — only slow the first time`;
  });
  progressEl.textContent = "Loading the S&P 500 benchmark…";
  const spy = await fetchPrices(BENCHMARK, d1, d2);
  progressEl.hidden = true;
  if (!spy || data.size < 10) throw new Error("Couldn't download enough price data — please try again in a minute.");
  cachedData = data; cachedSpy = spy; cachedRange = rangeKey;
  return { data, spy };
}

// ---------------- time machine ----------------
$("run-btn").addEventListener("click", async () => {
  const btn = $("run-btn");
  btn.disabled = true;
  try {
    const start = $("start-date").value, end = $("end-date").value;
    const warmup = new Date(new Date(start).getTime() - 550 * 864e5);
    const { data, spy } = await loadMarketData(iso(warmup), end, $("bt-progress"));

    const cfg = {
      start, end,
      capital: +$("capital").value || 1000,
      lookbackDays: +$("lookback").value * 21,
      skipDays: 21,
      topN: +$("topn").value,
      holdRank: +$("holdrank").value,
      rebalanceDays: +$("rebal").value,
      maxPositions: +$("topn").value,
      positionPct: Math.floor(100 / +$("topn").value),
      stopLossPct: +$("stop").value,
      trailingStopPct: +$("trail").value,
      regimeFilter: $("regime").checked,
      slippageBps: 5,
    };
    const result = runBacktest(cfg, data, spy);
    renderBacktest(cfg, result);
  } catch (e) {
    console.error("backtest failed:", e);
    $("bt-progress").hidden = false;
    $("bt-progress").innerHTML = `<div class="banner bad">${e.message}</div>`;
  } finally {
    btn.disabled = false;
  }
});

function renderBacktest(cfg, result) {
  const m = computeMetrics(result.equityVals, result.benchVals, result.trades);
  $("bt-results").hidden = false;

  const beat = m.finalEquity - m.benchFinal;
  $("verdict-banner").innerHTML = beat >= 0
    ? `<div class="banner good">✅ The robot beat "do nothing" (just buying the S&amp;P 500) by <b>${money(beat)}</b>.</div>`
    : `<div class="banner bad">❌ The robot LOST to "do nothing" by <b>${money(-beat)}</b> — in this period, just buying the S&amp;P 500 was better.</div>`;

  $("metric-cards").innerHTML = [
    card("Your money would now be", money(m.finalEquity), pct(m.totalReturn), m.totalReturn >= 0),
    card("If you'd just bought the S&P 500", money(m.benchFinal), "the “do nothing” option"),
    card("Scariest moment", pct(m.maxDD), "biggest fall from a high — would you have panicked?", false),
    card("Trades that made money", m.winRate == null ? "–" : Math.round(m.winRate * 100) + "%",
      `${m.nClosed} finished, ${m.nOpen} still open`),
  ].join("");

  $("bt-warnings").innerHTML = result.warnings
    .map((w) => `<div class="banner warn">⚠️ ${w}</div>`).join("");

  Plotly.newPlot("chart-equity", [
    { x: result.equityDates, y: result.equityVals, name: "Robot strategy", line: { width: 2.5, color: "#4f8ef7" } },
    { x: result.equityDates, y: result.benchVals, name: "Do nothing (buy S&P 500)", line: { width: 1.5, dash: "dash", color: "#9aa3b5" } },
  ], { ...PLOT_LAYOUT, title: "Your money, day by day", legend: { orientation: "h", y: 1.12 } }, { responsive: true, displayModeBar: false });

  const months = monthlyReturns(result.equityDates, result.equityVals);
  $("monthly-table").innerHTML = `<div class="month-grid">` + months.map((x) => {
    const bg = x.ret >= 0 ? "rgba(46,204,113,.25)" : "rgba(231,76,60,.25)";
    return `<div class="month-cell" style="background:${bg}"><div class="m">${x.month}</div><div class="r">${pct(x.ret)}</div></div>`;
  }).join("") + `</div>`;

  Plotly.newPlot("chart-dd", [
    { x: result.equityDates, y: drawdownSeries(result.equityVals), fill: "tozeroy", line: { color: "#e74c3c", width: 1 } },
  ], { ...PLOT_LAYOUT, title: "Pain meter (how far below the best point)", yaxis: { ...PLOT_LAYOUT.yaxis, tickformat: ".0%" } }, { responsive: true, displayModeBar: false });

  const rows = result.trades.map((t) => `<tr>
    <td><b>${t.ticker}</b></td><td>${t.entryDate}</td><td>${money(t.entryPrice)}</td>
    <td>${t.exitDate ?? "still holding"}</td><td>${t.exitPrice ? money(t.exitPrice) : "–"}</td>
    <td class="${t.pnl > 0 ? "up" : t.pnl != null ? "down" : ""}">${t.pnl != null ? money(t.pnl) + " (" + pct(t.pnlPct) + ")" : "–"}</td>
    <td>${t.reason || ""}</td></tr>`).join("");
  $("trades-table").innerHTML = `<table><tr><th>Stock</th><th>Bought</th><th>Paid</th><th>Sold</th><th>Got</th><th>Profit/Loss</th><th>Why it sold</th></tr>${rows}</table>`;
}

function card(label, value, sub = "", up = null) {
  const cls = up === null ? "" : up ? "up" : "down";
  return `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div><div class="sub ${cls}">${sub}</div></div>`;
}

// ---------------- live practice ----------------
let liveInitDone = false;

async function initLive() {
  if (!alpaca.isConfigured()) {
    $("live-setup").hidden = false;
    $("live-dash").hidden = true;
    return;
  }
  $("live-setup").hidden = true;
  $("live-dash").hidden = false;
  if (liveInitDone) return;
  liveInitDone = true;
  await refreshAccount();
}

$("connect-btn").addEventListener("click", async () => {
  const btn = $("connect-btn");
  const key = $("alpaca-key").value.trim(), secret = $("alpaca-secret").value.trim();
  if (!key || !secret) { $("connect-msg").innerHTML = `<div class="banner bad">Please paste both keys.</div>`; return; }

  // Saving to localStorage can throw (Safari private mode / storage blocked).
  try {
    alpaca.saveKeys(key, secret);
  } catch (e) {
    $("connect-msg").innerHTML = `<div class="banner bad">Your browser is blocking local storage, so the keys can't be saved. Turn off private/incognito mode (or allow site data) and try again. (${e.message})</div>`;
    return;
  }

  btn.disabled = true;
  $("connect-msg").innerHTML = `<div class="banner">Connecting to Alpaca…</div>`;
  try {
    await alpaca.getAccount();
    $("connect-msg").innerHTML = `<div class="banner good">Connected! 🎉</div>`;
    liveInitDone = false;
    initLive();
  } catch (e) {
    alpaca.forgetKeys();
    $("connect-msg").innerHTML = `<div class="banner bad">Keys were rejected — double-check you copied the <b>Paper</b> keys. (${e.message})</div>`;
  } finally {
    btn.disabled = false;
  }
});

$("forget-btn").addEventListener("click", () => {
  alpaca.forgetKeys();
  liveInitDone = false;
  initLive();
});

async function refreshAccount() {
  try {
    const [acct, positions, hist] = await Promise.all([
      alpaca.getAccount(), alpaca.getPositions(), alpaca.portfolioHistory(),
    ]);
    window._positions = positions;

    const equity = +acct.equity, cash = +acct.cash;
    const dayPl = equity - +(acct.last_equity || equity);
    $("account-cards").innerHTML = [
      card("Total value", money(equity)),
      card("Cash (not invested)", money(cash)),
      card("In stocks", money(equity - cash)),
      card("Today so far", money(dayPl), equity ? pct(dayPl / equity, 2) : "", dayPl >= 0),
    ].join("");

    if (hist?.timestamp?.length > 1) {
      const dates = hist.timestamp.map((t) => new Date(t * 1000));
      Plotly.newPlot("chart-account", [
        { x: dates, y: hist.equity, line: { width: 2, color: "#4f8ef7" } },
      ], { ...PLOT_LAYOUT, title: "Your pretend account — last 3 months" }, { responsive: true, displayModeBar: false });
    } else {
      $("chart-account").innerHTML = `<p class="hint">The account chart appears after your first day of trading.</p>`;
    }

    if (positions.length) {
      const rows = positions.map((p) => {
        const pl = +p.unrealized_pl;
        return `<tr><td><b>${p.symbol}</b></td>
          <td>${money(+p.market_value)}</td>
          <td>${money(+p.avg_entry_price * +p.qty)}</td>
          <td class="${pl >= 0 ? "up" : "down"}">${money(pl)} (${pct(+p.unrealized_plpc)})</td></tr>`;
      }).join("");
      $("positions-table").innerHTML = `<table><tr><th>Stock</th><th>Worth now</th><th>You paid</th><th>Profit/Loss</th></tr>${rows}</table>`;
    } else {
      $("positions-table").innerHTML = `<p class="hint">You don't own any stocks yet — ask for today's plan below 👇</p>`;
    }
  } catch (e) {
    $("account-cards").innerHTML = `<div class="banner bad">Couldn't reach Alpaca: ${e.message}</div>`;
  }
}

$("plan-btn").addEventListener("click", async () => {
  const btn = $("plan-btn");
  btn.disabled = true;
  try {
    const end = iso(new Date());
    const warmup = iso(new Date(Date.now() - 550 * 864e5));
    const { data, spy } = await loadMarketData(warmup, end, $("plan-progress"));

    const positions = window._positions || [];
    const held = {};
    let invested = 0;
    for (const p of positions) {
      held[p.symbol] = { entry: +p.avg_entry_price, now: +p.current_price, value: +p.market_value };
      invested += +p.market_value;
    }
    const budget = Math.max(0, (+$("budget").value || 1000) - invested);
    const plan = todaysPlan(data, spy, held, budget);
    renderPlan(plan);
  } catch (e) {
    $("plan-output").innerHTML = `<div class="banner bad">${e.message}</div>`;
  } finally {
    btn.disabled = false;
  }
});

function renderPlan(plan) {
  let html = `<div class="banner ${plan.marketHealthy ? "good" : "warn"}">🌦️ ${plan.marketNote}</div>`;
  for (const n of plan.notes) html += `<div class="banner warn">${n}</div>`;

  if (!plan.sells.length && !plan.buys.length) {
    html += `<div class="banner good">✅ Nothing to do today — the portfolio is exactly what the strategy wants. Doing nothing is a decision too.</div>`;
  }
  if (plan.sells.length) {
    html += `<h4>🔴 The strategy says SELL:</h4>` +
      plan.sells.map(([t, r]) => `<div class="plan-item"><b>${t}</b> — ${r}</div>`).join("");
  }
  if (plan.buys.length) {
    html += `<h4>🟢 The strategy says BUY:</h4>` +
      plan.buys.map(([t, d, r]) => `<div class="plan-item"><b>${t}</b> (${money(d)}) — ${r}</div>`).join("");
  }
  if (plan.sells.length || plan.buys.length) {
    html += `<p class="hint">Orders placed outside US market hours (9:30–16:00 New York time, Mon–Fri) simply wait and execute at the next open.</p>
      <button id="execute-btn" class="primary">✅ Yes — do all of this in my pretend account</button>`;
  }
  html += `<details><summary>🏆 See today's full strength ranking</summary><div class="table-wrap"><table>
    <tr><th>Rank</th><th>Stock</th><th>Past gain</th></tr>` +
    plan.rankings.map((r) => `<tr><td>#${r.rank}</td><td><b>${r.stock}</b></td><td class="${r.gain >= 0 ? "up" : "down"}">${pct(r.gain)}</td></tr>`).join("") +
    `</table></div></details>`;

  $("plan-output").innerHTML = html;

  const exec = $("execute-btn");
  if (exec) exec.addEventListener("click", async () => {
    exec.disabled = true;
    const log = [];
    for (const [t] of plan.sells) {
      try { await alpaca.sellAll(t); log.push(`🔴 Sold ${t}`); }
      catch (e) { log.push(`⚠️ Couldn't sell ${t}: ${e.message}`); }
    }
    for (const [t, d] of plan.buys) {
      try { await alpaca.buyNotional(t, d); log.push(`🟢 Bought ${money(d)} of ${t}`); }
      catch (e) { log.push(`⚠️ Couldn't buy ${t}: ${e.message}`); }
    }
    $("plan-output").innerHTML = log.map((l) => `<div class="plan-item">${l}</div>`).join("") +
      `<div class="banner good">Done! Your positions will update in a minute.</div>`;
    setTimeout(refreshAccount, 3000);
  });
}
