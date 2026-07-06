// Durable daily decision log, stored in Netlify Blobs.
//
// Each weekday run writes one entry describing WHAT the robot decided, WHY,
// and the actual actions it took. The public /api/log endpoint reads them back
// so everyone watching the showcase can follow the story day by day.

import { getStore } from "@netlify/blobs";

const STORE = "tradelab-log";
const KEY = "entries";

const store = () => getStore(STORE);

// New York calendar date for a timestamp — the trading day the entry belongs to.
function tradingDay(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" }); // YYYY-MM-DD
}

// Shape a runDaily() summary into a compact, human-facing log entry.
export function entryFromSummary(summary, extra = {}) {
  return {
    date: tradingDay(summary.startedAt),
    ranAt: summary.startedAt,
    skipped: !!summary.skipped,
    reason: summary.reason || "",
    marketOpen: summary.marketOpen,
    marketHealthy: summary.marketHealthy,
    marketNote: summary.marketNote || "",
    buys: summary.buys || [],
    sells: summary.sells || [],
    notes: summary.notes || [],
    actions: summary.executed || [],
    errors: summary.errors || [],
    equity: extra.equity ?? null,
  };
}

// Read the whole log as an object keyed by date.
export async function readEntries() {
  try {
    return (await store().get(KEY, { type: "json" })) || {};
  } catch {
    return {};
  }
}

// Upsert one day's entry (running twice on the same day overwrites).
export async function saveEntry(entry) {
  const all = await readEntries();
  all[entry.date] = entry;
  await store().setJSON(KEY, all);
  return all;
}
