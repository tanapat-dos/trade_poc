// Owner-only manual trigger for the daily strategy.
//
//   GET /api/run-daily?token=SECRET             -> PREVIEW only (places nothing)
//   GET /api/run-daily?token=SECRET&execute=1   -> actually places the orders
//
// Requires a private token so the public showcase link can't be used to
// trigger trades. Set RUN_TOKEN in the Netlify environment variables and keep
// it secret. Uses the same ALPACA_KEY / ALPACA_SECRET env vars. Paper only.

import { runDaily } from "../lib/dailyStrategy.mjs";
import { entryFromSummary, saveEntry } from "../lib/log.mjs";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status, headers: { "content-type": "application/json" },
  });

export default async (req) => {
  const key = process.env.ALPACA_KEY;
  const secret = process.env.ALPACA_SECRET;
  const budget = +(process.env.START_BUDGET || 1000);
  const runToken = process.env.RUN_TOKEN;

  if (!key || !secret) {
    return json({ error: "ALPACA_KEY / ALPACA_SECRET env vars are not set in Netlify" }, 500);
  }
  if (!runToken) {
    return json({ error: "RUN_TOKEN env var is not set — manual runs are disabled until you set one" }, 403);
  }

  const params = new URL(req.url).searchParams;
  if (params.get("token") !== runToken) {
    return json({ error: "invalid or missing token" }, 401);
  }

  const execute = params.get("execute") === "1";
  try {
    const summary = await runDaily({ key, secret, budget, dryRun: !execute });
    // Only real (executed) runs get recorded in the public log.
    if (execute) {
      try { await saveEntry(entryFromSummary(summary)); }
      catch (e) { console.error("log write failed:", e.message); }
    }
    return json(summary);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
};

export const config = { path: "/api/run-daily" };
