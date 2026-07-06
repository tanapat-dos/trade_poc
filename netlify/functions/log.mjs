// Public, read-only daily decision log.
//
// Returns every recorded day's entry (what the robot decided, why, and what it
// actually did), newest first. Written by the scheduled daily run; safe to
// share since it only reads.

import { readEntries } from "../lib/log.mjs";

export default async () => {
  const all = await readEntries();
  const entries = Object.values(all).sort((a, b) => (a.date < b.date ? 1 : -1));
  return new Response(JSON.stringify({ entries }), {
    headers: {
      "content-type": "application/json",
      "cache-control": "public, max-age=30",
    },
  });
};

export const config = { path: "/api/log" };
