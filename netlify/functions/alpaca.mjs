// Alpaca PAPER trading proxy.
//
// SAFETY: the paper-trading URL is hardcoded — this function can only ever
// reach the pretend-money account, never a real-money one.
//
// The user's API keys are stored in THEIR browser (localStorage) and sent
// along with each request; this function just forwards them. Nothing is
// stored server-side.

const PAPER = "https://paper-api.alpaca.markets/v2";

export default async (req) => {
  const u = new URL(req.url);
  const path = u.pathname.replace(/^\/api\/alpaca/, "");
  const key = req.headers.get("x-alpaca-key") || "";
  const secret = req.headers.get("x-alpaca-secret") || "";
  if (!key || !secret) {
    return new Response(JSON.stringify({ message: "missing API keys" }), {
      status: 401, headers: { "content-type": "application/json" },
    });
  }

  const init = {
    method: req.method,
    headers: {
      "APCA-API-KEY-ID": key,
      "APCA-API-SECRET-KEY": secret,
      "content-type": "application/json",
    },
  };
  if (!["GET", "HEAD"].includes(req.method)) init.body = await req.text();

  const r = await fetch(PAPER + path + u.search, init);
  const body = await r.text();
  return new Response(body, {
    status: r.status,
    headers: { "content-type": "application/json" },
  });
};

export const config = { path: "/api/alpaca/*" };
