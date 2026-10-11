# Heavy Numbers

[heavynumbers.com](https://heavynumbers.com) shows what investment funds hold, from the Form 13F filings they make with the SEC each quarter: which stocks concentrated funds opened, bet big on and sold out, every filer's holdings, and every stock's holders. It is free, has no accounts or tracking, and runs on GitHub alone: GitHub Actions rebuilds it every day and GitHub Pages serves it.

## What's on the site

- **Discover** (`/`): the stocks the most concentrated funds opened, their new 3%+ bets, what they sold out entirely, stocks new to 13F filings, and where their stock money sits by sector.
- **Funds** (`/funds/<name>/`): each filer's latest holdings with what changed since the quarter before, and its last four quarters.
- **Stocks** (`/stocks/<ticker>/`): who holds each stock and what they did, its last four quarters of 13F holders, and a delayed TradingView price chart. Hovering a stock row anywhere shows its delayed price.
- **Sectors**, **How this works**, and search over every fund and stock.

## Build it

```sh
SEC_USER_AGENT="Your Name you@example.com" npm run build   # writes out/
npx serve out
```

SEC asks every automated client to identify itself with a name and contact email. The build needs Node 22 or newer, `unzip`, about 3 GB of disk and 8 GB of memory, and no npm packages. Options: `--out <dir>`, `--cache <dir>` (downloads, default `.cache`), `--sets <n>` (data sets to read, default 6), `--no-live` (skip filings made since the newest data set).

## How it works

1. `build/sec.mjs` downloads SEC's six newest [quarterly 13F data sets](https://www.sec.gov/data-research/sec-markets-data/form-13f-data-sets), about 100 MB zipped each.
2. `build/live.mjs` reads every 13F filed on EDGAR since the newest data set closed, so new filings appear the day after they're made. Parsed filings are cached between runs.
3. `build/model.mjs` builds each filer's report for a quarter (latest original or restatement, plus later new-holdings amendments), fixes filings made in thousands of dollars, pairs positions across quarters and detects stock splits.
4. `build/build.mjs` picks the newest quarter with at least 1,000 filers. While that quarter is still being filed, a filer that hasn't filed it yet shows its report for the quarter before, and Discover reads only the funds that have. It labels securities from `data/security-reference.json` plus [OpenFIGI](https://www.openfigi.com/) for new CUSIPs, merges filers that moved to a new CIK (`data/manager-continuity.json`), gets sectors from SEC industry codes (`build/sectors.mjs`), and keeps four quarters of history.
5. `build/render.mjs` writes about 16,000 pages (about 550 MB, inside GitHub Pages' 1 GB limit) using `site/`.

## Run your own copy

1. Fork the repository. Under Settings → Pages, set Source to **GitHub Actions**.
2. Under Settings → Secrets and variables → Actions, add `SEC_USER_AGENT`. `OPENFIGI_API_KEY` is optional and speeds up ticker lookups.
3. Run the **Site** workflow once by hand; after that it runs daily.
4. For a custom domain, add it under Settings → Pages and point DNS at GitHub Pages. The build reads the address from `actions/configure-pages`, so links work on `<user>.github.io/<repo>` and on a domain.

## What it is not

These numbers describe what funds reported, about 45 days after each quarter ends. They are not a signal to copy: when lists like Discover's were tested against the S&P 500 over 2024 to 2025, none beat a random stock the same funds held, and a fund's good year did not predict its next one. Not investment advice.

The code is MIT licensed (see LICENSE). The data is public SEC filings. Prices are TradingView widgets loaded in the reader's browser.
