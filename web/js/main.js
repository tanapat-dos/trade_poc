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

// ---------------- live practice (read-only showcase) ----------------
let liveInitDone = false;

async function initLive() {
  $("live-dash").hidden = false;
  if (liveInitDone) return;
  liveInitDone = true;
  await refreshAccount();
  // Keep the showcase fresh while the page is open.
  setInterval(refreshAccount, 60000);
}

async function refreshAccount() {
  refreshMarketAndOrders(); // market status + pending orders (independent)
  refreshDecisionLog();     // public daily decision log (independent)
  try {
    const [acct, positions, hist] = await Promise.all([
      alpaca.getAccount(), alpaca.getPositions(), alpaca.portfolioHistory(),
    ]);
    window._account = acct;
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

// Market open/closed banner, queued-order list, and the day-by-day log.
// Runs independently so a hiccup here never blanks the account view.
async function refreshMarketAndOrders() {
  try {
    const [clock, open] = await Promise.all([
      alpaca.getClock(), alpaca.getOpenOrders(),
    ]);
    window._marketOpen = !!clock.is_open;
    renderMarketClock(clock);

    // --- queued (pending) orders ---
    if (open.length) {
      const rows = open.map((o) => `<tr>
        <td class="${o.side === "buy" ? "up" : "down"}">${o.side === "buy" ? "🟢 BUY" : "🔴 SELL"}</td>
        <td><b>${o.symbol}</b></td>
        <td>${o.notional ? money(+o.notional) : (o.qty + " sh")}</td>
        <td>${o.status}</td></tr>`).join("");
      $("pending-orders").innerHTML =
        `<table><tr><th>Action</th><th>Stock</th><th>Amount</th><th>State</th></tr>${rows}</table>`;
      $("pending-card").hidden = false;
    } else {
      $("pending-card").hidden = true;
    }
  } catch (e) {
    $("market-status").innerHTML =
      `<div class="banner warn">Couldn't load market status: ${e.message}</div>`;
  }
}

// Public daily decision log: what the robot decided, why, and what it did.
async function refreshDecisionLog() {
  try {
    const r = await fetch("/api/log");
    const { entries } = await r.json();
    renderDecisionLog(entries || []);
  } catch (e) {
    $("activity-log").innerHTML = `<p class="hint">Couldn't load the log: ${e.message}</p>`;
  }
}

function renderDecisionLog(entries) {
  if (!entries.length) {
    $("activity-log").innerHTML = `<p class="hint">No entries yet. The robot writes one here automatically after each weekday run — the first will appear shortly after the next market open.</p>`;
    return;
  }
  const dayName = (d) => {
    try {
      return new Date(d + "T12:00:00Z").toLocaleDateString("en-US",
        { weekday: "long", month: "short", day: "numeric", year: "numeric" });
    } catch { return d; }
  };

  $("activity-log").innerHTML = entries.map((e) => {
    if (e.skipped) {
      return `<div class="log-day">
        <div class="log-head"><span class="log-date">${dayName(e.date)}</span>
          <span class="log-tag neutral">no action</span></div>
        <p class="hint">Skipped — ${e.reason || "nothing to do"}.</p></div>`;
    }
    const weather = e.marketHealthy
      ? `<span class="log-tag good">🌤️ market healthy</span>`
      : `<span class="log-tag warn">🌧️ market weak — buying paused</span>`;

    let body = e.marketNote ? `<p class="log-why">${e.marketNote}</p>` : "";

    if (e.sells?.length) {
      body += `<div class="log-section"><b>🔴 Sold</b>` +
        e.sells.map((s) => `<div class="plan-item"><b>${s.symbol}</b> — ${s.reason}</div>`).join("") +
        `</div>`;
    }
    if (e.buys?.length) {
      body += `<div class="log-section"><b>🟢 Bought</b>` +
        e.buys.map((b) => `<div class="plan-item"><b>${b.symbol}</b> (${money(b.dollars)}) — ${b.reason}</div>`).join("") +
        `</div>`;
    }
    for (const n of (e.notes || [])) body += `<p class="hint">• ${n}</p>`;
    if (!e.sells?.length && !e.buys?.length) {
      body += `<p class="hint">✅ Did nothing — the portfolio already matched the strategy. Doing nothing is a decision too.</p>`;
    }
    if (e.actions?.length) {
      body += `<div class="log-actions"><b>Actions placed:</b> ${e.actions.join(" · ")}</div>`;
    }
    for (const err of (e.errors || [])) body += `<div class="banner bad">⚠️ ${err}</div>`;

    return `<div class="log-day">
      <div class="log-head"><span class="log-date">${dayName(e.date)}</span>${weather}</div>
      ${body}</div>`;
  }).join("");
}

function fmtTime(iso) {
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: "America/New_York", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit",
    }) + " New York time";
  } catch { return iso; }
}

// ---------------- live market clock + countdown ----------------
let countdownTimer = null;

function renderMarketClock(clock) {
  const open = !!clock.is_open;
  const target = open ? clock.next_close : clock.next_open;
  $("market-status").innerHTML = `
    <div class="market-clock ${open ? "is-open" : "is-closed"}">
      <span class="mc-dot"></span>
      <div class="mc-main">
        <div class="mc-status">${open ? "Market is OPEN" : "Market is closed"}</div>
        <div class="mc-note">${open
          ? "Orders fill within seconds."
          : "Orders you place now queue and fill at the next open."}</div>
      </div>
      <div class="mc-timer">
        <div class="mc-timer-label">${open ? "Closes in" : "Opens in"}</div>
        <div class="mc-timer-value" id="mc-countdown">--:--:--</div>
        <div class="mc-timer-when">${fmtTime(target)}</div>
      </div>
    </div>`;
  startCountdown(target);
}

function startCountdown(targetIso) {
  if (countdownTimer) clearInterval(countdownTimer);
  const target = new Date(targetIso).getTime();
  const tick = () => {
    const el = $("mc-countdown");
    if (!el) { clearInterval(countdownTimer); return; }
    let diff = Math.floor((target - Date.now()) / 1000);
    if (diff <= 0) {
      el.textContent = "00:00:00";
      clearInterval(countdownTimer);
      // The market just flipped open/closed — pull fresh state after a beat.
      setTimeout(refreshAccount, 3000);
      return;
    }
    const d = Math.floor(diff / 86400); diff -= d * 86400;
    const h = Math.floor(diff / 3600); diff -= h * 3600;
    const m = Math.floor(diff / 60); const s = diff - m * 60;
    const pad = (n) => String(n).padStart(2, "0");
    el.textContent = (d > 0 ? `${d}d ` : "") + `${pad(h)}:${pad(m)}:${pad(s)}`;
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
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
    for (const p of positions) {
      held[p.symbol] = { entry: +p.avg_entry_price, now: +p.current_price, value: +p.market_value };
    }
    // Uninvested cash is what the strategy would deploy next — matches the
    // server-side auto-pilot's budget (start amount minus what's invested).
    const budget = Math.max(0, +(window._account?.cash) || 0);
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
    html += `<div class="banner good">✅ Nothing to do right now — the portfolio already matches what the strategy wants. Doing nothing is a decision too.</div>`;
  }
  if (plan.sells.length) {
    html += `<h4>🔴 The strategy would SELL:</h4>` +
      plan.sells.map(([t, r]) => `<div class="plan-item"><b>${t}</b> — ${r}</div>`).join("");
  }
  if (plan.buys.length) {
    html += `<h4>🟢 The strategy would BUY:</h4>` +
      plan.buys.map(([t, d, r]) => `<div class="plan-item"><b>${t}</b> (${money(d)}) — ${r}</div>`).join("");
  }
  if (plan.sells.length || plan.buys.length) {
    html += `<p class="hint">🤖 The auto-pilot places these automatically every weekday shortly after the open — no button to press. This is just a preview of its current thinking.</p>`;
  }
  html += `<details><summary>🏆 See the full strength ranking right now</summary><div class="table-wrap"><table>
    <tr><th>Rank</th><th>Stock</th><th>Past gain</th></tr>` +
    plan.rankings.map((r) => `<tr><td>#${r.rank}</td><td><b>${r.stock}</b></td><td class="${r.gain >= 0 ? "up" : "down"}">${pct(r.gain)}</td></tr>`).join("") +
    `</table></div></details>`;

  $("plan-output").innerHTML = html;
}

// Live practice is the landing tab — initialize it on load.
initLive();
