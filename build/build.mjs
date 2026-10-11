#!/usr/bin/env node
// Builds Heavy Numbers from SEC 13F filings. No server or database: the output is plain files for GitHub
// Pages. Usage:
//   SEC_USER_AGENT="Name you@example.com" node build/build.mjs [--out out] [--cache .cache] [--sets 6] [--no-live]
// The run downloads the six newest quarterly data sets (about 100 MB each) and reads every 13F filed since
// the newest one ends straight from EDGAR. It shows the latest quarter with at least 1,000 filers, compares
// each filer with its quarter before, keeps four quarters of history, and writes every page.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { listDataSets, fetchDataSet, fetchTickers, fillSic, fetchCompanyFacts, readJson } from './sec.mjs';
import { buildBoard } from './bottlenecks.mjs';
import { listLiveFilings, readLiveFilings } from './live.mjs';
import { readFilings, selectReports, latestQuarter, priorQuarter, readHoldings, buildBooks, pairPositions, detectSplits, changeOf, holdingsReturn, CONCENTRATED, BIG_BET } from './model.mjs';
import { selectReferenceEntry } from './reference.mjs';
import { stockSector, SECTORS } from './sectors.mjs';
import { renderSite } from './render.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const { values: args } = parseArgs({ options: { out: { type: 'string', default: 'out' }, cache: { type: 'string', default: '.cache' }, sets: { type: 'string', default: '6' }, live: { type: 'boolean', default: true } }, allowNegative: true });
const SMALL = new Set(['of', 'and', 'the', 'for', 'in', 'on', 'at', 'de', 'du', 'la', 'le', 'by']);
const KEEP = /^(LLC|LP|L\.P\.|LLP|PLC|NV|N\.V\.|SA|S\.A\.|AG|SE|ETF|REIT|USA|US|II|III|IV|AB|ASA|ADR|AI|NYSE|SPDR|IBM|AT&T|UBS|BNY)$/i;
const log = (...parts) => console.log(new Date().toISOString().slice(11, 19), ...parts);

// 1. Filings: the data sets, then anything filed since the newest one ends.
const sets = (await listDataSets()).slice(0, Number(args.sets));
const dirs = [];
for (const set of sets) { log('data set', set.file); dirs.push(await fetchDataSet(set, path.join(args.cache, 'sec'))); }
const filings = await readFilings(dirs);
const live = args.live ? await readLiveFilings(await listLiveFilings(sets[0].end), path.join(args.cache, 'live'), log) : [];
for (const { filing } of live) filings.set(filing.accession, filing);
const reports = selectReports(filings);
const period = latestQuarter(reports);
const periods = [period]; // newest first: the quarter shown, then four before it
while (periods.length < 5) periods.push(priorQuarter(periods.at(-1)));
const [, prior] = periods;
const reportsOf = p => reports.get(p) ?? new Map();
// A quarter still being filed: under 90% of the quarter before's filers so far.
const partial = reportsOf(period).size < 0.9 * reportsOf(prior).size;
log(`quarter ${period}: ${reportsOf(period).size} filers${partial ? ' so far' : ''}; ${prior}: ${reportsOf(prior).size}; live filings ${live.length}`);
const wanted = new Set(periods.flatMap(p => [...reportsOf(p).values()].flatMap(r => r.accessions)));
const { securities, rows } = await readHoldings(dirs, wanted, live);
live.length = 0;

// 2. What each security is: the committed OpenFIGI reference, plus a cache for CUSIPs it lacks.
const reference = readJson(path.join(root, '..', 'data', 'security-reference.json'), { entries: {} }).entries;
const figiFile = path.join(root, '..', 'data', 'cache', 'figi.json');
const figi = readJson(figiFile, {});
const rowCount = new Map();
for (const r of reportsOf(period).values()) for (const accession of r.accessions) for (const i of rows.get(accession)?.idx ?? []) rowCount.set(i, (rowCount.get(i) ?? 0) + 1);
const unknown = securities.map((s, i) => [s.cusip, rowCount.get(i) ?? 0]).filter(([cusip, n]) => n >= 5 && !reference[cusip] && !(cusip in figi)).sort((a, b) => b[1] - a[1]).slice(0, 2500).map(([c]) => c);
if (unknown.length) {
  log(`OpenFIGI: ${unknown.length} new CUSIPs`);
  await fetchFigi(unknown, figi);
  writeFileSync(figiFile, JSON.stringify(sortKeys(figi)) + '\n');
}
for (const s of securities) {
  const entry = reference[s.cusip] ?? figi[s.cusip] ?? null;
  s.ticker = entry?.ticker ?? null;
  s.kind = entry?.kind ?? null;
  s.label = entry?.name ? titleCase(entry.name) : titleCase(s.name);
}
const isStock = s => s.kind === 'stock' || s.kind === 'adr';
const isConcentrated = book => {
  if (book.report.confidential || book.total < CONCENTRATED.minValueUsd) return false;
  const n = book.positions.size;
  if (n < CONCENTRATED.minPositions || n > CONCENTRATED.maxPositions) return false;
  let stockValue = 0, fundValue = 0;
  for (const [i, held] of book.positions) { const s = securities[i]; if (isStock(s)) stockValue += held.value; else if (s.kind === 'fund' || s.kind === 'etp') fundValue += held.value; }
  return stockValue >= CONCENTRATED.minStockShare * book.total && fundValue <= CONCENTRATED.maxFundShare * book.total;
};

// 3. Books, oldest quarter first. Each quarter is summarized against the one before for the history
// tables; the newest three are kept whole for the pages.
const continuity = readJson(path.join(root, '..', 'data', 'manager-continuity.json'), { pairs: [] }).pairs;
const books = new Map(), prices = new Map(), successorOf = new Map();
// Each filer's return per quarter from holding its book at the quarter before unchanged, and the S&P 500's
// (SPY's price) for the same quarters.
const SPY = securities.findIndex(s => s.cusip === '78462F103');
const quarterReturns = new Map(), benchmark = new Map(); // cik → Map period → return; period → return
// What each position added to that return, for books of up to 150 positions (the concentrated range).
const quarterContributions = new Map(); // cik → Map period → Map idx → share of the return
const fundHistory = new Map(), stockHistory = new Map(); // cik | idx → Map period → summary
const remember = (map, key, p, value) => { if (!map.has(key)) map.set(key, new Map()); map.get(key).set(p, value); };
for (const p of [...periods].reverse()) {
  const built = buildBooks(reportsOf(p), rows);
  for (const r of reportsOf(p).values()) for (const accession of r.accessions) rows.delete(accession);
  books.set(p, built.books); prices.set(p, built.price);
  const before = books.get(priorQuarter(p));
  if (before) {
    // A filer whose holdings moved to a successor in this quarter (data/manager-continuity.json): the
    // successor's quarter before is the old filer's book, plus its own when it already filed one.
    for (const pair of continuity) {
      const oldCik = pair.old.cik.padStart(10, '0'), newCik = pair.new.cik.padStart(10, '0'), old = before.get(oldCik);
      if (pair.from !== p || !old || !built.books.has(newCik)) continue;
      const own = pair.includesOwn ? before.get(newCik) : null;
      const positions = new Map([...old.positions].map(([i, held]) => [i, { ...held }]));
      if (own) for (const [i, held] of own.positions) { const q = positions.get(i); if (q) { q.shares += held.shares; q.value += held.value; } else positions.set(i, { ...held }); }
      before.set(newCik, { report: old.report, positions, total: old.total + (own?.total ?? 0), unitFixed: old.unitFixed });
      before.delete(oldCik);
      successorOf.set(`${p}|${newCik}`, pair.old.name);
      // Its history before the move is the old filer's (plus its own, when it filed alongside).
      const oldHistory = fundHistory.get(oldCik), ownHistory = fundHistory.get(newCik);
      if (oldHistory) for (const [q, h] of oldHistory) {
        const mine = pair.includesOwn ? ownHistory?.get(q) : null;
        remember(fundHistory, newCik, q, mine ? { value: h.value + mine.value, positions: h.positions + mine.positions, opened: null, sold: null } : h);
      }
    }
  }
  if (before) {
    const priceBefore = prices.get(priorQuarter(p));
    for (const [cik, book] of before) {
      const parts = book.positions.size <= CONCENTRATED.maxPositions ? new Map() : null;
      const r = holdingsReturn(book, built.books.get(cik), priceBefore, built.price, parts);
      if (r != null) { remember(quarterReturns, cik, p, r); if (parts) remember(quarterContributions, cik, p, parts); }
    }
    if (priceBefore.has(SPY) && built.price.has(SPY)) benchmark.set(p, built.price.get(SPY) / priceBefore.get(SPY) - 1);
  }
  if (periods.indexOf(p) < 4) { // history: the four newest quarters
    for (const [cik, book] of built.books) {
      const prev = before?.get(cik), pairs = pairPositions(book, prev, securities), kept = new Set(pairs.values());
      book.concentrated = isConcentrated(book);
      remember(fundHistory, cik, p, { value: book.total, positions: book.positions.size, opened: prev ? book.positions.size - pairs.size : null, sold: prev ? [...prev.positions.keys()].filter(j => !kept.has(j)).length : null });
      for (const [i, held] of book.positions) {
        if (!isStock(securities[i])) continue;
        let h = stockHistory.get(i)?.get(p);
        if (!h) remember(stockHistory, i, p, h = { holders: 0, concentrated: 0, value: 0 });
        h.holders++; h.value += held.value; if (book.concentrated) h.concentrated++;
      }
    }
  }
  // The pages need the newest three quarters (a filer not in yet is compared with the quarter before it).
  const done = periods[periods.indexOf(p) + 1];
  if (periods.indexOf(done) >= 3) { books.delete(done); prices.delete(done); }
}
rows.clear();

/** One fund's latest report against its report a quarter before: holdings with changes, and sold-out rows. */
function compareBooks(cik, p) {
  const book = books.get(p).get(cik), prev = books.get(priorQuarter(p))?.get(cik) ?? null, hasPrior = !!prev;
  const pairs = pairPositions(book, prev, securities), paired = new Set(pairs.values());
  const holdings = [];
  for (const [i, held] of book.positions) {
    const j = pairs.get(i), was = j === undefined ? null : prev.positions.get(j);
    const beforeShares = was ? was.shares * (splitsOf(p).get(`${j}>${i}`) ?? 1) : 0;
    holdings.push({ i, shares: held.shares, value: held.value, weight: book.total ? held.value / book.total : 0, change: changeOf(held.shares, beforeShares, hasPrior), changePct: beforeShares ? held.shares / beforeShares - 1 : null });
  }
  holdings.sort((a, b) => b.value - a.value);
  const sold = [];
  if (prev) for (const [i, was] of prev.positions) if (!paired.has(i)) sold.push({ i, shares: was.shares, value: was.value, weight: prev.total ? was.value / prev.total : 0 });
  sold.sort((a, b) => b.value - a.value);
  return { book, prev, pairs, holdings, sold, hasPrior };
}
/**
 * The positions behind a fund's last four quarters of return, largest first: [{ i, share }], where share is in
 * points of the twelve-month return. A quarter's contributions are scaled by the fund's growth before it, so
 * the shares add up to the twelve-month return.
 */
function contributorsOf(cik) {
  const total = new Map();
  let growth = 1;
  for (const q of periods.slice(0, 4).reverse()) {
    for (const [i, share] of quarterContributions.get(cik)?.get(q) ?? []) total.set(i, (total.get(i) ?? 0) + growth * share);
    growth *= 1 + (quarterReturns.get(cik)?.get(q) ?? 0);
  }
  return [...total].map(([i, share]) => ({ i, share })).sort((a, b) => b.share - a.share);
}
const splitCache = new Map();
function splitsOf(p) {
  if (!splitCache.has(p)) {
    const now = books.get(p), before = books.get(priorQuarter(p)) ?? new Map();
    const pairsByCik = new Map([...now].map(([cik, book]) => [cik, pairPositions(book, before.get(cik), securities)]));
    splitCache.set(p, detectSplits(now, before, pairsByCik, prices.get(p), prices.get(priorQuarter(p)) ?? new Map()));
  }
  return splitCache.get(p);
}
log(`${securities.length} securities, ${splitsOf(period).size} splits`);

// 4. Funds: each filer's latest report. While a quarter is still being filed, a filer that has not filed
// it yet shows its report for the quarter before.
const readable = new Map(Object.entries(readJson(path.join(root, '..', 'data', 'fund-slugs.json'), {})));
const funds = [];
const latest = [...books.get(period).keys()].map(cik => [cik, period]);
if (partial) for (const cik of books.get(prior).keys()) if (!books.get(period).has(cik)) latest.push([cik, prior]);
for (const [cik, p] of latest) {
  const { book, prev, pairs, holdings, sold, hasPrior } = compareBooks(cik, p);
  const returns = periods.slice(0, 4).map(q => quarterReturns.get(cik)?.get(q) ?? null);
  const yearReturn = returns.every(r => r != null) ? returns.reduce((n, r) => n * (1 + r), 1) - 1 : null;
  funds.push({ cik, period: p, current: p === period, returns, yearReturn, contributors: yearReturn == null ? [] : contributorsOf(cik), pairs, predecessor: successorOf.get(`${p}|${cik}`) ?? null, name: titleCase(book.report.name), city: book.report.city, report: book.report, total: book.total, priorTotal: prev?.total ?? null, unitFixed: book.unitFixed, holdings, sold, concentrated: isConcentrated(book), hasPrior, history: periods.slice(0, 4).map((q, n) => [q, fundHistory.get(cik)?.get(q) ? { ...fundHistory.get(cik).get(q), ret: returns[n] } : null]) });
}
// Addresses: a reviewed filer keeps its readable id; others go by name, with the CIK when names collide.
const bySlug = new Map();
for (const fund of funds) { fund.slug = readable.get(fund.cik) ?? (fundSlug(fund.name) || `cik-${fund.cik}`); bySlug.set(fund.slug, (bySlug.get(fund.slug) ?? 0) + 1); }
for (const fund of funds) if (bySlug.get(fund.slug) > 1 && !readable.has(fund.cik)) fund.slug = `${fund.slug}-${Number(fund.cik)}`;
funds.sort((a, b) => b.total - a.total);
const current = funds.filter(f => f.current);
log(`${funds.length} funds (${current.length} filed ${period}), ${current.filter(f => f.concentrated).length} concentrated`);

// 5. Stocks. Lists of what funds did this quarter read only the filers that filed it; a stock's holders
// are every filer's latest report.
// Counts a quarter apart among filers that filed both, following reissued CUSIPs (before idx → now idx).
const nowCount = new Map(), priorBoth = new Map(), priorAll = new Map(), votes = new Map();
for (const book of books.get(prior).values()) for (const j of book.positions.keys()) priorAll.set(j, (priorAll.get(j) ?? 0) + 1);
for (const fund of current) {
  for (const h of fund.holdings) nowCount.set(h.i, (nowCount.get(h.i) ?? 0) + 1);
  const prev = books.get(prior).get(fund.cik);
  if (prev) for (const j of prev.positions.keys()) priorBoth.set(j, (priorBoth.get(j) ?? 0) + 1);
  for (const [i, j] of fund.pairs) if (i !== j) votes.set(`${j}>${i}`, (votes.get(`${j}>${i}`) ?? 0) + 1);
}
const successor = new Map(), best = new Map();
for (const [key, n] of votes) { const [j, i] = key.split('>').map(Number); if (n > (best.get(j) ?? 0)) { best.set(j, n); successor.set(j, i); } }
const holdersAfter = j => (nowCount.get(j) ?? 0) + (successor.has(j) ? nowCount.get(successor.get(j)) ?? 0 : 0);
// A security most of whose holders are gone a quarter later was merged away or delisted, not sold.
const gone = j => holdersAfter(j) < 0.25 * (priorBoth.get(j) ?? 0);
for (const fund of funds) for (const s of fund.sold) s.gone = fund.current ? gone(s.i) : false;

const stocks = new Map(); // idx → stock
const stockFor = i => {
  let stock = stocks.get(i);
  if (!stock) stocks.set(i, stock = { i, security: securities[i], holders: [], value: 0, concentratedHolders: 0, opened: 0, soldOut: 0, bigBets: 0, priorHolders: priorAll.get(i) ?? 0 });
  return stock;
};
for (const fund of funds) {
  for (const h of fund.holdings) {
    if (!isStock(securities[h.i])) continue;
    const stock = stockFor(h.i);
    stock.holders.push({ fund, ...h });
    stock.value += h.value;
    if (!fund.concentrated) continue;
    stock.concentratedHolders++;
    if (fund.current && h.change === 'new') { stock.opened++; if (h.weight >= BIG_BET) stock.bigBets++; }
  }
  if (fund.concentrated && fund.current) for (const s of fund.sold) if (isStock(securities[s.i]) && !s.gone) stockFor(s.i).soldOut++;
}
for (const [j, i] of successor) if (stocks.has(i)) stocks.get(i).priorHolders += priorAll.get(j) ?? 0;
// New to 13F filings this quarter (an IPO or a spin-off): no filer held it a quarter before, so it is not
// in the opened lists, where every holder would count as opening it.
for (const stock of stocks.values()) {
  stock.holders.sort((a, b) => b.value - a.value);
  stock.firstQuarter = stock.priorHolders === 0;
  stock.history = periods.slice(0, 4).map(q => [q, stockHistory.get(stock.i)?.get(q) ?? null]);
}
// One page per ticker: the share class most funds hold.
const byTicker = new Map();
for (const stock of stocks.values()) {
  const t = stock.security.ticker;
  if (!t) continue;
  const other = byTicker.get(t);
  if (!other || stock.holders.length > other.holders.length) byTicker.set(t, stock);
}
for (const [ticker, stock] of byTicker) stock.slug = ticker.toLowerCase();

// 5. Sectors, from each issuer's SEC industry code
const tickers = await fetchTickers();
const sicFile = path.join(root, '..', 'data', 'cache', 'sic.json');
const sic = readJson(sicFile, {});
const sectorCiks = [];
for (const stock of byTicker.values()) {
  stock.issuer = tickers.get(stock.security.ticker) ?? null;
  // TradingView's delayed quote and chart, for Nasdaq and NYSE listings.
  const exchange = { Nasdaq: 'NASDAQ', NYSE: 'NYSE' }[stock.issuer?.exchange];
  stock.tv = exchange ? `${exchange}:${stock.security.ticker.replace('-', '.')}` : null;
  if (stock.issuer && (stock.concentratedHolders > 0 || stock.holders.length >= 20)) sectorCiks.push(stock.issuer.cik);
}
const fetched = await fillSic(sectorCiks, sic);
if (fetched) { log(`SIC codes: fetched ${fetched}`); writeFileSync(sicFile, JSON.stringify(sortKeys(sic)) + '\n'); }
for (const stock of stocks.values()) stock.sector = stockSector({ ticker: stock.security.ticker, sic: stock.issuer ? sic[stock.issuer.cik] : null });

// Sector shares of the concentrated funds' stock money, now and a quarter before (same funds).
const sectors = SECTORS.map(s => ({ ...s, now: 0, before: 0, opened: 0, soldOut: 0, stocks: [] }));
const sectorOf = new Map(sectors.map(s => [s.key, s]));
const sectorOfIdx = i => sectorOf.get(stocks.get(i)?.sector ?? 'other');
for (const fund of current) {
  if (!fund.concentrated || !fund.hasPrior) continue;
  for (const h of fund.holdings) if (isStock(securities[h.i])) { const s = sectorOfIdx(h.i); s.now += h.value; if (h.change === 'new') s.opened++; }
  for (const [i, was] of books.get(prior).get(fund.cik).positions) if (isStock(securities[i])) sectorOfIdx(i).before += was.value;
  for (const s of fund.sold) if (isStock(securities[s.i]) && !s.gone) sectorOfIdx(s.i).soldOut++;
}
for (const stock of byTicker.values()) if (stock.concentratedHolders) sectorOf.get(stock.sector).stocks.push(stock);
for (const s of sectors) s.stocks.sort((a, b) => b.concentratedHolders - a.concentratedHolders || b.value - a.value);

// Bottleneck board: backlog and sales from each listed company's XBRL facts.
const board = await buildBoard({ tickers, getFacts: fetchCompanyFacts });
log(`bottleneck board: ${board.layers.reduce((n, l) => n + l.rows.length, 0)} companies`);

// 6. Pages
rmSync(args.out, { recursive: true, force: true });
mkdirSync(args.out, { recursive: true });
const summary = renderSite({ out: args.out, period, prior, partial, priorFilers: reportsOf(prior).size, funds, stocks: [...byTicker.values()], sectors, securities, builtAt: new Date().toISOString(), dataSets: sets.map(s => s.file), board, benchmark: periods.slice(0, 4).map(q => benchmark.get(q) ?? null) });
log(`wrote ${summary.pages} pages, ${(summary.bytes / 2 ** 20).toFixed(0)} MB, to ${args.out}`);

// --- helpers
async function fetchFigi(cusips, cache) {
  const key = process.env.OPENFIGI_API_KEY ?? '', size = key ? 100 : 10, gap = key ? 300 : 2600;
  for (let k = 0; k < cusips.length; k += size) {
    const batch = cusips.slice(k, k + size);
    let response;
    for (let attempt = 0; attempt < 6; attempt++) {
      response = await fetch('https://api.openfigi.com/v3/mapping', { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'X-OPENFIGI-APIKEY': key } : {}) }, body: JSON.stringify(batch.map(idValue => ({ idType: 'ID_CUSIP', idValue }))) });
      if (response.status !== 429 && response.status < 500) break;
      await new Promise(r => setTimeout(r, 10000 * (attempt + 1)));
    }
    if (!response.ok) { log(`OpenFIGI stopped: ${response.status}`); return; }
    const results = await response.json();
    batch.forEach((cusip, j) => { cache[cusip] = selectReferenceEntry(results[j]?.data ?? []); });
    await new Promise(r => setTimeout(r, gap));
  }
}
function fundSlug(name) {
  return String(name ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/['’]/g, '').replace(/(?<=[a-z])\.(?=[a-z])/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function sortKeys(object) { return Object.fromEntries(Object.keys(object).sort().map(k => [k, object[k]])); }
function titleCase(name) {
  const text = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (/[a-z]/.test(text)) return text; // already mixed case: the filer's own spelling
  return text.split(' ').map((word, n) => {
    if (KEEP.test(word)) return word.toUpperCase();
    const lower = word.toLowerCase();
    if (n && SMALL.has(lower)) return lower;
    return lower.replace(/(^|[-/(&.'])([a-z])/g, (_, p, c) => p + c.toUpperCase());
  }).join(' ');
}
