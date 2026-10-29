// SEC 13F rows into the site's model: each filer's report per quarter, its holdings as a book, positions paired
// across quarters, and stock splits. Reads the data set files in readFilings and readHoldings; the rest is pure.
import path from 'node:path';
import { readTsv } from './sec.mjs';

const MONTHS = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
/** '30-JUN-2026' → '2026-06-30'. */
export function secDate(value) {
  const match = String(value ?? '').trim().toUpperCase().match(/^(\d{2})-([A-Z]{3})-(\d{4})$/);
  return match && MONTHS[match[2]] ? `${match[3]}-${MONTHS[match[2]]}-${match[1]}` : null;
}
const QUARTER_END = /^\d{4}-(03-31|06-30|09-30|12-31)$/;
/** The quarter end before '2026-06-30': '2026-03-31'. */
export function priorQuarter(period) {
  const [year, month] = period.split('-').map(Number);
  return month === 3 ? `${year - 1}-12-31` : `${year}-${String(month - 3).padStart(2, '0')}-${[6, 9].includes(month - 3) ? '30' : '31'}`;
}
export const quarterLabel = period => `Q${Number(period.slice(5, 7)) / 3} ${period.slice(0, 4)}`;

/** Concentrated funds: the population Discover reads. */
export const CONCENTRATED = { minPositions: 5, maxPositions: 150, minValueUsd: 1e8, minStockShare: 0.6, maxFundShare: 0.25 };
export const BIG_BET = 0.03;
/** A quarter needs at least this many filers before the site shows it; until then the one before leads. */
export const MIN_FILERS = 1000;

/**
 * Reads the data sets' filing tables and picks, for every filer and quarter end, the filings that make up
 * its report: the latest original or restatement, plus any later "new holdings" amendments.
 */
export async function readFilings(dirs) {
  const filings = new Map();
  for (const dir of dirs) {
    await readTsv(path.join(dir, 'SUBMISSION.tsv'), row => {
      if (!['13F-HR', '13F-HR/A'].includes(row.SUBMISSIONTYPE)) return;
      const period = secDate(row.PERIODOFREPORT), filedAt = secDate(row.FILING_DATE);
      if (!period || !QUARTER_END.test(period) || !filedAt) return;
      filings.set(row.ACCESSION_NUMBER, { accession: row.ACCESSION_NUMBER, cik: row.CIK.padStart(10, '0'), period, filedAt, form: row.SUBMISSIONTYPE, dir });
    });
    await readTsv(path.join(dir, 'COVERPAGE.tsv'), row => {
      const filing = filings.get(row.ACCESSION_NUMBER);
      if (!filing) return;
      filing.name = row.FILINGMANAGER_NAME.trim();
      filing.amendment = row.ISAMENDMENT === 'Y' ? (row.AMENDMENTTYPE.trim().toUpperCase() || 'RESTATEMENT') : null;
      filing.city = [row.FILINGMANAGER_CITY, row.FILINGMANAGER_STATEORCOUNTRY].map(s => s.trim()).filter(Boolean).join(', ');
    });
    await readTsv(path.join(dir, 'SUMMARYPAGE.tsv'), row => {
      const filing = filings.get(row.ACCESSION_NUMBER);
      if (filing) filing.confidential = row.ISCONFIDENTIALOMITTED === 'Y';
    });
  }
  return filings;
}

/** Groups filings into reports: Map period → Map cik → { base, accessions[], filedAt, name, confidential }. */
export function selectReports(filings) {
  const groups = new Map();
  for (const filing of filings.values()) {
    if (!filing.name) continue;
    const key = `${filing.period}|${filing.cik}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(filing);
  }
  const reports = new Map();
  for (const list of groups.values()) {
    list.sort((a, b) => a.filedAt.localeCompare(b.filedAt) || a.accession.localeCompare(b.accession));
    const bases = list.filter(f => f.form === '13F-HR' || f.amendment === 'RESTATEMENT');
    const base = bases.at(-1);
    if (!base) continue;
    const additions = list.filter(f => f.amendment === 'NEW HOLDINGS' && f.filedAt >= base.filedAt && f !== base);
    const parts = [base, ...additions];
    const { period, cik } = base;
    if (!reports.has(period)) reports.set(period, new Map());
    reports.get(period).set(cik, { cik, period, base, accessions: parts.map(f => f.accession), filedAt: parts.at(-1).filedAt, name: base.name, city: base.city, confidential: parts.some(f => f.confidential) });
  }
  return reports;
}

/** The latest quarter end with at least MIN_FILERS reports. */
export function latestQuarter(reports) {
  const periods = [...reports.keys()].filter(p => reports.get(p).size >= MIN_FILERS).sort();
  if (!periods.length) throw new Error('No quarter in the data sets has enough filers yet');
  return periods.at(-1);
}

/**
 * Reads the information tables for the wanted accessions. Only share positions are kept (no options, no
 * principal amounts). Securities are interned: securities[i] = { cusip, name, title }.
 */
export async function readHoldings(dirs, wanted, live = []) {
  const securities = [], index = new Map();
  const rows = new Map(); // accession → { idx: [], shares: [], value: [] }
  for (const { filing, rows: list } of live) {
    if (!wanted.has(filing.accession)) continue;
    const table = { idx: [], shares: [], value: [] };
    for (const [cusip, name, title, shares, value] of list) {
      let i = index.get(cusip);
      if (i === undefined) { i = securities.length; index.set(cusip, i); securities.push({ cusip, name, title }); }
      table.idx.push(i); table.shares.push(shares); table.value.push(value);
    }
    rows.set(filing.accession, table);
  }
  for (const dir of dirs) {
    await readTsv(path.join(dir, 'INFOTABLE.tsv'), row => {
      if (!wanted.has(row.ACCESSION_NUMBER) || row.SSHPRNAMTTYPE !== 'SH' || row.PUTCALL) return;
      const cusip = row.CUSIP.trim().toUpperCase();
      if (!/^[0-9A-Z*@#]{9}$/.test(cusip) || /^0{9}$/.test(cusip)) return;
      const shares = Number(row.SSHPRNAMT), value = Number(row.VALUE);
      if (!Number.isFinite(shares) || !Number.isFinite(value) || shares < 0 || value < 0) return;
      let i = index.get(cusip);
      if (i === undefined) { i = securities.length; index.set(cusip, i); securities.push({ cusip, name: row.NAMEOFISSUER.trim(), title: row.TITLEOFCLASS.trim() }); }
      let table = rows.get(row.ACCESSION_NUMBER);
      if (!table) rows.set(row.ACCESSION_NUMBER, table = { idx: [], shares: [], value: [] });
      table.idx.push(i); table.shares.push(shares); table.value.push(value);
    });
  }
  return { securities, rows };
}

const median = values => {
  if (!values.length) return null;
  const sorted = Float64Array.from(values).sort(), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * One quarter's books: Map cik → { report, positions: Map idx → { shares, value }, total, unitFixed }.
 * A filing whose values sit about 1,000 times under every other filer's prices was filed in thousands
 * of dollars, though the form has asked for dollars since 2023; its values are scaled up.
 */
export function buildBooks(quarterReports, rows) {
  const books = new Map();
  for (const report of quarterReports.values()) {
    const positions = new Map();
    for (const accession of report.accessions) {
      const table = rows.get(accession);
      if (!table) continue;
      for (let k = 0; k < table.idx.length; k++) {
        const held = positions.get(table.idx[k]);
        if (held) { held.shares += table.shares[k]; held.value += table.value[k]; }
        else positions.set(table.idx[k], { shares: table.shares[k], value: table.value[k] });
      }
    }
    for (const [i, held] of positions) if (held.shares === 0 && held.value === 0) positions.delete(i);
    books.set(report.cik, { report, positions, total: 0, unitFixed: false });
  }
  const prices = new Map();
  for (const book of books.values()) for (const [i, held] of book.positions) if (held.shares > 0 && held.value > 0) {
    if (!prices.has(i)) prices.set(i, []);
    prices.get(i).push(held.value / held.shares);
  }
  const price = new Map();
  for (const [i, list] of prices) if (list.length >= 3) price.set(i, median(list));
  for (const book of books.values()) {
    const ratios = [];
    for (const [i, held] of book.positions) if (held.shares > 0 && held.value > 0 && price.has(i)) ratios.push(held.value / held.shares / price.get(i));
    if (ratios.length >= 3 && median(ratios) < 0.005) {
      book.unitFixed = true;
      for (const held of book.positions.values()) held.value *= 1000;
    }
    for (const held of book.positions.values()) book.total += held.value;
  }
  return { books, price };
}

const SUFFIX = /\s+(INC|CORP|CORPORATION|CO|COMPANY|LTD|PLC|HOLDINGS?|GROUP|NEW|DEL)$/;
/** An issuer name to compare across CUSIPs: 'EXXONMOBIL HOLDINGS CORP' and 'EXXON MOBIL CORP' → 'EXXONMOBIL'. */
const nameKey = name => {
  let key = String(name).toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  while (SUFFIX.test(key)) key = key.replace(SUFFIX, '');
  return key.replace(/ /g, '');
};
/**
 * Pairs a filer's positions now with its positions a quarter before: idx now → idx before. Same CUSIP first;
 * then, when one position on each side is left with the same issuer code (the CUSIP's first six characters),
 * those two, since a reissued CUSIP (a reverse split, a reorganization) is the same holding; then the same
 * for the issuer's name, for a reorganization under a new issuer code (Exxon's new holding company, ONEOK).
 */
export function pairPositions(book, prev, securities) {
  const pairs = new Map();
  if (!prev) return pairs;
  for (const i of book.positions.keys()) if (prev.positions.has(i)) pairs.set(i, i);
  const left = (positions, taken, keyOf) => {
    const byKey = new Map();
    for (const i of positions.keys()) if (!taken.has(i)) byKey.set(keyOf(i), [...(byKey.get(keyOf(i)) ?? []), i]);
    return byKey;
  };
  for (const keyOf of [i => securities[i].cusip.slice(0, 6), i => nameKey(securities[i].name)]) {
    const nowLeft = left(book.positions, pairs, keyOf), beforeLeft = left(prev.positions, new Set(pairs.values()), keyOf);
    for (const [key, list] of nowLeft) {
      const other = beforeLeft.get(key);
      if (key && list.length === 1 && other?.length === 1) pairs.set(list[0], other[0]);
    }
  }
  return pairs;
}

const SPLITS = [2, 3, 4, 5, 6, 8, 10, 15, 20, 25, 30, 40, 50, 100, 1.5, 1.25].flatMap(r => [r, 1 / r]);
/**
 * Share-count factors for holdings that split between the quarters: 'before>now' idx pair → factor (now / before).
 * A split shows as most holders' share counts moving by one split ratio while the price moves the other way.
 */
export function detectSplits(now, before, pairsByCik, priceNow, priceBefore) {
  const ratios = new Map();
  for (const [cik, book] of now) {
    const prior = before.get(cik), pairs = pairsByCik.get(cik);
    if (!prior || !pairs) continue;
    for (const [i, j] of pairs) {
      const held = book.positions.get(i), was = prior.positions.get(j);
      if (was.shares > 0 && held.shares > 0) {
        const key = `${j}>${i}`;
        if (!ratios.has(key)) ratios.set(key, []);
        ratios.get(key).push(held.shares / was.shares);
      }
    }
  }
  const splits = new Map();
  for (const [key, list] of ratios) {
    if (list.length < 3) continue;
    const [j, i] = key.split('>').map(Number);
    const ratio = median(list), a = priceNow.get(i), b = priceBefore.get(j);
    const factor = SPLITS.find(s => Math.abs(ratio / s - 1) < 0.02);
    if (!factor || !a || !b) continue;
    const move = (a / b) * factor; // the price move with the split taken out
    if (move > 0.55 && move < 1.8) splits.set(key, factor);
  }
  return splits;
}

/**
 * What a book earned over the next quarter if held unchanged: each position's price move, weighted by its
 * value. Prices are the median 13F price, else the filer's own (value over shares). Moves under 0.3× or over
 * 3.5× are taken as splits or reporting errors and left out. Null when under 70% of the book is priced both
 * quarter ends. Dividends are not counted. With contributions (a Map), each priced position is set in it as
 * idx → [weight, return]: its share of the priced value and its price move, so Σ weight × return is the return.
 */
export function holdingsReturn(book, next, priceBefore, priceNow, contributions = null) {
  let priced = 0, grown = 0;
  for (const [i, held] of book.positions) {
    if (!(held.shares > 0 && held.value > 0)) continue;
    const later = next?.positions.get(i);
    const a = priceBefore.get(i) ?? held.value / held.shares;
    const b = priceNow.get(i) ?? (later?.shares > 0 ? later.value / later.shares : null);
    if (!b) continue;
    const r = b / a;
    if (r < 0.3 || r > 3.5) continue;
    priced += held.value; grown += held.value * r;
    contributions?.set(i, [held.value, r - 1]);
  }
  if (!(book.total > 0 && priced >= 0.7 * book.total)) return null;
  if (contributions) for (const [i, [v, move]] of contributions) contributions.set(i, [v / priced, move]);
  return grown / priced - 1;
}

/** 'new' | 'added' | 'cut' | 'sold' | 'same', or null when the filer has no report for the quarter before. */
export function changeOf(now, before, hasPrior) {
  if (!hasPrior) return null;
  if (!before) return now > 0 ? 'new' : null;
  if (!now) return 'sold';
  if (now > before * 1.005) return 'added';
  if (now < before * 0.995) return 'cut';
  return 'same';
}
