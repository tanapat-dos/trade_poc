// Read-only PUBLIC view of the OWNER's Alpaca paper account.
//
// Uses the server-side ALPACA_KEY / ALPACA_SECRET env vars, so visitors need
// no keys of their own. Only whitelisted GET reads are allowed — there is no
// way to place or cancel orders through this endpoint, so the link is safe to
// share as a live "here's how my robot is doing" showcase.

const PAPER = "https://paper-api.alpaca.markets/v2";

// Only these read paths are exposed publicly.
const ALLOW = [
  /^\/account$/,
  /^\/positions$/,
  /^\/account\/portfolio\/history$/,
  /^\/clock$/,
  /^\/orders$/,
];

const json = (obj, status = 200, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status, headers: { "content-type": "application/json", ...extra },
  });

export default async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return json({ message: "this endpoint is read-only" }, 405);
  }
  const key = process.env.ALPACA_KEY, secret = process.env.ALPACA_SECRET;
  if (!key || !secret) return json({ message: "showcase account not configured" }, 500);

  const u = new URL(req.url);
  const path = u.pathname.replace(/^\/api\/public/, "");
  if (!ALLOW.some((re) => re.test(path))) {
    return json({ message: "not allowed" }, 403);
  }

  const r = await fetch(PAPER + path + u.search, {
    headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret },
  });
  const body = await r.text();
  return new Response(body, {
    status: r.status,
    headers: {
      "content-type": "application/json",
      // brief CDN cache so a burst of viewers doesn't hammer Alpaca
      "cache-control": "public, max-age=20",
    },
  });
};

export const config = { path: "/api/public/*" };
