// The site's HTML: plain template strings over site/site.css, with no framework.
import { copyFileSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { quarterLabel, priorQuarter } from './model.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
// Pages reports http:// until its certificate is issued; the site is always served over HTTPS after that.
const SITE = (process.env.SITE_URL || 'https://heavynumbers.com').replace(/\/$/, '').replace(/^http:\/\//, 'https://');
// The site's path under its host: '' on its own domain, '/heavy-numbers' on <user>.github.io before one is set.
const BASE = (process.env.BASE_PATH || '').replace(/\/$/, '');
/** Root-relative links and assets in a page, moved under BASE. Canonical URLs already carry it through SITE. */
const based = html => BASE ? html.replace(/(href|src|content)="\/(?!\/)/g, `$1="${BASE}/`).replace(/url=\/(?!\/)/g, `url=${BASE}/`) : html;
const REPO = 'https://github.com/p11y/heavy-numbers';
// The chart's colors: site.css's --ink, --text-primary, --text-body, --text-tertiary and --data-1.
const COLORS = { ink: [17, 17, 17], textPrimary: [243, 240, 233], textBody: [217, 213, 207], textTertiary: [140, 137, 130], data1: [217, 213, 207] };
const rgba = (token, alpha = 1) => `rgba(${COLORS[token].join(', ')}, ${alpha})`;
const FUND_ROWS = 150, STOCK_ROWS = 200, SOLD_ROWS = 50, INDEX_ROWS = 500, SECTOR_ROWS = 50;

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = v => {
  const a = Math.abs(v);
  const [d, s] = a >= 1e12 ? [1e12, 'T'] : a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'K'] : [1, ''];
  const n = v / d;
  return `$${n.toFixed(d === 1 ? 0 : Math.abs(n) >= 100 ? 0 : 1)}${s}`;
};
const int = v => Math.round(v).toLocaleString('en-US');
const pct = (v, digits = 1) => `${(100 * v).toFixed(digits)}%`;
const signed = (v, digits = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(100 * v).toFixed(digits)}`;
const date = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const secFiling = report => `https://www.sec.gov/Archives/edgar/data/${Number(report.cik)}/${report.base.accession.replace(/-/g, '')}/`;

const CHANGE = { new: ['New', 'hf-new'], added: ['Added', 'hf-increased'], cut: ['Cut', 'hf-reduced'], sold: ['Sold out', 'hf-exited'], same: ['Held', 'hf-muted'] };
function change(h) {
  if (!h.change) return '<span class="hf-muted">—</span>';
  const [label, cls] = CHANGE[h.change];
  const amount = (h.change === 'added' || h.change === 'cut') && h.changePct != null && Number.isFinite(h.changePct) ? ` ${signed(h.changePct, 0)}%` : '';
  return `<span class="hf-badge ${cls}">${label}${amount}</span>`;
}

export function renderSite({ out, period, prior, partial, priorFilers, funds, stocks, sectors, securities, builtAt, dataSets }) {
  let pages = 0, bytes = 0;
  const write = (rel, html) => {
    const file = path.join(out, rel);
    mkdirSync(path.dirname(file), { recursive: true });
    if (rel.endsWith('.html')) html = based(html);
    writeFileSync(file, html);
    pages += rel.endsWith('.html') ? 1 : 0;
    bytes += Buffer.byteLength(html);
  };
  const Q = quarterLabel(period), P = quarterLabel(prior), SHOWN = Q;
  const fundHref = f => `/funds/${f.slug}/`;
  const stockOf = new Map(stocks.map(s => [s.i, s]));
  const tv = s => s?.tv ? ` data-tv="${esc(s.tv)}"` : '';
  const stockCell = i => {
    const s = securities[i], page = stockOf.get(i);
    const tag = s.ticker ? `<span class="hf-ticker">${esc(s.ticker)}</span>` : '';
    const name = page ? `<a class="hf-name" href="/stocks/${page.slug}/">${esc(s.label)}</a>` : `<span class="hf-name">${esc(s.label)}</span>`;
    return `${tag}${name}<span class="hf-subtext">${esc(s.title || s.kind || '')}</span>`;
  };
  const stockLink = s => `<span class="hf-ticker">${esc(s.security.ticker)}</span><a class="hf-name" href="/stocks/${s.slug}/">${esc(s.security.label)}</a>`;
  const sectorName = new Map(sectors.map(s => [s.key, s.name]));
  const cur = funds.filter(f => f.current);
  const filed = cur.map(f => f.report.filedAt).sort();
  const concentrated = cur.filter(f => f.concentrated);
  const soFar = partial ? ' so far' : '';
  const concentratedWithPrior = concentrated.filter(f => f.hasPrior);

  // Discover
  const top = (key, n) => stocks.filter(s => s[key] > 0 && !s.firstQuarter).sort((a, b) => b[key] - a[key] || b.concentratedHolders - a.concentratedHolders || b.value - a.value).slice(0, n);
  const listTable = (rows, first, cells) => table([['Stock'], [first, 1], ['Held by concentrated funds', 1], ['Value held by all filers', 1, 1], ['Sector', 0, 1]],
    rows.map(s => `<tr${tv(s)}><th>${stockLink(s)}</th>${cells(s)}<td class="hf-numeric">${int(s.concentratedHolders)}</td><td class="hf-numeric hf-optional">${money(s.value)}</td><td class="hf-optional"><a class="hf-muted" href="/sectors/${s.sector}/">${esc(sectorName.get(s.sector))}</a></td></tr>`));
  const opens = concentratedWithPrior.reduce((n, f) => n + f.holdings.filter(h => h.change === 'new').length, 0);
  const sectorRows = sectors.filter(s => s.key !== 'other' || s.now).map(s => {
    const totalNow = sectors.reduce((n, x) => n + x.now, 0), totalBefore = sectors.reduce((n, x) => n + x.before, 0);
    return { ...s, share: totalNow ? s.now / totalNow : 0, was: totalBefore ? s.before / totalBefore : 0 };
  }).sort((a, b) => b.share - a.share);
  const sectorTable = table([['Sector'], ['Share of their stock money', 1], [`Change since ${P}`, 1], ['Positions opened', 1], ['Sold out', 1, 1]],
    sectorRows.map(s => `<tr><th><a class="hf-name" href="/sectors/${s.key}/">${esc(s.name)}</a></th><td class="hf-numeric">${pct(s.share)}</td><td class="hf-numeric">${signed(s.share - s.was)} pts</td><td class="hf-numeric">${int(s.opened)}</td><td class="hf-numeric hf-optional">${int(s.soldOut)}</td></tr>`));
  write('index.html', layout({ title: `What concentrated funds bought in ${Q}`, path: '/', current: '/', description: `The stocks concentrated funds opened, made big bets on and sold out in ${Q}, from SEC 13F filings.`, body: `
    ${head(`13F filings · ${Q}${partial ? ' · still being filed' : ''}`, `What concentrated funds bought in ${Q}`, `${date(period)}`, partial ? `${int(cur.length)} of about ${int(priorFilers)} filers in so far, through ${date(filed.at(-1))}` : `${int(cur.length)} filers, filed through ${date(filed.at(-1))}`)}
    ${stats([[`Filers this quarter${soFar}`, int(cur.length)], ['Concentrated funds', `<a class="hf-statlink" href="/methodology/#concentrated">${int(concentrated.length)}</a>`], ['Positions they opened', int(opens)]])}
    ${section('Most opened', `Stocks the most concentrated funds bought new in ${Q}`, listTable(top('opened', 25), 'Funds that opened it', s => `<td class="hf-numeric">${int(s.opened)}</td>`), 'opened')}
    ${section('Biggest new bets', `New positions worth 3% or more of the fund`, listTable(top('bigBets', 20), 'Funds betting 3%+', s => `<td class="hf-numeric">${int(s.bigBets)}</td>`), 'bets')}
    ${section('Most sold out', `Stocks the most concentrated funds left entirely, leaving out mergers and delistings`, listTable(top('soldOut', 20), 'Funds that sold out', s => `<td class="hf-numeric">${int(s.soldOut)}</td>`), 'sold')}
    ${section('New to 13F filings', `IPOs and spin-offs no filer held at ${date(prior)}`, listTable(stocks.filter(s => s.firstQuarter && s.concentratedHolders).sort((a, b) => b.concentratedHolders - a.concentratedHolders || b.value - a.value).slice(0, 10), 'All filers holding', s => `<td class="hf-numeric">${int(s.holders.length)}</td>`), 'new')}
    ${section('Sectors', `Where concentrated funds' stock money sits, against the same funds in ${P}`, sectorTable, 'sectors')}
    ${partial ? `<p class="hf-caption">Funds have until 45 days after the quarter ends to file, so these lists cover the ${int(cur.length)} filers in so far and will fill in as the rest file. They update every day.</p>` : ''}
    <p class="hf-caption">These lists describe what funds did; they are not a signal to copy. When we tested lists like these against the S&amp;P 500 over 2024 to 2025, none beat a random stock the same funds held, and a fund's good year did not predict its next one. <a class="hf-inline-link" href="/methodology/">How this works</a>.</p>` }));

  // Funds
  write('funds/index.html', layout({ title: 'Funds', path: '/funds/', current: '/funds/', description: `Every 13F filer's latest holdings, largest first.`, body: `
    ${head(`13F filers · ${Q}`, 'Funds', date(period), partial ? `${int(cur.length)} filers have filed ${Q} so far; the rest show ${P}. Search finds any of them.` : `${int(funds.length)} filers. Search finds any of them.`)}
    ${section(`The ${INDEX_ROWS} largest`, 'By reported value', table([['Fund'], ['Reported value', 1], ['Positions', 1], ['Filed', 1, 1]],
      funds.slice(0, INDEX_ROWS).map(f => `<tr><th><a class="hf-name" href="${fundHref(f)}">${esc(f.name)}</a><span class="hf-subtext">${esc(f.city)}${f.concentrated ? ' · concentrated' : ''}${f.current ? '' : ` · ${quarterLabel(f.period)} report`}</span></th><td class="hf-numeric">${money(f.total)}</td><td class="hf-numeric">${int(f.holdings.length)}</td><td class="hf-numeric hf-optional">${date(f.report.filedAt)}</td></tr>`)))}` }));
  for (const f of funds) {
    const opened = f.holdings.filter(h => h.change === 'new').length;
    const Q = quarterLabel(f.period), P = quarterLabel(priorQuarter(f.period)), period = f.period, prior = priorQuarter(f.period);
    const notes = [
      !f.current && `This filer has not filed its ${SHOWN} 13F yet. This is its ${Q} report.`,
      f.report.confidential && 'This filing says some holdings were left out under confidential treatment.',
      f.unitFixed && 'This filing reported values in thousands of dollars; they are shown here in dollars.',
      f.holdings.length > FUND_ROWS && `Showing the ${FUND_ROWS} largest of ${int(f.holdings.length)} positions. The full list is in the SEC filing.`,
      f.predecessor && `Changes since ${P} are measured against the holdings ${f.predecessor} reported, which this filer now reports.`,
      !f.hasPrior && `No ${P} report from this filer is in the data, so changes are not shown.`,
    ].filter(Boolean);
    write(`funds/${f.slug}/index.html`, layout({ title: `${f.name} 13F holdings, ${Q}`, path: fundHref(f), current: '/funds/', description: `${f.name}: ${int(f.holdings.length)} positions worth ${money(f.total)} in its ${Q} 13F, with what it opened, added, cut and sold out.`, body: `
      <a class="hf-back" href="/funds/">← Funds</a>
      ${head(`Fund · CIK ${Number(f.cik)}${f.concentrated ? ' · concentrated' : ''}`, f.name, date(period), `Filed ${date(f.report.filedAt)} · <a class="hf-inline-link" href="${secFiling(f.report)}" rel="noreferrer">SEC filing ↗</a>`, 'hf-detailhead')}
      ${stats([['Reported value', money(f.total) + (f.priorTotal ? ` <small class="hf-muted">${signed(f.total / f.priorTotal - 1, 0)}%</small>` : '')], ['Positions', int(f.holdings.length)], ['Opened · sold out', f.hasPrior ? `${int(opened)} · ${int(f.sold.length)}` : '—']])}
      ${historySection(f.history, [['Reported value', h => money(h.value), h => h.value], ['Positions', h => int(h.positions)], ['Opened', h => h.opened == null ? '—' : int(h.opened)], ['Sold out', h => h.sold == null ? '—' : int(h.sold)]])}
      ${section('Holdings', `Share positions at ${date(period)}`, table([['Stock'], ['% of fund', 1], ['Value', 1], ['Shares', 1, 1], [`Since ${P}`]],
        f.holdings.slice(0, FUND_ROWS).map(h => `<tr${tv(stockOf.get(h.i))}><th>${stockCell(h.i)}</th><td class="hf-numeric">${pct(h.weight)}</td><td class="hf-numeric">${money(h.value)}</td><td class="hf-numeric hf-optional">${int(h.shares)}</td><td>${change(h)}</td></tr>`)))}
      ${f.sold.length ? section('Sold out', `Held at ${date(prior)}, gone at ${date(period)}`, table([['Stock'], [`% of fund in ${P}`, 1], [`Value in ${P}`, 1]],
        f.sold.slice(0, SOLD_ROWS).map(s => `<tr${tv(stockOf.get(s.i))}><th>${stockCell(s.i)}${s.gone ? '<span class="hf-subtext">Merged away or delisted</span>' : ''}</th><td class="hf-numeric">${pct(s.weight)}</td><td class="hf-numeric">${money(s.value)}</td></tr>`))) : ''}
      ${notes.map(n => `<p class="hf-caption">${esc(n)}</p>`).join('')}` }));
  }

  // Stocks
  const byHolders = [...stocks].sort((a, b) => b.holders.length - a.holders.length || b.value - a.value);
  write('stocks/index.html', layout({ title: 'Stocks', path: '/stocks/', current: '/stocks/', description: `The stocks most held by 13F filers, from their latest filings.`, body: `
    ${head(`13F holdings · ${Q}`, 'Stocks', date(period), `${int(stocks.length)} stocks. Search finds any of them.`)}
    ${section(`The ${INDEX_ROWS} most held`, 'By number of 13F filers', table([['Stock'], ['Filers', 1], ['Concentrated funds', 1], ['Value held', 1, 1], ['Sector', 0, 1]],
      byHolders.slice(0, INDEX_ROWS).map(s => `<tr${tv(s)}><th>${stockLink(s)}</th><td class="hf-numeric">${int(s.holders.length)}</td><td class="hf-numeric">${int(s.concentratedHolders)}</td><td class="hf-numeric hf-optional">${money(s.value)}</td><td class="hf-optional"><a class="hf-muted" href="/sectors/${s.sector}/">${esc(sectorName.get(s.sector))}</a></td></tr>`)))}` }));
  for (const s of stocks) {
    const holders = s.holders.length;
    write(`stocks/${s.slug}/index.html`, layout({ title: `${s.security.label} (${s.security.ticker}) 13F holders, ${Q}`, path: `/stocks/${s.slug}/`, current: '/stocks/', description: `${int(holders)} 13F filers held ${s.security.label} (${s.security.ticker}) at ${date(period)}: who opened, added, cut and sold out.`, body: `
      <a class="hf-back" href="/stocks/">← Stocks</a>
      ${head(`${esc(s.security.ticker)} · <a class="hf-inline-link" href="/sectors/${s.sector}/">${esc(sectorName.get(s.sector))}</a>`, s.security.label, date(period), `CUSIP ${esc(s.security.cusip)}`, 'hf-detailhead')}
      ${stats([['13F filers holding', int(holders)], ['Concentrated funds holding', int(s.concentratedHolders)], ['Concentrated funds: opened · sold out', `${int(s.opened)} · ${int(s.soldOut)}`]])}
      ${s.tv ? priceChart(s) : ''}
      ${historySection(s.history, [['Filers holding', h => int(h.holders), h => h.holders], ['Concentrated funds', h => int(h.concentrated)], ['Value held', h => money(h.value)]], partial ? period : null)}
      ${section('Holders', `By value held, from each filer's latest 13F`, table([['Fund'], ['% of fund', 1], ['Value', 1], ['Shares', 1, 1], [`Since ${P}`]],
        s.holders.slice(0, STOCK_ROWS).map(h => `<tr><th><a class="hf-name" href="${fundHref(h.fund)}">${esc(h.fund.name)}</a>${h.fund.concentrated || !h.fund.current ? `<span class="hf-subtext">${[h.fund.concentrated && 'concentrated', !h.fund.current && `${quarterLabel(h.fund.period)} report`].filter(Boolean).join(' · ')}</span>` : ''}</th><td class="hf-numeric">${pct(h.weight, 2)}</td><td class="hf-numeric">${money(h.value)}</td><td class="hf-numeric hf-optional">${int(h.shares)}</td><td>${change(h)}</td></tr>`)))}
      ${holders > STOCK_ROWS ? `<p class="hf-caption">Showing the ${STOCK_ROWS} largest of ${int(holders)} holders.</p>` : ''}` }));
  }

  // Sectors
  write('sectors/index.html', layout({ title: 'Sectors', path: '/sectors/', current: '/', description: `Where concentrated funds' stock money sat in ${Q}.`, body: `
    ${head(`Sectors · ${Q}`, 'Sectors', date(period), `${int(concentratedWithPrior.length)} concentrated funds that filed both quarters${soFar}`)}
    ${section('All sectors', `Share of concentrated funds' stock money, against ${P}`, sectorTable)}` }));
  for (const s of sectorRows) {
    write(`sectors/${s.key}/index.html`, layout({ title: `${s.name}: what concentrated funds hold, ${Q}`, path: `/sectors/${s.key}/`, current: '/', description: `${s.name} stocks held by concentrated funds in ${Q}.`, body: `
      <a class="hf-back" href="/sectors/">← Sectors</a>
      ${head(`Sector · ${Q}`, s.name, date(period), '', 'hf-detailhead')}
      ${stats([['Share of their stock money', `${pct(s.share)} <small class="hf-muted">${signed(s.share - s.was)} pts</small>`], ['Positions opened', int(s.opened)], ['Sold out', int(s.soldOut)]])}
      ${section(`The ${SECTOR_ROWS} most held`, 'By concentrated funds holding', table([['Stock'], ['Concentrated funds', 1], ['Opened', 1], ['Sold out', 1], ['All filers', 1, 1]],
        s.stocks.slice(0, SECTOR_ROWS).map(x => `<tr${tv(x)}><th>${stockLink(x)}</th><td class="hf-numeric">${int(x.concentratedHolders)}</td><td class="hf-numeric">${int(x.opened)}</td><td class="hf-numeric">${int(x.soldOut)}</td><td class="hf-numeric hf-optional">${int(x.holders.length)}</td></tr>`)))}` }));
  }

  // About
  write('methodology/index.html', layout({ title: 'How this works', path: '/methodology/', current: '/methodology/', description: 'Where the numbers come from and what they leave out.', body: `
    ${head('Methodology', 'How this works', date(period), `Built ${date(builtAt.slice(0, 10))}`)}
    <div class="hf-prose">
    <h2>Where the numbers come from</h2>
    <p>Every number is from SEC Form 13F filings, read from the <a class="hf-inline-link" href="https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets">quarterly 13F data sets</a> SEC publishes (this build: ${dataSets.map(esc).join(', ')}), plus every 13F filed since the newest data set closed, read one by one from <a class="hf-inline-link" href="https://www.sec.gov/Archives/edgar/full-index/">EDGAR's daily index</a>. Funds with $100M or more in US-listed securities must file within 45 days of each quarter end. The site rebuilds every day, so a filing shows up the day after it is made.</p>
    <p>The site shows the newest quarter with at least 1,000 filers in. While that quarter is still being filed, Discover and the sector figures read only the funds that have filed it, and a fund that has not filed yet shows its report for the quarter before, marked as such.</p>
    <p>A filer's quarter is its latest original report or restatement, plus any later amendment that adds holdings. Only share positions count: options and bonds are left out. A filing whose values sit about 1,000 times below every other filer's prices was filed in thousands of dollars, and is scaled up.</p>
    <h2>What the changes mean</h2>
    <p>Each holding is compared with the same filer's report for the quarter before, by CUSIP. <strong>New</strong> was not held then; <strong>Sold out</strong> is no longer held; <strong>Added</strong> and <strong>Cut</strong> compare share counts. When most holders' share counts move by the same split ratio and the price moves the other way, the earlier count is adjusted for the split. A security that changed CUSIP (after a merger or a reorganization) shows as one sold out and one new.</p>
    <h2>History and prices</h2>
    <p>Fund and stock pages show the last four quarters: a fund's reported value, positions, and what it opened and sold out each quarter; a stock's number of 13F holders, concentrated holders and value held. Stock prices and charts are TradingView's delayed widgets, loaded in your browser from TradingView; this site does not store prices.</p>
    <h2 id="concentrated">Concentrated funds</h2>
    <p>Discover reads only concentrated funds: a complete filing with 5 to 150 stock positions, at least $100M reported, at least 60% in operating-company stock and at most 25% in funds and ETFs. That leaves out index funds and banks, whose filings say little about choices. This quarter ${int(concentrated.length)} of ${int(cur.length)} filers${soFar} qualify.</p>
    <h2>Tickers and sectors</h2>
    <p>CUSIPs are matched to tickers through <a class="hf-inline-link" href="https://www.openfigi.com/">OpenFIGI</a>. Sectors come from each company's SEC industry code, with a short reviewed list of companies the code files somewhere a reader would not look.</p>
    <h2>Did following these funds work?</h2>
    <p>No. We tested lists like Discover's (most opened, 3%+ new bets, breadth, buying into weakness) from 2024 to 2025 against the S&amp;P 500 and against a random stock the same funds held. None beat the random stock by more than noise, and ranking funds by one year's results predicted nothing about the next (rank correlation −0.016). Quarterly 13F holdings arrive about 45 days late, and by then the market has read them too. Use this site to see who owns what, not to pick stocks.</p>
    <h2>Open source</h2>
    <p>This site is built from public data by <a class="hf-inline-link" href="${REPO}">code on GitHub</a>, rebuilt each day by GitHub Actions and served by GitHub Pages. It has no accounts and no tracking.</p>
    </div>` }));

  // Old addresses from the server-rendered site
  for (const [from, to] of [['bets', '/#bets'], ['opened', '/#opened'], ['filings', '/'], ['following', '/'], ['coverage', '/methodology/'], ['developers', '/methodology/'], ['privacy', '/methodology/'], ['activity', '/'], ['record', '/methodology/']]) {
    write(`${from}/index.html`, `<!doctype html><meta charset="utf-8"><title>Moved</title><link rel="canonical" href="${SITE}${to}"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0; url=${to}"><a href="${to}">Moved here</a>`);
  }
  write('404.html', layout({ title: 'Not found', path: '/404.html', current: '', description: 'Page not found.', body: `${head('404', 'Not found', '', 'Search for a fund or stock above, or go to <a class="hf-inline-link" href="/">Discover</a>.')}` }));

  // Search, sitemap, assets
  const index = [
    ...funds.map(f => [f.name, BASE + fundHref(f), 'f', '', Math.round(f.total / 1e6)]),
    ...stocks.map(s => [s.security.label, `${BASE}/stocks/${s.slug}/`, 's', s.security.ticker, Math.round(s.value / 1e6)]),
  ];
  write('search.json', JSON.stringify(index));
  const urls = ['/', '/funds/', '/stocks/', '/sectors/', '/methodology/', ...sectorRows.map(s => `/sectors/${s.key}/`), ...funds.map(fundHref), ...stocks.map(s => `/stocks/${s.slug}/`)];
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(u => `<url><loc>${SITE}${u}</loc></url>`).join('\n')}\n</urlset>\n`);
  write('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
  mkdirSync(path.join(out, 'assets'), { recursive: true });
  const site = path.join(root, '..', 'site');
  for (const file of ['site.css', 'search.js', 'price.js']) copyFileSync(path.join(site, file), path.join(out, 'assets', file));
  cpSync(path.join(site, 'brand'), path.join(out, 'brand'), { recursive: true });
  for (const file of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'icon-512.png']) copyFileSync(path.join(site, file), path.join(out, file));
  writeFileSync(path.join(out, '.nojekyll'), '');
  return { pages, bytes };
}

/**
 * The last four quarters, newest first. columns: [label, cell(summary) → HTML, bar(summary) → number?]; the
 * first column with a bar draws one beside its number, scaled to the largest quarter. A quarter still being
 * filed is marked "so far".
 */
function historySection(history, columns, partialPeriod = null) {
  if (history.filter(([, h]) => h).length < 2) return '';
  const [barLabel, , barOf] = columns.find(c => c[2]) ?? [];
  const most = Math.max(...history.map(([, h]) => (h && barOf ? barOf(h) : 0)));
  const rows = history.map(([q, h]) => {
    const label = `${quarterLabel(q)}${q === partialPeriod ? ' <span class="hf-muted">so far</span>' : ''}`;
    if (!h) return `<tr><th>${label}</th><td class="hf-muted" colspan="${columns.length}">Not filed</td></tr>`;
    return `<tr><th>${label}</th>${columns.map(([, cell, bar]) => `<td class="hf-numeric">${bar && most ? `<span class="hn-bar" style="width:${Math.max(2, Math.round(60 * bar(h) / most))}px" aria-hidden="true"></span>` : ''}${cell(h)}</td>`).join('')}</tr>`;
  });
  return section('Last four quarters', barLabel ? `Bars show ${barLabel.toLowerCase()}` : '', table([['Quarter'], ...columns.map(([label]) => [label, 1])], rows), 'history');
}

/** TradingView's delayed price chart, a year by default, in the site's colors. */
function priceChart(s) {
  const ticker = s.security.ticker;
  const config = {
    symbols: [[ticker, `${s.tv}|12M`]], chartOnly: false, width: '100%', height: '100%', locale: 'en', colorTheme: 'dark', autosize: true, isTransparent: true,
    showVolume: false, showMA: false, hideDateRanges: false, hideMarketStatus: true, hideSymbolLogo: true, scalePosition: 'right', scaleMode: 'Normal',
    fontFamily: '-apple-system, BlinkMacSystemFont, Trebuchet MS, Roboto, Ubuntu, sans-serif', fontSize: '10', headerFontSize: 'medium',
    noTimeScale: false, valuesTracking: '1', changeMode: 'price-and-percent', chartType: 'area',
    backgroundColor: rgba('ink', 0), gridLineColor: rgba('textPrimary', 0.04), widgetFontColor: rgba('textBody'), fontColor: rgba('textTertiary'),
    lineColor: rgba('data1'), lineWidth: 2, lineType: 0, topColor: rgba('data1', 0.14), bottomColor: rgba('data1', 0),
    dateRanges: ['1m|30', '3m|60', 'ytd|1D', '12m|1D', '60m|1W', 'all|1M'],
    utm_source: 'heavynumbers.com', utm_medium: 'widget_new', utm_campaign: 'symbol-overview',
  };
  const link = `https://www.tradingview.com/symbols/${s.tv.replace(':', '-')}/`;
  return `<section id="price"><div class="hf-tabletop"><h2>Price</h2><span>${esc(s.tv)} · delayed</span></div>
    <iframe class="hn-chart" src="https://www.tradingview-widget.com/embed-widget/symbol-overview/?locale=en#${encodeURIComponent(JSON.stringify(config))}" title="${esc(ticker)} price chart, provided by TradingView" loading="lazy"></iframe>
    <p class="hn-credit"><a href="${link}" rel="noopener nofollow">${esc(ticker)} chart</a> by TradingView</p></section>`;
}

/** eyebrow and small are HTML; title is text. */
function head(eyebrow, title, period, small, cls = '') {
  return `<div class="hf-pagehead ${cls}"><div><div class="hf-eyebrow">${eyebrow}</div><h1>${esc(title)}</h1></div>${period ? `<div class="hf-period">${esc(period)}<small>${small}</small></div>` : `<div class="hf-period"><small>${small}</small></div>`}</div>`;
}
function stats(items) {
  return `<div class="hf-stats">${items.map(([label, value]) => `<div><span>${esc(label)}</span><strong>${value}</strong></div>`).join('')}</div>`;
}
function section(title, note, body, id = '') {
  return `<section${id ? ` id="${id}"` : ''}><div class="hf-tabletop"><h2>${esc(title)}</h2><span>${esc(note)}</span></div>${body}</section>`;
}
/** columns: [label, numeric?, optional?] */
function table(columns, rows) {
  if (!rows.length) return '<div class="hf-empty">Nothing this quarter.</div>';
  return `<div class="hf-tablewrap"><table class="hf-table"><thead><tr>${columns.map(([label, numeric, optional]) => `<th${numeric || optional ? ` class="${[numeric && 'hf-numeric', optional && 'hf-optional'].filter(Boolean).join(' ')}"` : ''}>${esc(label)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

const NAV = [['/', 'Discover'], ['/funds/', 'Funds'], ['/stocks/', 'Stocks'], ['/sectors/', 'Sectors'], ['/methodology/', 'How this works']];
function layout({ title, description, path: pagePath, current, body }) {
  const nav = NAV.map(([href, label]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  const full = `${title} · Heavy Numbers`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title><meta name="description" content="${esc(description)}"><link rel="canonical" href="${SITE}${pagePath}">
<meta property="og:title" content="${esc(full)}"><meta property="og:description" content="${esc(description)}"><meta property="og:image" content="${SITE}/icon-512.png"><meta name="twitter:card" content="summary">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="stylesheet" href="/assets/site.css"><meta name="hn-base" content="/"><script src="/assets/search.js" defer></script><script src="/assets/price.js" defer></script></head>
<body><div class="hf-app"><header class="hf-header"><a href="/" class="hf-brand" aria-label="Heavy Numbers home"><img class="hf-brand-lockup" src="/brand/heavy-numbers-lockup-light.svg" alt="Heavy Numbers" width="547" height="100"></a>
<div class="hs-search"><input type="search" placeholder="Search funds and stocks" aria-label="Search funds and stocks" autocomplete="off"><div class="hs-results" role="listbox" hidden></div></div>
<nav class="hf-desktop-nav" aria-label="Main navigation">${nav}</nav>
<details class="hf-mobile-menu"><summary aria-label="Navigation menu"><span>Menu</span><svg viewBox="0 0 24 16" fill="none" aria-hidden="true"><path d="M0 4h24M0 12h24" stroke="currentColor" stroke-width="1.5"/></svg></summary><nav aria-label="Mobile navigation">${nav}</nav></details></header>
<main class="hf-main">${body}</main>
<footer class="hf-footer"><span>Heavy Numbers · Data from SEC 13F filings. Not investment advice.</span><a href="/methodology/">How this works</a><a href="${REPO}">Source on GitHub ↗</a></footer></div></body></html>`;
}
