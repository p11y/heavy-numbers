// A stock's delayed price beside its row: hovering a row with data-tv (a TradingView symbol, NASDAQ:AAPL)
// shows TradingView's single-quote widget in a card under the stock's name. Pointer devices only; a tap
// opens the stock page, which has the chart. Each symbol's iframe loads on its first hover and is kept for
// the next one, up to a dozen.
(() => {
  if (!matchMedia('(hover: hover)').matches) return;
  const card = document.createElement('div');
  card.className = 'hn-price';
  card.hidden = true;
  card.setAttribute('role', 'tooltip');
  card.innerHTML = '<span>Delayed price by TradingView</span>';
  document.body.append(card);
  const frames = new Map();
  const url = symbol => `https://www.tradingview-widget.com/embed-widget/single-quote/?locale=en#${encodeURIComponent(JSON.stringify({
    symbol, width: '100%', isTransparent: true, colorTheme: 'dark', locale: 'en', utm_source: 'heavynumbers.com', utm_medium: 'widget_new', utm_campaign: 'single-quote',
  }))}`;
  let row = null;
  const hide = () => { row = null; card.hidden = true; };
  document.addEventListener('mouseover', event => {
    const next = event.target.closest('[data-tv]');
    if (next === row) return;
    if (!next) return hide();
    row = next;
    const symbol = row.dataset.tv;
    let frame = frames.get(symbol);
    if (!frame) {
      frame = document.createElement('iframe');
      frame.title = `${symbol} delayed price, provided by TradingView`;
      frame.src = url(symbol);
      frames.set(symbol, frame);
      card.prepend(frame);
      if (frames.size > 12) { const [oldest] = frames.keys(); frames.get(oldest).remove(); frames.delete(oldest); }
    }
    for (const f of frames.values()) f.hidden = f !== frame;
    const box = (row.querySelector('th') ?? row).getBoundingClientRect(), width = 260, height = 100;
    card.style.left = `${Math.round(Math.max(8, Math.min(box.left, innerWidth - width - 8)))}px`;
    card.style.top = `${Math.round(box.bottom + height > innerHeight ? box.top - height : box.bottom)}px`;
    card.hidden = false;
  });
  addEventListener('scroll', hide, { passive: true });
})();
