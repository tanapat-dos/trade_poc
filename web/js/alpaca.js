// Read-only client for the OWNER's Alpaca paper account.
//
// Everything goes through /api/public, a server-side proxy that uses the
// owner's keys (stored in Netlify env vars) and only permits GET reads. The
// browser never holds any keys and cannot place or cancel orders — this is a
// public "watch how the robot is doing" showcase.

async function api(path) {
  const r = await fetch("/api/public" + path);
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
export const getClock = () => api("/clock");
export const getOpenOrders = () => api("/orders?status=open&limit=100");
