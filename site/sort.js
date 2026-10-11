// Sortable tables: click a column heading to sort by it, again to reverse. Numbers sort largest first, names
// A to Z. A cell's data-v, when set, is the value it sorts by. On a fund page's sector view, sorting switches
// to the one-table view so the whole fund sorts together.
(() => {
  const SUFFIX = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };
  const valueOf = cell => {
    if (!cell) return null;
    if (cell.dataset.v !== undefined) return Number(cell.dataset.v);
    const text = cell.textContent.trim().replace(/−/g, '-');
    const match = text.match(/^\+?(-?)\$?([\d,]*\.?\d+)\s*([KMBT])?/);
    if (!match) return text === '—' || text === '' ? null : text.toLowerCase();
    return Number(match[1] + match[2].replace(/,/g, '')) * (SUFFIX[match[3]] ?? 1);
  };
  const sortTable = (table, col, dir) => {
    const body = table.tBodies[0];
    const rows = [...body.rows];
    const keyed = rows.map(row => [row, valueOf(row.cells[col])]);
    const numeric = keyed.some(([, v]) => typeof v === 'number');
    keyed.sort(([, a], [, b]) => {
      if (a == null || b == null) return (a == null) - (b == null);
      return numeric ? dir * (a - b) : dir * String(a).localeCompare(String(b));
    });
    body.append(...keyed.map(([row]) => row));
    // Sorting shows every row, so the order is the whole table's.
    const clip = table.closest('.hn-clip');
    if (clip) { clip.classList.add('hn-open'); clip.querySelector('.hn-more')?.remove(); }
    for (const [n, th] of [...table.tHead.rows[0].cells].entries()) th.setAttribute('aria-sort', n === col ? (dir > 0 ? 'ascending' : 'descending') : 'none');
  };
  document.addEventListener('click', event => {
    const th = event.target.closest('.hf-table thead th');
    if (!th) return;
    let table = th.closest('table');
    const col = th.cellIndex;
    const views = table.closest('.hn-views');
    if (views && table.closest('.hn-bysector')) {
      views.querySelector('.hn-switch button[data-view="size"]')?.click();
      table = views.querySelector('.hn-flat table');
      if (!table) return;
    }
    const numeric = [...table.tBodies[0].rows].some(row => typeof valueOf(row.cells[col]) === 'number');
    const was = table.tHead.rows[0].cells[col].getAttribute('aria-sort');
    const dir = was === 'descending' ? 1 : was === 'ascending' ? -1 : numeric ? -1 : 1;
    sortTable(table, col, dir);
  });
  document.addEventListener('keydown', event => {
    if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('.hf-table thead th')) { event.preventDefault(); event.target.click(); }
  });
  for (const th of document.querySelectorAll('.hf-table thead th')) th.tabIndex = 0;
})();
