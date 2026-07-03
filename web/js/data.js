// Price data loading + CSV parsing (source: Yahoo Finance via /api/prices).

export function parsePricesCsv(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 30 || !lines[0].startsWith("Date")) return null;
  const dates = [], o = [], h = [], l = [], c = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(",");
    if (p.length < 5) continue;
    const [date, po, ph, pl, pc] = p;
    const fo = +po, fh = +ph, fl = +pl, fc = +pc;
    if (!date || !isFinite(fo) || !isFinite(fc) || fc <= 0) continue;
    dates.push(date); o.push(fo); h.push(fh); l.push(fl); c.push(fc);
  }
  if (dates.length < 30) return null;
  return { dates, o, h, l, c, idx: new Map(dates.map((d, i) => [d, i])) };
}

export async function fetchPrices(symbol, d1, d2, base = "/api/prices") {
  try {
    const r = await fetch(`${base}?symbol=${encodeURIComponent(symbol)}&d1=${d1}&d2=${d2}`);
    if (!r.ok) return null;
    return parsePricesCsv(await r.text());
  } catch {
    return null;
  }
}

// Download many tickers with limited concurrency; skips failures.
export async function fetchUniverse(symbols, d1, d2, onProgress) {
  const data = new Map();
  let done = 0;
  const queue = [...symbols];
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const s = queue.shift();
      const td = await fetchPrices(s, d1, d2);
      if (td) data.set(s, td);
      done++;
      if (onProgress) onProgress(done, symbols.length, s);
    }
  });
  await Promise.all(workers);
  return data;
}
