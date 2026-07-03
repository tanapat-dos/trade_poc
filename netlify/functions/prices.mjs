// Price history proxy — the browser can't call Yahoo Finance directly (CORS),
// so this function fetches it, converts to simple CSV, and lets Netlify's CDN
// cache the result so Yahoo is hit rarely.
// GET /api/prices?symbol=AAPL&d1=2024-01-01&d2=2026-07-04

const YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

// Convert Yahoo chart JSON -> "Date,Open,High,Low,Close,Volume" CSV.
// Prices are dividend/split adjusted (like yfinance auto_adjust=True) so
// indicator math is consistent across corporate actions.
export function yahooJsonToCsv(js) {
  const res = js?.chart?.result?.[0];
  if (!res?.timestamp) return null;
  const ts = res.timestamp;
  const q = res.indicators?.quote?.[0] || {};
  const adj = res.indicators?.adjclose?.[0]?.adjclose || q.close;
  const lines = ["Date,Open,High,Low,Close,Volume"];
  for (let i = 0; i < ts.length; i++) {
    const c = q.close?.[i], a = adj?.[i];
    if (c == null || a == null || !isFinite(c) || c <= 0) continue;
    const f = a / c; // adjustment factor
    const d = new Date(ts[i] * 1000).toISOString().slice(0, 10);
    lines.push([
      d,
      (q.open[i] * f).toFixed(4),
      (q.high[i] * f).toFixed(4),
      (q.low[i] * f).toFixed(4),
      a.toFixed(4),
      q.volume?.[i] ?? 0,
    ].join(","));
  }
  return lines.length > 1 ? lines.join("\n") : null;
}

export default async (req) => {
  const u = new URL(req.url);
  const symbol = (u.searchParams.get("symbol") || "")
    .toUpperCase()
    .replace(/[^A-Z0-9.\-]/g, "");
  if (!symbol) return new Response("symbol required", { status: 400 });

  const d1 = u.searchParams.get("d1");
  const d2 = u.searchParams.get("d2");
  const period1 = d1 ? Math.floor(Date.parse(d1) / 1000) : 0;
  const period2 = d2
    ? Math.floor(Date.parse(d2) / 1000) + 86400
    : Math.floor(Date.now() / 1000);

  const url = `${YAHOO}${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplit`;
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) return new Response("upstream error", { status: 502 });

  const csv = yahooJsonToCsv(await r.json());
  if (!csv) return new Response("no data", { status: 404 });

  return new Response(csv, {
    headers: {
      "content-type": "text/csv",
      // browser caches 6h, Netlify CDN caches 6h -> Yahoo is hit rarely
      "cache-control": "public, max-age=21600",
      "netlify-cdn-cache-control": "public, max-age=21600",
    },
  });
};

export const config = { path: "/api/prices" };
