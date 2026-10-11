// Skill from 13F holdings: each fund's quarterly return over a benchmark of stocks like the ones it held (same
// sector and size), averaged over up to two years, then shrunk toward zero in proportion to its noise. One
// year of raw returns is mostly luck; this ranks what is left after allowing for it.
// After Daniel, Grinblatt, Titman and Wermers (1997), without their book-to-market and momentum matches, and
// empirical-Bayes shrinkage across funds.

export const SKILL = Object.freeze({ quarters: 8, minQuarters: 4, sizeBuckets: 3, minBucket: 10, t: 2 });

/**
 * Each quarter's benchmark move for every stock: the equal-weighted average move of stocks in its sector and
 * size third (size = value 13F filers held at the start), falling back to its sector, then to all stocks,
 * when a bucket has under SKILL.minBucket stocks. stockMoves: period → Map idx → { move, size }.
 */
export function stockBenchmarks(stockMoves, sectorOf) {
  const marks = new Map();
  for (const [p, moves] of stockMoves) {
    const sizes = [...moves.values()].map(m => m.size).sort((a, b) => a - b);
    const cut = k => sizes[Math.floor(sizes.length * k / SKILL.sizeBuckets)] ?? Infinity;
    const cuts = Array.from({ length: SKILL.sizeBuckets - 1 }, (_, k) => cut(k + 1));
    const groups = new Map(), add = (key, move) => { const g = groups.get(key) ?? { n: 0, sum: 0 }; g.n++; g.sum += move; groups.set(key, g); };
    const keys = new Map();
    for (const [i, m] of moves) {
      const sector = sectorOf(i), size = cuts.filter(c => m.size >= c).length;
      keys.set(i, [`${sector}|${size}`, sector]);
      add(`${sector}|${size}`, m.move); add(sector, m.move); add('*', m.move);
    }
    const mean = key => { const g = groups.get(key); return g && g.n >= SKILL.minBucket ? g.sum / g.n : null; };
    const all = mean('*') ?? 0, quarter = new Map();
    for (const [i, [bucket, sector]] of keys) quarter.set(i, mean(bucket) ?? mean(sector) ?? all);
    marks.set(p, { byStock: quarter, all });
  }
  return marks;
}

/**
 * One fund's record: per quarter, Σ weight × (move − benchmark) over its priced positions; a position without
 * a benchmark (a fund or ETF) counts as matching it. parts: period → Map idx → [weight, move].
 */
export function fundSkill(parts, marks, periods) {
  const excess = [];
  for (const p of periods) {
    const quarter = parts.get(p), mark = marks.get(p);
    if (!quarter || !mark) continue;
    let x = 0;
    for (const [i, [weight, move]] of quarter) { const b = mark.byStock.get(i); if (b != null) x += weight * (move - b); }
    excess.push(x);
  }
  const n = excess.length;
  if (n < SKILL.minQuarters) return null;
  const mean = excess.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(excess.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const se = sd / Math.sqrt(n);
  return { quarters: n, won: excess.filter(x => x > 0).length, mean, se, t: se > 0 ? mean / se : 0 };
}

/**
 * Shrinks every record toward zero by how noisy it is: shrunk = mean × τ² / (τ² + se²), where τ² is the
 * spread of true skill across funds (the spread of means less the average noise). Also counts the records
 * at t ≥ SKILL.t and how many of those luck alone would produce (one-sided, about 2.3% of funds).
 */
export function shrinkSkill(records) {
  const n = records.length;
  if (!n) return { tau: 0, significant: 0, expected: 0, measured: 0 };
  const mean = records.reduce((a, r) => a + r.mean, 0) / n;
  const spread = records.reduce((a, r) => a + (r.mean - mean) ** 2, 0) / Math.max(1, n - 1);
  const noise = records.reduce((a, r) => a + r.se ** 2, 0) / n;
  const tau2 = Math.max(spread - noise, 1e-6);
  for (const r of records) r.shrunk = r.mean * tau2 / (tau2 + r.se ** 2);
  return { tau: Math.sqrt(tau2), significant: records.filter(r => r.t >= SKILL.t).length, expected: Math.round(n * 0.0228), measured: n };
}
