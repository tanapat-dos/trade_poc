// Scheduled daily strategy run.
//
// Runs every weekday at 14:45 UTC — that's 10:45 New York time in summer
// (EDT) and 9:45 in winter (EST), so it's always shortly after the 9:30 ET
// market open. On US market holidays it detects the closed market and skips.
//
// Requires two Netlify environment variables (paper account only):
//   ALPACA_KEY, ALPACA_SECRET
// Optional:
//   START_BUDGET  (default 1000) — total dollars the strategy manages.

import { runDaily } from "../lib/dailyStrategy.mjs";
import { entryFromSummary, saveEntry } from "../lib/log.mjs";

export default async () => {
  const key = process.env.ALPACA_KEY;
  const secret = process.env.ALPACA_SECRET;
  const budget = +(process.env.START_BUDGET || 1000);

  if (!key || !secret) {
    console.error("daily: ALPACA_KEY / ALPACA_SECRET env vars are not set");
    return new Response("missing credentials", { status: 500 });
  }

  try {
    const summary = await runDaily({ key, secret, budget, requireOpen: true });
    console.log("daily run:", JSON.stringify(summary));
    // Record the day's decision + actions in the public log.
    try { await saveEntry(entryFromSummary(summary)); }
    catch (e) { console.error("log write failed:", e.message); }
    return new Response(JSON.stringify(summary), {
      headers: { "content-type": "application/json" },
    });
  } catch (e) {
    console.error("daily run failed:", e.message);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { "content-type": "application/json" },
    });
  }
};

export const config = { schedule: "45 14 * * 1-5" };
