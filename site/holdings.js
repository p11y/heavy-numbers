// Long tables show their first rows and a "Show all" button. On fund pages, Holdings also switches between
// its sector groups and one largest-first table built from the same rows.
(() => {
  document.addEventListener('click', event => {
    const more = event.target.closest('.hn-more');
    if (!more) return;
    more.parentElement.classList.add('hn-open');
    more.remove();
  });
  const section = document.querySelector('.hn-views');
  if (!section) return;
  const switcher = section.querySelector('.hn-switch'), bySector = section.querySelector('.hn-bysector'), flat = section.querySelector('.hn-flat');
  const SHOW = 25;
  const buildFlat = () => {
    const table = section.querySelector('.hn-group table').cloneNode(false);
    table.append(section.querySelector('.hn-group thead').cloneNode(true), document.createElement('tbody'));
    const rows = [...bySector.querySelectorAll('tr[data-n]')].filter(row => row.dataset.n < Number(section.dataset.rows)).sort((a, b) => a.dataset.n - b.dataset.n).map(row => row.cloneNode(true));
    rows.forEach((row, n) => row.classList.toggle('hn-x', n >= SHOW && rows.length > SHOW + 3));
    table.tBodies[0].append(...rows);
    const wrap = document.createElement('div');
    wrap.className = 'hf-tablewrap';
    wrap.append(table);
    const clip = document.createElement('div');
    clip.className = 'hn-clip';
    clip.append(wrap);
    if (rows.length > SHOW + 3) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'hn-more';
      more.textContent = `Show ${(rows.length - SHOW).toLocaleString('en-US')} more`;
      clip.append(more);
    }
    flat.append(clip);
  };
  const show = view => {
    if (view === 'size' && !flat.firstChild) buildFlat();
    bySector.hidden = view !== 'sector';
    flat.hidden = view !== 'size';
    for (const button of switcher.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.view === view));
  };
  switcher.addEventListener('click', event => { const button = event.target.closest('button'); if (button) show(button.dataset.view); });
  switcher.hidden = false;
})();
