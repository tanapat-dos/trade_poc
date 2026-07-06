// Manual trigger for the daily strategy — handy for testing without waiting
// for the 14:45 UTC schedule.
//
//   GET /api/run-daily            -> PREVIEW only (decides, places nothing)
//   GET /api/run-daily?execute=1  -> actually places the orders
//
// Uses the same ALPACA_KEY / ALPACA_SECRET env vars as the scheduled run.
// Paper account only.

import { runDaily } from "../lib/dailyStrategy.mjs";

export default async (req) => {
  const key = process.env.ALPACA_KEY;
  const secret = process.env.ALPACA_SECRET;
  const budget = +(process.env.START_BUDGET || 1000);

  if (!key || !secret) {
    return new Response(JSON.stringify({ error: "ALPACA_KEY / ALPACA_SECRET env vars are not set in Netlify" }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }

  const execute = new URL(req.url).searchParams.get("execute") === "1";

  try {
    const summary = await runDaily({ key, secret, budget, dryRun: !execute });
    return new Response(JSON.stringify(summary, null, 2), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
};

export const config = { path: "/api/run-daily" };
