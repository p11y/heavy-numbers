// SEC sources: the quarterly Form 13F data sets, the ticker file and issuer SIC codes.
// Every request carries SEC_USER_AGENT (SEC asks for a name and an email) and waits between calls.
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';

const SEC = 'https://www.sec.gov';
const DATA_SETS_PAGE = `${SEC}/data-research/sec-markets-data/form-13f-data-sets`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function userAgent() {
  const agent = process.env.SEC_USER_AGENT?.trim();
  if (!agent || !/@/.test(agent)) throw new Error('Set SEC_USER_AGENT to a name and contact email, e.g. "Heavy Numbers you@example.com"');
  return agent;
}

let last = 0;
async function secFetch(url) {
  for (let attempt = 0; ; attempt++) {
    const wait = last + 150 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    const response = await fetch(url, { headers: { 'User-Agent': userAgent(), 'Accept-Encoding': 'gzip, deflate' } });
    if (response.ok || response.status === 404) return response;
    if (attempt >= 4) throw new Error(`SEC ${response.status} for ${url}`);
    await sleep(2000 * 2 ** attempt);
  }
}

/** The data sets SEC lists, newest first: { url, file }. Each covers three months of filing dates. */
export async function listDataSets() {
  const html = await (await secFetch(DATA_SETS_PAGE)).text();
  const urls = [...new Set([...html.matchAll(/href="([^"]*form13f\.zip)"/gi)].map(match => new URL(match[1], SEC).href))];
  const sets = urls.map(url => {
    const file = url.split('/').pop();
    const match = file.match(/^(\d{2})([a-z]{3})(\d{4})-(\d{2})([a-z]{3})(\d{4})_/i);
    if (!match) return null;
    const day = (d, m, y) => new Date(Date.parse(`${d} ${m} ${y} UTC`)).toISOString().slice(0, 10);
    return { url, file, start: Date.parse(`${match[1]} ${match[2]} ${match[3]} UTC`), end: day(match[4], match[5], match[6]) };
  }).filter(Boolean).sort((a, b) => b.start - a.start);
  if (!sets.length) throw new Error('No 13F data sets found on the SEC page');
  return sets;
}

/** A text document from SEC, or null when SEC has none (404). */
export async function secText(url) {
  const response = await secFetch(url);
  return response.ok ? response.text() : null;
}

/** The folder holding a data set's files: the unzip target, or the one folder inside it (older zips nest one). */
function dataSetFolder(target) {
  if (existsSync(path.join(target, 'INFOTABLE.tsv'))) return target;
  if (!existsSync(target)) return null;
  const inner = readdirSync(target).map(name => path.join(target, name)).find(folder => existsSync(path.join(folder, 'INFOTABLE.tsv')));
  return inner ?? null;
}

/** Downloads and unzips one data set into dir/<name>/ unless it is already there; returns its folder. */
export async function fetchDataSet(set, dir) {
  const target = path.join(dir, set.file.replace(/\.zip$/, ''));
  const found = dataSetFolder(target);
  if (found) return found;
  mkdirSync(dir, { recursive: true });
  const zip = path.join(dir, set.file);
  if (!existsSync(zip)) {
    const response = await secFetch(set.url);
    if (!response.ok) throw new Error(`SEC ${response.status} for ${set.url}`);
    writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
  }
  execFileSync('unzip', ['-o', '-q', zip, '-d', target]);
  const folder = dataSetFolder(target);
  if (!folder) throw new Error(`No INFOTABLE.tsv in ${set.file}`);
  return folder;
}

/** Calls onRow(object) for every line of a SEC tab-separated file, keyed by its header. */
export async function readTsv(file, onRow) {
  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let header = null;
  for await (const line of lines) {
    if (!header) { header = line.split('\t'); continue; }
    if (!line) continue;
    const cells = line.split('\t'), row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i] ?? '';
    onRow(row);
  }
}

/** SEC's ticker file: ticker → { cik, exchange }. */
export async function fetchTickers() {
  const data = await (await secFetch(`${SEC}/files/company_tickers_exchange.json`)).json();
  const index = new Map();
  for (const [cik, name, ticker, exchange] of data.data) if (ticker) index.set(String(ticker).toUpperCase().replace(/[./]/g, '-'), { cik: String(cik).padStart(10, '0'), name, exchange });
  return index;
}

/** Fills cache[cik] with the issuer's SIC code (or null) for every cik it lacks. */
export async function fillSic(ciks, cache) {
  const missing = [...new Set(ciks)].filter(cik => !(cik in cache));
  let done = 0;
  for (const cik of missing) {
    const response = await secFetch(`https://data.sec.gov/submissions/CIK${cik}.json`);
    const sic = response.ok ? String((await response.json()).sic ?? '') : '';
    cache[cik] = /^\d{3,4}$/.test(sic) ? sic : null;
    if (++done % 250 === 0) console.log(`  SIC codes: ${done} of ${missing.length}`);
  }
  return missing.length;
}

/** A company's XBRL facts from data.sec.gov, or null when SEC has none. */
export async function fetchCompanyFacts(cik) {
  const response = await secFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);
  return response.ok ? response.json() : null;
}

export const readJson = (file, fallback) => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
