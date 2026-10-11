// Fund pages: switches Holdings between its sector groups and one largest-first table built from the same rows.
(() => {
  const section = document.querySelector('.hn-views');
  if (!section) return;
  const switcher = section.querySelector('.hn-switch'), bySector = section.querySelector('.hn-bysector'), flat = section.querySelector('.hn-flat');
  const show = view => {
    if (view === 'size' && !flat.firstChild) {
      const table = section.querySelector('.hn-group table').cloneNode(false);
      table.append(section.querySelector('.hn-group thead').cloneNode(true), document.createElement('tbody'));
      const rows = [...bySector.querySelectorAll('tr[data-n]')].sort((a, b) => a.dataset.n - b.dataset.n);
      table.tBodies[0].append(...rows.map(row => row.cloneNode(true)));
      const wrap = document.createElement('div');
      wrap.className = 'hf-tablewrap';
      wrap.append(table);
      flat.append(wrap);
    }
    bySector.hidden = view !== 'sector';
    flat.hidden = view !== 'size';
    for (const button of switcher.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.view === view));
  };
  switcher.addEventListener('click', event => { const button = event.target.closest('button'); if (button) show(button.dataset.view); });
  switcher.hidden = false;
})();
