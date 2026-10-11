// The bottleneck board: for companies along the AI build-out, order backlog against sales, from the numbers
// they file with SEC in XBRL (data.sec.gov company facts). Backlog here is "remaining performance
// obligations": work a customer has contracted for and the company has not yet delivered. When backlog grows
// much faster than sales, orders are arriving faster than the company can ship, so that link is a constraint.

/** Layers, top of the chain first: ticker → the name a reader knows. Each is a US filer whose 10-K and 10-Q carry XBRL. */
export const LAYERS = Object.freeze([
  { key: 'cloud', name: 'Cloud and AI labs', note: 'The buyers: what they spend on buildings and equipment, and the cloud contracts they have signed', companies: { MSFT: 'Microsoft', GOOGL: 'Alphabet', AMZN: 'Amazon', META: 'Meta Platforms', ORCL: 'Oracle', CRWV: 'CoreWeave' } },
  { key: 'chips', name: 'Chips and memory', note: 'Accelerators, custom chips and the memory beside them', companies: { NVDA: 'Nvidia', AVGO: 'Broadcom', AMD: 'AMD', MU: 'Micron', MRVL: 'Marvell', INTC: 'Intel', SNDK: 'Sandisk', WDC: 'Western Digital', STX: 'Seagate' } },
  { key: 'tools', name: 'Chip tools and packaging', note: 'The machines that make chips, and the plants that package them', companies: { AMAT: 'Applied Materials', LRCX: 'Lam Research', KLAC: 'KLA', TER: 'Teradyne', ONTO: 'Onto Innovation', AMKR: 'Amkor' } },
  { key: 'network', name: 'Networking and optics', note: 'Switches, optical links and the chips that connect accelerators', companies: { ANET: 'Arista Networks', CSCO: 'Cisco', CIEN: 'Ciena', COHR: 'Coherent', LITE: 'Lumentum', CRDO: 'Credo', ALAB: 'Astera Labs', FN: 'Fabrinet' } },
  { key: 'servers', name: 'Servers', note: 'Racks assembled around the chips', companies: { DELL: 'Dell', SMCI: 'Supermicro', HPE: 'Hewlett Packard Enterprise' } },
  { key: 'gear', name: 'Power and cooling gear', note: 'Turbines, switchgear, fuel cells and cooling for data centers', companies: { GEV: 'GE Vernova', VRT: 'Vertiv', ETN: 'Eaton', POWL: 'Powell Industries', HUBB: 'Hubbell', NVT: 'nVent', MOD: 'Modine', BE: 'Bloom Energy' } },
  { key: 'power', name: 'Power and fuel', note: 'Generators selling electricity, and nuclear fuel and reactors', companies: { CEG: 'Constellation Energy', VST: 'Vistra', TLN: 'Talen Energy', NRG: 'NRG Energy', LEU: 'Centrus Energy', BWXT: 'BWX Technologies', OKLO: 'Oklo', SMR: 'NuScale Power' } },
  { key: 'build', name: 'Building it', note: 'Grid and data-center construction, and the data-center landlords', companies: { PWR: 'Quanta Services', EME: 'EMCOR', FIX: 'Comfort Systems', MTZ: 'MasTec', STRL: 'Sterling Infrastructure', EQIX: 'Equinix', DLR: 'Digital Realty' } },
]);

const REVENUE = ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues', 'RevenueFromContractWithCustomerIncludingAssessedTax'];
const CAPEX = ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'];
const BACKLOG = ['RevenueRemainingPerformanceObligation'];
const DAY = 864e5;
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY;
/** A figure older than this is not the company's latest, so it is left out rather than shown as current. */
const STALE_DAYS = 200;

/**
 * One tag's USD facts, one per period, oldest first: the latest filed, except that a full year comes from an
 * annual report when there is one, since a quarterly filing sometimes repeats a year under a wrong figure.
 */
function factsOf(gaap, tag) {
  const byPeriod = new Map();
  const annual = f => f.start && days(f.start, f.end) > 350 && /^10-K/.test(f.form);
  for (const f of gaap?.[tag]?.units?.USD ?? []) {
    const key = `${f.start ?? ''}|${f.end}`, had = byPeriod.get(key);
    if (!had || (annual(f) - annual(had) || f.filed.localeCompare(had.filed)) > 0) byPeriod.set(key, f);
  }
  return [...byPeriod.values()].sort((a, b) => a.end.localeCompare(b.end));
}
const near = (list, end, tolerance) => list.filter(f => Math.abs(days(f.end, end)) <= tolerance).sort((a, b) => Math.abs(days(a.end, end)) - Math.abs(days(b.end, end)))[0] ?? null;

/**
 * Twelve months of a flow (revenue, capex) ending at end: a full-year figure, or year-to-date plus the last
 * full year minus the same stretch a year before. Null when the filings do not allow it.
 */
function trailingYear(facts, end) {
  const ending = facts.filter(f => f.start && Math.abs(days(f.end, end)) <= 10);
  const year = ending.find(f => Math.abs(days(f.start, f.end) - 364) <= 10);
  if (year) return { end: year.end, value: year.val };
  // The longest year-to-date stretch ending here (Q3 YTD beats Q3 alone).
  const ytd = ending.filter(f => days(f.start, f.end) < 350).sort((a, b) => days(b.start, b.end) - days(a.start, a.end))[0];
  if (!ytd) return null;
  const fullYear = facts.find(f => f.start && Math.abs(days(f.end, ytd.start)) <= 10 && Math.abs(days(f.start, f.end) - 364) <= 10);
  const span = days(ytd.start, ytd.end);
  const before = facts.find(f => f.start && Math.abs(days(f.end, ytd.end) - 364) <= 10 && Math.abs(days(f.start, f.end) - span) <= 10 && days(f.end, ytd.end) > 300);
  if (!fullYear || !before) return null;
  return { end: ytd.end, value: ytd.val + fullYear.val - before.val };
}

/** The latest trailing year of a flow, across candidate tags, and the year before it. */
function flow(gaap, tags, asOf) {
  let best = null;
  for (const tag of tags) {
    const facts = factsOf(gaap, tag);
    for (const end of [...new Set(facts.map(f => f.end))].sort().reverse().slice(0, 3)) {
      const now = trailingYear(facts, end);
      if (!now) continue;
      if (!best || now.end > best.now.end) {
        const lastYear = new Date(Date.parse(now.end) - 364 * DAY).toISOString().slice(0, 10);
        const ends = [...new Set(facts.map(f => f.end))].filter(e => Math.abs(days(e, lastYear)) <= 10);
        best = { tag, now, before: ends.length ? trailingYear(facts, ends[0]) : null };
      }
      break;
    }
  }
  if (!best || days(best.now.end, asOf) > STALE_DAYS) return null;
  return { end: best.now.end, value: best.now.value, before: best.before?.value ?? null };
}

/** The latest backlog and the one about a year before it. */
function stock(gaap, tags, asOf) {
  for (const tag of tags) {
    const facts = factsOf(gaap, tag).filter(f => !f.start);
    const last = facts.at(-1);
    if (!last || days(last.end, asOf) > STALE_DAYS) continue;
    const yearBefore = near(facts, new Date(Date.parse(last.end) - 364 * DAY).toISOString().slice(0, 10), 45);
    return { end: last.end, value: last.val, before: yearBefore?.val ?? null, accession: last.accn, history: facts.slice(-5).map(f => [f.end, f.val]) };
  }
  return null;
}

const growth = (now, before) => now != null && before > 0 ? now / before - 1 : null;

/** One company's row from its SEC company facts. */
export function companyRow(ticker, name, facts, asOf) {
  const gaap = facts?.facts?.['us-gaap'] ?? {};
  const revenue = flow(gaap, REVENUE, asOf), capex = flow(gaap, CAPEX, asOf), backlog = stock(gaap, BACKLOG, asOf);
  return {
    ticker, name, cik: facts?.cik ?? null,
    revenue, capex, backlog,
    revenueGrowth: growth(revenue?.value, revenue?.before),
    capexGrowth: growth(capex?.value, capex?.before),
    backlogGrowth: growth(backlog?.value, backlog?.before),
    // Years of sales already booked.
    cover: backlog && revenue?.value > 0 ? backlog.value / revenue.value : null,
  };
}

/**
 * Backlog worth under two months of sales is mostly service contracts, not orders for what the company
 * ships, so it says little about a constraint.
 */
export const MIN_COVER = 0.15;
export const meaningful = r => r.cover != null && r.cover >= MIN_COVER;

/** A layer's totals over the companies that report both figures a year apart, so the growth rates compare like with like. */
function layerTotals(rows) {
  const sum = (list, f) => list.reduce((n, r) => n + f(r), 0);
  // One company is not a layer: below two, the layer shows no totals.
  let both = rows.filter(r => meaningful(r) && r.backlog.before > 0 && r.revenue?.before > 0);
  const reporting = both.length;
  if (both.length < 2) both = [];
  const withCapex = rows.filter(r => r.capex?.before > 0);
  return {
    reporting,
    backlogGrowth: both.length ? sum(both, r => r.backlog.value) / sum(both, r => r.backlog.before) - 1 : null,
    revenueGrowth: both.length ? sum(both, r => r.revenue.value) / sum(both, r => r.revenue.before) - 1 : null,
    capex: withCapex.length ? sum(withCapex, r => r.capex.value) : null,
    capexGrowth: withCapex.length ? sum(withCapex, r => r.capex.value) / sum(withCapex, r => r.capex.before) - 1 : null,
  };
}

/**
 * The board: every layer with its companies and totals. getFacts(cik) returns a company's SEC company facts
 * (or null); tickers maps a ticker to { cik }.
 */
export async function buildBoard({ tickers, getFacts, asOf = new Date().toISOString().slice(0, 10) }) {
  const layers = [];
  for (const layer of LAYERS) {
    const rows = [];
    for (const [ticker, name] of Object.entries(layer.companies)) {
      const cik = tickers.get(ticker)?.cik;
      const facts = cik ? await getFacts(cik) : null;
      if (facts) rows.push(companyRow(ticker, name, facts, asOf));
    }
    layers.push({ ...layer, rows, totals: layerTotals(rows) });
  }
  return { asOf, layers };
}
