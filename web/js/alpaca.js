// Browser-side Alpaca client. Keys live ONLY in this browser's localStorage
// and travel through our /api/alpaca proxy, which is hardwired to the
// PAPER (pretend money) endpoint.

const KEY = "tradelab_alpaca_key";
const SECRET = "tradelab_alpaca_secret";

export const isConfigured = () =>
  !!(localStorage.getItem(KEY) && localStorage.getItem(SECRET));

export function saveKeys(key, secret) {
  localStorage.setItem(KEY, key.trim());
  localStorage.setItem(SECRET, secret.trim());
}

export function forgetKeys() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(SECRET);
}

async function api(path, opts = {}) {
  const r = await fetch("/api/alpaca" + path, {
    ...opts,
    headers: {
      "x-alpaca-key": localStorage.getItem(KEY) || "",
      "x-alpaca-secret": localStorage.getItem(SECRET) || "",
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { msg = (await r.json()).message || msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  return r.json();
}

export const getAccount = () => api("/account");
export const getPositions = () => api("/positions");
export const portfolioHistory = () =>
  api("/account/portfolio/history?period=3M&timeframe=1D");

export const buyNotional = (symbol, dollars) =>
  api("/orders", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      symbol,
      notional: dollars.toFixed(2),
      side: "buy",
      type: "market",
      time_in_force: "day",
    }),
  });

export const sellAll = (symbol) => api(`/positions/${symbol}`, { method: "DELETE" });
