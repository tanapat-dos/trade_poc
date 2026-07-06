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
  const url = new URL(req.url);

  // Safe diagnostic: reports ONLY which env-var names the function can see
  // (never their values), to debug env-var scope/naming issues.
  if (url.searchParams.get("debug") === "1") {
    const names = Object.keys(process.env);
    return new Response(JSON.stringify({
      ALPACA_KEY_present: !!process.env.ALPACA_KEY,
      ALPACA_SECRET_present: !!process.env.ALPACA_SECRET,
      START_BUDGET_present: !!process.env.START_BUDGET,
      alpaca_like_names: names.filter((n) => /alpaca/i.test(n)),
      total_env_vars_visible: names.length,
    }, null, 2), { headers: { "content-type": "application/json" } });
  }

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
