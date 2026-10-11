// What a CUSIP is, from OpenFIGI's /v3/mapping results: its US ticker, name and kind (stock, etp, fund, adr,
// preferred, other). data/security-reference.json holds these entries for known CUSIPs; the build asks
// OpenFIGI only for new ones.
// OpenFIGI securityType2 is the broad class; securityType refines it. The
// values below were read from OpenFIGI results, not assumed.
const STOCK_CLASSES = new Set(['Common Stock', 'REIT', 'Partnership Shares', 'Tracking Stk']);
const FUND_TYPES = new Set(['Closed-End Fund', 'Open-End Fund', 'Unit Inv Tr', 'Fund of Funds', 'Mutual Fund', 'Hedge Fund', 'Money Market']);
function securityKind(securityType, securityType2) {
  if (!securityType && !securityType2) return null;
  // ETP covers ETFs and exchange-traded notes (VXX is a note), so it stays one broad kind.
  if (securityType === 'ETP') return 'etp';
  if (securityType === 'NY Reg Shrs') return 'stock';
  if (securityType2 === 'Depositary Receipt') return 'adr';
  if (securityType2 === 'Mutual Fund' || FUND_TYPES.has(securityType)) return 'fund';
  if (securityType2 === 'Preferred Stock' || securityType === 'Preferred' || securityType === 'Preference') return 'preferred';
  if (STOCK_CLASSES.has(securityType2) || STOCK_CLASSES.has(securityType)) return 'stock';
  return 'other';
}

/** OpenFIGI writes share classes as BRK/B; the SEC ticker file, and so this
 * site, writes BRK-B. Anything that is not a plain exchange symbol is dropped. */
function normalizeTicker(value) {
  if (typeof value !== 'string') return null;
  const ticker = value.trim().toUpperCase().replace(/[/.]/g, '-');
  return /^[A-Z0-9]{1,7}(?:-[A-Z0-9]{1,4})?$/.test(ticker) ? ticker : null;
}

const agreed = values => {
  const unique = [...new Set(values)];
  return unique.length === 1 ? unique[0] : null;
};
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;

/** One reference entry from one CUSIP's OpenFIGI results, or null when
 * OpenFIGI knows nothing. Only the US composite listing supplies a ticker. */
export function selectReferenceEntry(data) {
  const rows = (Array.isArray(data) ? data : []).filter(row => row && typeof row === 'object');
  if (!rows.length) return null;
  const us = rows.filter(row => row.exchCode === 'US').sort((a, b) => String(a.compositeFIGI).localeCompare(String(b.compositeFIGI)) || String(a.figi).localeCompare(String(b.figi)));
  const basis = us.length ? us : rows;
  const tickers = us.map(row => normalizeTicker(row.ticker));
  return {
    ticker: tickers.includes(null) ? null : agreed(tickers),
    name: agreed(basis.map(row => text(row.name))),
    kind: agreed(basis.map(row => securityKind(text(row.securityType), text(row.securityType2)))),
    compositeFigi: us.length ? agreed(us.map(row => text(row.compositeFIGI))) : null,
    securityType: agreed(basis.map(row => text(row.securityType))),
    securityType2: agreed(basis.map(row => text(row.securityType2))),
  };
}

/** Parse complete cache lines only; a line still being appended is ignored so
 * the digest always describes exactly the bytes that were used. The latest
 * line of each query kind wins for a CUSIP. */
