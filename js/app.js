import {
  ORIGINS, DESTINATIONS, FALLBACK_RATES, DELIVERY,
  compare, defaultAssumptions,
} from './pricing.js';

const RATES_URL = 'https://open.er-api.com/v6/latest/USD';
const ASSUMPTION_KEYS = ['g66Pct', 'bankSpreadPct', 'swiftUsd', 'ivaPct', 'correspondentUsd', 'receivingUsd'];
const COLORS = {
  fee: '#64dfc4',
  spread: '#ff7a6b',
  swift: '#ffc56b',
  iva: '#c9a2ff',
  correspondent: '#7aa2ff',
  receiving: '#9aa6c7',
};

const $ = (sel, root = document) => root.querySelector(sel);
const out = (key) => document.querySelectorAll(`[data-out="${key}"]`);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const params = new URLSearchParams(location.search);
const state = {
  amount: Number(params.get('amount')) || 20000000,
  from: ORIGINS[params.get('from')] ? params.get('from') : 'COP',
  to: DESTINATIONS[params.get('to')] ? params.get('to') : 'USD',
  perMonth: Math.min(60, Math.max(1, Number(params.get('n')) || 4)),
  rates: { ...FALLBACK_RATES },
  live: false,
  updated: null,
  assumptions: null,
  edited: new Set(), // supuestos que el usuario fijó a mano
};

// ---------- formato ----------
const nf = (d) => new Intl.NumberFormat('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });
const decimalsOf = (ccy) => (ORIGINS[ccy] || DESTINATIONS[ccy]).decimals;
const money = (v, ccy) => `$ ${nf(decimalsOf(ccy)).format(v)} ${ccy}`;
const moneyShort = (v, ccy) => `$ ${nf(decimalsOf(ccy)).format(v)}`;
const pct = (v) => `${nf(v < 10 ? 2 : 1).format(v)}%`;
const rateLine = (rate, from, to) =>
  rate >= 1 ? `1 ${from} = ${nf(4).format(rate)} ${to}` : `1 ${to} = ${nf(2).format(1 / rate)} ${from}`;

// ---------- animación de cifras ----------
const tweens = new WeakMap();
function animateNumber(el, to, format) {
  const from = tweens.get(el)?.value ?? to;
  cancelAnimationFrame(tweens.get(el)?.raf);
  if (reduceMotion || from === to) {
    el.textContent = format(to);
    tweens.set(el, { value: to });
    return;
  }
  const start = performance.now();
  const dur = 420;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / dur);
    const v = from + (to - from) * (1 - Math.pow(1 - t, 3));
    el.textContent = format(v);
    const entry = { value: v, raf: t < 1 ? requestAnimationFrame(tick) : null };
    tweens.set(el, entry);
  };
  tweens.set(el, { value: from, raf: requestAnimationFrame(tick) });
}
const setNum = (key, value, format) => out(key).forEach((el) => animateNumber(el, value, format));
const setText = (key, text) => out(key).forEach((el) => { el.textContent = text; });

// ---------- supuestos ----------
function refreshAssumptions() {
  const defaults = defaultAssumptions(state.amount, state.from, state.rates);
  const prev = state.assumptions || {};
  state.assumptions = Object.fromEntries(
    ASSUMPTION_KEYS.map((k) => [k, state.edited.has(k) ? prev[k] : defaults[k]]),
  );
  const form = $('[data-assume]');
  ASSUMPTION_KEYS.forEach((k) => {
    const input = form.elements[k];
    if (document.activeElement !== input) input.value = state.assumptions[k];
  });
}

// ---------- render ----------
function lineItem({ label, value, ccy, tag, tagOk, zero }) {
  const li = document.createElement('li');
  if (zero) li.className = 'is-zero';
  li.innerHTML = `<span class="dot"></span><span class="lbl"></span><span class="val"></span>`;
  li.querySelector('.lbl').textContent = label;
  if (tag) {
    const t = document.createElement('span');
    t.className = tagOk ? 'tag tag--ok' : 'tag';
    t.textContent = tag;
    li.querySelector('.lbl').append(t);
  }
  li.querySelector('.val').textContent = typeof value === 'number' ? money(value, ccy) : value;
  return li;
}

function renderLines(r) {
  const { from } = state;
  const g = $('[data-lines="g66"]');
  g.replaceChildren(
    lineItem({ label: 'Costo de envío', value: r.g66.lines[0].value, ccy: from, tag: 'Todo incluido', tagOk: true }),
    lineItem({ label: 'Comisión SWIFT', value: 'Sin costo', zero: true }),
    lineItem({ label: 'Bancos intermediarios', value: 'Sin costo', zero: true }),
    lineItem({ label: 'Monto a convertir', value: r.g66.convert, ccy: from }),
  );
  const b = $('[data-lines="bank"]');
  b.replaceChildren(
    ...r.bank.lines.map((l) => lineItem({ label: l.label, value: l.value, ccy: from, tag: l.hidden ? 'Oculto' : null })),
    lineItem({ label: 'Monto a convertir', value: r.bank.convert, ccy: from }),
  );
}

function renderBars(r) {
  const max = Math.max(r.g66.cost, r.bank.cost, 1);
  const fill = (bar, lines) => {
    bar.replaceChildren(...lines.map((l) => {
      const s = document.createElement('span');
      s.style.background = COLORS[l.key];
      s.style.width = `${(Math.max(0, l.value) / max) * 100}%`;
      s.title = `${l.label}: ${money(l.value, state.from)}`;
      return s;
    }));
  };
  fill($('[data-bar="g66"]'), r.g66.lines);
  fill($('[data-bar="bank"]'), r.bank.lines);
  const legend = $('[data-legend]');
  legend.replaceChildren(...[...r.g66.lines, ...r.bank.lines].map((l) => {
    const li = document.createElement('li');
    li.innerHTML = `<i style="background:${COLORS[l.key]}"></i>`;
    li.append(l.key === 'fee' ? 'Costo de envío Global66' : l.label);
    return li;
  }));
}

function render() {
  const { amount, from, to, rates, assumptions, perMonth } = state;
  const r = compare({ amount, from, to, rates, assumptions, perMonth });
  const usdFrom = rates[from];

  setNum('g66Receive', r.g66.receive, (v) => moneyShort(v, to));
  setNum('bankReceive', r.bank.receive, (v) => moneyShort(v, to));
  setNum('savingsDest', r.savingsDest, (v) => money(v, to));
  setNum('savings', r.savings, (v) => money(v, from));
  setNum('bankPct', r.bank.costPct, pct);
  setNum('g66Pct', r.g66.costPct, pct);
  setNum('g66Cost', r.g66.cost, (v) => money(v, from));
  setNum('bankCost', r.bank.cost, (v) => money(v, from));
  setNum('savingsYear', r.savingsYear, (v) => money(v, from));
  setText('savingsYearUsd', `≈ US$ ${nf(0).format(r.savingsYear / usdFrom)} al año, ${perMonth} ${perMonth === 1 ? 'envío' : 'envíos'} al mes`);
  setText('perMonth', `${perMonth} ${perMonth === 1 ? 'envío' : 'envíos'} al mes`);

  setText('g66CostShort', `${money(r.g66.cost, from)} · ${pct(r.g66.costPct)}`);
  setText('bankCostShort', `${money(r.bank.cost, from)} · ${pct(r.bank.costPct)}`);
  setText('midRate', rateLine(r.mid, from, to));
  setText('bankRate', rateLine(r.bank.rate, from, to));
  setText('g66RateLine', rateLine(r.g66.rate, from, to));
  setText('bankRateLine', rateLine(r.bank.rate, from, to));
  setText('g66Time', DELIVERY.g66);
  setText('bankTime', DELIVERY.bank);
  out('bankWarn').forEach((el) => { el.hidden = !r.bank.insufficient; });

  renderLines(r);
  renderBars(r);
  syncUrl();
}

function syncUrl() {
  const q = new URLSearchParams({ amount: state.amount, from: state.from, to: state.to, n: state.perMonth });
  history.replaceState(null, '', `${location.pathname}?${q}`);
}

// ---------- selector de moneda ----------
function setupCurrency(which, catalog) {
  const root = $(`[data-ccy="${which}"]`);
  const btn = root.querySelector('.ccy__btn');
  const list = root.querySelector('.ccy__list');

  const paint = () => {
    const code = state[which];
    btn.querySelector('img').src = `assets/flags/${catalog[code].flag}.svg`;
    btn.querySelector('span').textContent = code;
    list.querySelectorAll('li').forEach((li) => li.setAttribute('aria-selected', li.dataset.code === code));
  };
  const close = () => { root.classList.remove('is-open'); btn.setAttribute('aria-expanded', 'false'); };

  list.replaceChildren(...Object.entries(catalog).map(([code, c]) => {
    const li = document.createElement('li');
    li.role = 'option';
    li.tabIndex = 0;
    li.dataset.code = code;
    li.innerHTML = `<img src="assets/flags/${c.flag}.svg" alt="" /><b>${code}</b><span>${c.country}</span>`;
    const pick = () => {
      if (which === 'from' && code !== state.from) {
        // Mantiene el tamaño del envío al cambiar de moneda de origen.
        const usd = state.amount / state.rates[state.from];
        const step = state.rates[code] > 100 ? 1000 : 10;
        state.amount = Math.max(step, Math.round((usd * state.rates[code]) / step) * step);
        state.edited.delete('ivaPct');
        paintAmount();
      }
      state[which] = code;
      paint();
      close();
      refreshAssumptions();
      render();
      btn.focus();
    };
    li.addEventListener('click', pick);
    li.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
    return li;
  }));

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = !root.classList.contains('is-open');
    document.querySelectorAll('.ccy.is-open').forEach((el) => el.classList.remove('is-open'));
    root.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
    if (open) list.querySelector('[aria-selected="true"]')?.focus();
  });
  document.addEventListener('click', (e) => { if (!root.contains(e.target)) close(); });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { close(); btn.focus(); } });
  paint();
}

// ---------- monto ----------
const amountInput = $('#amount');
function paintAmount() {
  amountInput.value = nf(0).format(state.amount);
}
amountInput.addEventListener('input', () => {
  const digits = amountInput.value.replace(/\D/g, '').slice(0, 13);
  state.amount = Number(digits) || 0;
  const fromEnd = amountInput.value.length - amountInput.selectionEnd;
  amountInput.value = digits ? nf(0).format(state.amount) : '';
  const pos = Math.max(0, amountInput.value.length - fromEnd);
  amountInput.setSelectionRange(pos, pos);
  refreshAssumptions();
  render();
});

// ---------- frecuencia ----------
const perMonth = $('#perMonth');
perMonth.value = state.perMonth;
perMonth.addEventListener('input', () => {
  state.perMonth = Number(perMonth.value);
  render();
});

// ---------- supuestos editables ----------
const form = $('[data-assume]');
form.addEventListener('input', (e) => {
  const k = e.target.name;
  if (!ASSUMPTION_KEYS.includes(k)) return;
  const v = Number(e.target.value);
  if (e.target.value === '' || Number.isNaN(v) || v < 0) return;
  state.edited.add(k);
  state.assumptions[k] = v;
  render();
});
$('[data-reset]').addEventListener('click', () => {
  state.edited.clear();
  refreshAssumptions();
  render();
});

// ---------- tasas en vivo ----------
async function loadRates() {
  try {
    const res = await fetch(RATES_URL);
    const data = await res.json();
    if (data.result !== 'success') throw new Error('rates');
    const codes = Object.keys(FALLBACK_RATES);
    if (!codes.every((c) => data.rates[c])) throw new Error('missing');
    state.rates = Object.fromEntries(codes.map((c) => [c, data.rates[c]]));
    state.live = true;
    state.updated = new Date(data.time_last_update_unix * 1000);
  } catch {
    state.live = false;
  }
  const when = state.updated
    ? state.updated.toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;
  setText('rateSource', state.live
    ? `Tasa real de mercado actualizada el ${when} · Fuente: open.er-api.com`
    : 'Tasas de referencia del 5 de octubre de 2026 (sin conexión a la fuente en vivo).');
  refreshAssumptions();
  render();
}

// ---------- nav activa ----------
const links = [...document.querySelectorAll('.nav__links a')];
const observer = new IntersectionObserver((entries) => {
  entries.forEach((en) => {
    if (!en.isIntersecting) return;
    links.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${en.target.id}`));
  });
}, { rootMargin: '-45% 0px -50% 0px' });
['calculadora', 'detalle', 'proyeccion'].forEach((id) => observer.observe(document.getElementById(id)));

// ---------- init ----------
paintAmount();
setupCurrency('from', ORIGINS);
setupCurrency('to', DESTINATIONS);
refreshAssumptions();
render();
loadRates();
