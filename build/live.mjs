// Filings SEC has not put in a quarterly data set yet: every 13F-HR and 13F-HR/A in EDGAR's full indexes
// filed after the newest data set ends, read one by one. Each parsed filing is kept in cacheDir, so a run
// fetches only what is new since the last one.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import path from 'node:path';
import { secText } from './sec.mjs';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decode = text => text.replace(/&(amp|lt|gt|quot|apos|#\d+);/g, (_, e) => ENTITIES[e] ?? String.fromCharCode(Number(e.slice(1))));
const xmlField = (xml, name) => decode(xml.match(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>\\s*([^<]*?)\\s*</(?:[\\w-]+:)?${name}\\s*>`, 'i'))?.[1]?.trim() ?? '');
const headerField = (header, name) => header.match(new RegExp(`^\\s*${name}:\\s*([^\\r\\n]+)`, 'm'))?.[1]?.trim() ?? '';
const dashed = digits => /^\d{8}$/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}` : digits;
const number = (value, what) => {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error(`Invalid ${what}`);
  return Number(value);
};

/**
 * One 13F filing's full text (the .txt EDGAR keeps per accession): its cover and its share positions, as
 * [cusip, issuer, title, shares, value in dollars]. Options, principal amounts and rows without a CUSIP are
 * left out. Throws when the document is not the filing the index named.
 */
export function parseFiling(raw, row) {
  const header = raw.match(/<SEC-HEADER[^>]*>([\s\S]*?)<\/SEC-HEADER>/i)?.[1];
  if (!header || headerField(header, 'ACCESSION NUMBER') !== row.accession || headerField(header, 'CENTRAL INDEX KEY').padStart(10, '0') !== row.cik || headerField(header, 'CONFORMED SUBMISSION TYPE') !== row.form) throw new Error('SEC document differs from its index entry');
  const period = dashed(headerField(header, 'CONFORMED PERIOD OF REPORT'));
  if (!/^\d{4}-(03-31|06-30|09-30|12-31)$/.test(period) || period > row.filedAt) throw new Error(`Invalid reporting quarter ${period}`);
  if (!/<(?:[\w-]+:)?infoTable[\s>]/i.test(raw) && !/<(?:[\w-]+:)?tableEntryTotal>\s*0\s*</i.test(raw)) throw new Error('No 13F information table');
  const scale = row.filedAt < '2023-01-03' ? 1000 : 1; // values were filed in thousands before 2023
  const rows = [];
  for (const [, xml] of raw.matchAll(/<(?:[\w-]+:)?infoTable(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?infoTable\s*>/gi)) {
    const cusip = xmlField(xml, 'cusip').toUpperCase();
    if (!/^[0-9A-Z*@#]{9}$/.test(cusip) || /^0+$/.test(cusip) || xmlField(xml, 'sshPrnamtType').toUpperCase() !== 'SH' || xmlField(xml, 'putCall')) continue;
    rows.push([cusip, xmlField(xml, 'nameOfIssuer'), xmlField(xml, 'titleOfClass'), number(xmlField(xml, 'sshPrnamt'), 'shares'), number(xmlField(xml, 'value'), 'value') * scale]);
  }
  const amendment = row.form === '13F-HR/A' ? (xmlField(raw, 'amendmentType').toUpperCase() || 'RESTATEMENT') : null;
  return {
    filing: {
      accession: row.accession, cik: row.cik, period, filedAt: row.filedAt, form: row.form,
      name: xmlField(raw, 'name') || headerField(header, 'COMPANY CONFORMED NAME') || row.name,
      city: [xmlField(raw, 'city'), xmlField(raw, 'stateOrCountry')].filter(Boolean).join(', '),
      amendment, confidential: /^(true|y|1)$/i.test(xmlField(raw, 'isConfidentialOmitted')),
    },
    rows,
  };
}

/** The calendar quarters from the one holding `after` through today: [{ year, quarter }]. */
function quartersSince(after, today) {
  const out = [];
  let year = Number(after.slice(0, 4)), quarter = Math.floor((Number(after.slice(5, 7)) - 1) / 3) + 1;
  const endYear = Number(today.slice(0, 4)), endQuarter = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
  while (year < endYear || (year === endYear && quarter <= endQuarter)) {
    out.push({ year, quarter });
    if (++quarter > 4) { quarter = 1; year++; }
  }
  return out;
}

/** 13F holdings filings indexed after `after` (an ISO date): [{ cik, name, form, filedAt, accession, url }]. */
export async function listLiveFilings(after, today = new Date().toISOString().slice(0, 10)) {
  const filings = [];
  for (const { year, quarter } of quartersSince(after, today)) {
    const text = await secText(`https://www.sec.gov/Archives/edgar/full-index/${year}/QTR${quarter}/master.idx`);
    if (text === null) continue; // a quarter SEC has not started yet
    for (const line of text.split('\n')) {
      const [cik, name, form, filedAt, file] = line.split('|');
      if (!['13F-HR', '13F-HR/A'].includes(form) || !(filedAt > after)) continue;
      const accession = file?.trim().match(/(\d{10}-\d{2}-\d{6})\.txt$/)?.[1];
      if (accession) filings.push({ cik: cik.padStart(10, '0'), name: name.trim(), form, filedAt, accession, url: `https://www.sec.gov/Archives/${file.trim()}` });
    }
  }
  return filings;
}

/**
 * Fetches and parses each filing (or reads it from cacheDir) into the shape readFilings and readHoldings
 * produce from the data sets: { filing, rows: [[cusip, issuer, title, shares, value]] } with share
 * positions only. A filing that fails to parse is logged and left out.
 */
export async function readLiveFilings(list, cacheDir, log = console.log) {
  mkdirSync(cacheDir, { recursive: true });
  const out = [];
  let fetched = 0, failed = 0;
  for (const row of list) {
    const file = path.join(cacheDir, `${row.accession}.json.gz`);
    if (existsSync(file)) { out.push(JSON.parse(gunzipSync(readFileSync(file)))); continue; }
    try {
      const raw = await secText(row.url);
      if (raw === null) throw new Error('not found');
      const entry = parseFiling(raw, row);
      writeFileSync(file, gzipSync(JSON.stringify(entry)));
      out.push(entry);
      if (++fetched % 250 === 0) log(`  live filings: fetched ${fetched}`);
    } catch (error) {
      failed++;
      log(`  live filing ${row.accession} left out: ${error.message.slice(0, 120)}`);
    }
  }
  log(`live filings: ${out.length} (${fetched} fetched, ${failed} left out)`);
  return out;
}
