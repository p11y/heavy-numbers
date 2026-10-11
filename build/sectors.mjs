// Sectors for stocks: a short reviewed ticker list, else the issuer's SEC industry code (SIC) by range.
export const SECTORS = Object.freeze([
  ['chips', 'Chips'], ['software', 'Software & internet'], ['hardware', 'Computer hardware'], ['banks', 'Banks & payments'],
  ['insurance', 'Insurance'], ['markets', 'Asset managers & exchanges'], ['health', 'Health & biotech'], ['energy', 'Energy'],
  ['power', 'Utilities & power'], ['industrials', 'Industrials & defense'], ['consumer', 'Consumer'], ['realestate', 'Real estate'],
  ['materials', 'Materials & mining'], ['media', 'Media & telecom'], ['transport', 'Transport'], ['other', 'Other'],
].map(([key, name]) => Object.freeze({ key, name })));

// [first, last, sector]: the first range holding the code wins.
const SIC_RANGES = Object.freeze([
  [1220, 1241, 'energy'], [1311, 1389, 'energy'], [100, 999, 'consumer'], [1000, 1499, 'materials'],
  [1520, 1531, 'consumer'], [1500, 1799, 'industrials'],
  [2833, 2836, 'health'], [2840, 2844, 'consumer'], [2000, 2399, 'consumer'], [2400, 2499, 'materials'], [2500, 2599, 'consumer'],
  [2600, 2699, 'materials'], [2700, 2799, 'media'], [2800, 2899, 'materials'], [2900, 2999, 'energy'], [3000, 3099, 'materials'],
  [3100, 3199, 'consumer'], [3200, 3399, 'materials'], [3400, 3499, 'industrials'], [3570, 3579, 'hardware'], [3500, 3599, 'industrials'],
  [3630, 3639, 'consumer'], [3651, 3651, 'consumer'], [3652, 3652, 'media'], [3660, 3669, 'hardware'], [3674, 3674, 'chips'],
  [3670, 3679, 'hardware'], [3600, 3699, 'industrials'], [3710, 3716, 'consumer'], [3751, 3751, 'consumer'], [3790, 3799, 'consumer'],
  [3700, 3799, 'industrials'], [3825, 3825, 'hardware'], [3826, 3826, 'health'], [3827, 3827, 'hardware'], [3840, 3851, 'health'],
  [3800, 3859, 'industrials'], [3860, 3999, 'consumer'],
  [4610, 4619, 'energy'], [4000, 4799, 'transport'], [4800, 4899, 'media'], [4922, 4923, 'energy'], [4950, 4959, 'industrials'], [4900, 4999, 'power'],
  [5045, 5045, 'hardware'], [5047, 5047, 'health'], [5122, 5122, 'health'], [5171, 5172, 'energy'], [5000, 5099, 'industrials'], [5100, 5999, 'consumer'],
  [6324, 6324, 'health'], [6000, 6199, 'banks'], [6200, 6299, 'markets'], [6300, 6499, 'insurance'], [6500, 6599, 'realestate'],
  [6798, 6798, 'realestate'], [6792, 6792, 'energy'], [6795, 6795, 'materials'], [6770, 6770, 'other'], [6700, 6799, 'markets'],
  [7370, 7379, 'software'], [7310, 7319, 'media'], [7000, 7299, 'consumer'], [7300, 7399, 'industrials'], [7500, 7599, 'consumer'],
  [7600, 7699, 'industrials'], [7800, 7899, 'media'], [7900, 7999, 'consumer'], [8000, 8099, 'health'], [8731, 8731, 'health'],
  [8200, 8299, 'consumer'], [8880, 8899, 'other'], [8100, 8999, 'industrials'],
]);
// Reviewed: big names whose SIC code files them where a reader would not look.
const TICKER_SECTORS = Object.freeze({
  AMZN: 'software', CPNG: 'software', MELI: 'software', PDD: 'software', SE: 'software', BABA: 'software', JD: 'software',
  UBER: 'software', DASH: 'software', ABNB: 'software', BKNG: 'software', PANW: 'software', FTNT: 'software',
  V: 'banks', MA: 'banks', PYPL: 'banks', MCO: 'markets', SPGI: 'markets', MSCI: 'markets', BN: 'markets',
  TMO: 'health', DHR: 'health', CVS: 'health', DIS: 'media', SHW: 'materials', LNG: 'energy', CQP: 'energy', SPCX: 'industrials',
  QCOM: 'chips', ARM: 'chips', LRCX: 'chips', KLAC: 'chips', TER: 'chips', ASML: 'chips', AMAT: 'chips', ENTG: 'chips', MKSI: 'chips', ONTO: 'chips', CAMT: 'chips',
  VST: 'power', TLN: 'power', CEG: 'power', NRG: 'power', OKLO: 'power', SMR: 'power', GEV: 'power', BE: 'power',
  MARA: 'software', RIOT: 'software', CLSK: 'software', HUT: 'software', WULF: 'software', CORZ: 'software', IREN: 'software', CIFR: 'software', APLD: 'software', BTDR: 'software',
});

const normTicker = ticker => String(ticker ?? '').trim().toUpperCase().replace(/[./ ]/g, '-');

/** The sector key of a SIC code, else 'other'. */
function sicSector(sic) {
  const code = Number(sic);
  if (!Number.isInteger(code) || code <= 0) return 'other';
  return SIC_RANGES.find(([first, last]) => code >= first && code <= last)?.[2] ?? 'other';
}
/** A stock's sector key: the reviewed ticker list, else its SIC code's. */
export const stockSector = ({ ticker = null, sic = null } = {}) => TICKER_SECTORS[normTicker(ticker)] ?? sicSector(sic);
