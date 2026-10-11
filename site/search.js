// Header search over /search.json: [name, path, kind ('f' fund | 's' stock), ticker, value in $M].
(() => {
  const box = document.querySelector('.hs-search');
  if (!box) return;
  const input = box.querySelector('input'), list = box.querySelector('.hs-results');
  let index = null, loading = null, selected = -1;
  const load = () => loading ??= fetch(`${document.querySelector('meta[name=hn-base]')?.content ?? '/'}search.json`).then(r => r.json()).then(rows => {
    index = rows.map(row => ({ row, name: row[0].toLowerCase(), ticker: row[3].toLowerCase() }));
  });
  const money = m => m >= 1e6 ? `$${(m / 1e6).toFixed(1)}T` : m >= 1e3 ? `$${(m / 1e3).toFixed(1)}B` : `$${m}M`;
  const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function render() {
    const q = input.value.trim().toLowerCase();
    selected = -1;
    if (!q || !index) { list.hidden = true; return; }
    const words = q.split(/\s+/);
    const hits = [];
    for (const item of index) {
      if (!words.every(w => item.name.includes(w) || item.ticker === w)) continue;
      const score = (item.ticker === q ? 4 : 0) + (item.name.startsWith(q) ? 2 : 0) + Math.log10(1 + item.row[4]) / 10;
      hits.push([score, item.row]);
    }
    hits.sort((a, b) => b[0] - a[0]);
    list.innerHTML = hits.length ? hits.slice(0, 12).map(([, r]) => `<a href="${r[1]}" role="option">${r[3] ? `<b class="hf-ticker">${esc(r[3])}</b>` : ''}${esc(r[0])}<span>${r[2] === 'f' ? 'Fund' : 'Stock'} · ${money(r[4])}</span></a>`).join('') : '<p>No fund or stock matches.</p>';
    list.hidden = false;
  }
  input.addEventListener('focus', () => load().then(render));
  input.addEventListener('input', () => (index ? render() : load().then(render)));
  input.addEventListener('keydown', event => {
    const links = [...list.querySelectorAll('a')];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      selected = Math.max(0, Math.min(links.length - 1, selected + (event.key === 'ArrowDown' ? 1 : -1)));
      links.forEach((a, i) => a.setAttribute('aria-selected', String(i === selected)));
    } else if (event.key === 'Enter') {
      const link = links[Math.max(0, selected)];
      if (link) location.href = link.href;
    } else if (event.key === 'Escape') list.hidden = true;
  });
  document.addEventListener('click', event => { if (!box.contains(event.target)) list.hidden = true; });
})();
