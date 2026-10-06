import {
  ORIGINS, DESTINATIONS, FALLBACK_RATES, MODES,
  compare, defaultAssumptions,
} from './pricing.js';

const RATES_URL = 'https://open.er-api.com/v6/latest/USD';
const COLORS = {
  fee: '#2a48af',
  spread: '#e5484d',
  swift: '#f5a524',
  iva: '#b39ddb',
  correspondent: '#ff8a65',
  receiving: '#7a8cc9',
};

// Perfiles rápidos de banco. "typical" usa los valores por tramo de pricing.js.
const PRESETS = {
  low: { bankSpreadPct: 1.5, swiftUsd: 20, fxFeeUsd: 5, correspondentUsd: 15, receivingUsd: 10 },
  typical: {},
  high: { bankSpreadPct: 5, swiftUsd: 55, fxFeeUsd: 20, correspondentUsd: 35, receivingUsd: 25 },
};

// Textos que cambian según el modo.
const COPY = {
  transfer: {
    hint: 'Paga a un proveedor en el exterior.',
    send: 'Envías',
    receive: 'Tu proveedor recibe',
    more: 'tu proveedor recibe',
    unit: ['envío', 'envíos'],
    lead: 'Abre cada cobro para ver qué es y ajústalo con lo que cobra tu banco. Todo se recalcula al instante.',
    proj: '¿Cuántas veces al mes pagas al exterior? Mismo monto y moneda en cada envío.',
  },
  fx: {
    hint: 'Compra o vende dólares, euros o libras.',
    send: 'Conviertes',
    receive: 'Recibes en tu cuenta',
    more: 'recibes',
    unit: ['conversión', 'conversiones'],
    lead: 'Al comprar divisas el banco gana sobre todo en el tipo de cambio. Abre cada cobro y ajústalo con lo que cobra tu banco.',
    proj: '¿Cuántas veces al mes compras o vendes divisas? Mismo monto en cada operación.',
  },
  payout: {
    hint: 'Paga nómina o proveedores a muchas personas a la vez.',
    send: 'Monto total del lote',
    receive: 'Tus beneficiarios reciben',
    more: 'tus beneficiarios reciben',
    unit: ['lote', 'lotes'],
    lead: 'Con un banco cada beneficiario es un giro SWIFT, así que las comisiones fijas se multiplican. Ajusta los valores con lo que cobra tu banco.',
    proj: '¿Cuántos lotes de pagos haces al mes? Nóminas, proveedores o comisiones en el exterior.',
  },
};

// Qué es cada cobro y con qué control se ajusta.
const ROWS = {
  spread: {
    key: 'bankSpreadPct', unit: '%', min: 0, max: 8, step: 0.1,
    info: () => 'El banco te vende la divisa más cara que la tasa real del mercado. Esa diferencia no aparece como comisión: va escondida dentro del tipo de cambio y suele ser el cobro más grande.',
    g66: 'Tasa real',
  },
  swift: {
    key: (mode) => (mode === 'fx' ? 'fxFeeUsd' : 'swiftUsd'), unit: 'USD', min: 0, max: (mode) => (mode === 'fx' ? 50 : 100), step: 1,
    info: (mode) => (mode === 'fx'
      ? 'Lo que cobra el banco por cada operación de compra o venta de divisas, además del spread.'
      : 'Lo que cobra tu banco por emitir cada giro al exterior por la red SWIFT. En dispersión se cobra una vez por cada beneficiario.'),
    g66: 'Sin costo',
  },
  iva: {
    key: 'ivaPct', unit: '%', min: 0, max: 25, step: 1,
    info: () => 'Impuesto que se suma a la comisión del banco. Lo pagas tú, encima de la comisión.',
    g66: 'Sin costo',
  },
  correspondent: {
    key: 'correspondentUsd', unit: 'USD', min: 0, max: 80, step: 1,
    info: () => 'Bancos intermediarios por los que pasa el giro antes de llegar. Descuentan su comisión del dinero en el camino, sin avisarte.',
    g66: 'Sin costo',
  },
  receiving: {
    key: 'receivingUsd', unit: 'USD', min: 0, max: 60, step: 1,
    info: () => 'El banco de tu proveedor también cobra por recibir el giro, así que llega menos de lo que enviaste.',
    g66: 'Sin costo',
  },
  fee: {
    key: 'g66Pct', unit: '%', min: 0, max: 5, step: 0.1,
    info: (mode) => (mode === 'fx'
      ? 'Global66 te muestra un único costo de tipo de cambio antes de convertir. Sin comisiones adicionales.'
      : 'Global66 te muestra un único costo antes de enviar. Convierte a tasa real y paga localmente en el país de destino, sin SWIFT ni intermediarios.'),
  },
};
const pick = (v, mode) => (typeof v === 'function' ? v(mode) : v);

const $ = (sel, root = document) => root.querySelector(sel);
const out = (key) => document.querySelectorAll(`[data-out="${key}"]`);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const params = new URLSearchParams(location.search);
const state = {
  mode: MODES[params.get('mode')] ? params.get('mode') : 'transfer',
  amount: Number(params.get('amount')) || 20000000,
  from: ORIGINS[params.get('from')] ? params.get('from') : 'COP',
  to: DESTINATIONS[params.get('to')] ? params.get('to') : 'USD',
  perMonth: Math.min(60, Math.max(1, Number(params.get('n')) || 4)),
  payments: Math.min(1000, Math.max(2, Number(params.get('p')) || 25)),
  rates: { ...FALLBACK_RATES },
  live: false,
  updated: null,
  preset: 'typical',
  overrides: {}, // valores fijados a mano o por perfil
  off: new Set(), // cobros que el usuario apagó
  open: new Set(['spread']), // filas abiertas en la tabla
};

// ---------- formato (estilo Global66: "26.000 COP") ----------
const nf = (d) => new Intl.NumberFormat('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });
const decimalsOf = (ccy) => (ORIGINS[ccy] || DESTINATIONS[ccy]).decimals;
const money = (v, ccy) => `${nf(decimalsOf(ccy)).format(v)} ${ccy}`;
const num = (v, ccy) => nf(decimalsOf(ccy)).format(v);
const pct = (v) => `${nf(v < 10 ? 2 : 1).format(v)}%`;
const rateLine = (rate, from, to) =>
  rate >= 1 ? `1 ${from} = ${nf(4).format(rate)} ${to}` : `1 ${to} = ${nf(2).format(1 / rate)} ${from}`;
const plural = (n, [one, many]) => `${n} ${n === 1 ? one : many}`;
const unitText = (v, unit) => (unit === '%' ? `${nf(unit === '%' && v % 1 ? 1 : 0).format(v)}%` : `${v} USD`);

// ---------- animación de cifras ----------
const tweens = new WeakMap();
function animateNumber(el, to, format) {
  const prev = tweens.get(el);
  const from = prev?.value ?? to;
  cancelAnimationFrame(prev?.raf);
  clearTimeout(prev?.done);
  if (reduceMotion || from === to) {
    el.textContent = format(to);
    tweens.set(el, { value: to });
    return;
  }
  const start = performance.now();
  const dur = 420;
  const entry = { value: from };
  const tick = () => {
    // El timestamp de rAF puede ser anterior a start: se acota a [0, 1].
    const t = Math.min(1, Math.max(0, (performance.now() - start) / dur));
    entry.value = from + (to - from) * (1 - Math.pow(1 - t, 3));
    el.textContent = format(entry.value);
    entry.raf = t < 1 ? requestAnimationFrame(tick) : null;
  };
  // Si el navegador pausa rAF (pestaña en segundo plano), igual queda el valor final.
  entry.done = setTimeout(() => {
    cancelAnimationFrame(entry.raf);
    entry.value = to;
    el.textContent = format(to);
  }, dur + 80);
  entry.raf = requestAnimationFrame(tick);
  tweens.set(el, entry);
}
const setNum = (key, value, format) => out(key).forEach((el) => animateNumber(el, value, format));
const setText = (key, text) => out(key).forEach((el) => { el.textContent = text; });

// ---------- supuestos efectivos ----------
function assumptions() {
  const base = { ...defaultAssumptions(state.amount, state.from, state.rates, state.mode, state.payments), ...state.overrides };
  const eff = { ...base };
  state.off.forEach((rowKey) => { eff[pick(ROWS[rowKey].key, state.mode)] = 0; });
  return { base, eff };
}

// ---------- tabla editable ----------
const rowsRoot = $('[data-rows]');
const chevron = '<svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>';

function rowKeysFor(mode) {
  const bank = mode === 'fx' ? ['spread', 'swift', 'iva'] : ['spread', 'swift', 'iva', 'correspondent', 'receiving'];
  return [...bank, 'fee'];
}

function buildRow(rowKey) {
  const def = ROWS[rowKey];
  const isG66 = rowKey === 'fee';
  const row = document.createElement('div');
  row.className = 'row';
  row.dataset.key = rowKey;
  row.setAttribute('role', 'row');
  row.innerHTML = `
    <button type="button" class="row__main" aria-expanded="false">
      <span class="row__name"><i style="background:${COLORS[rowKey]}"></i><span class="row__label"></span></span>
      <span class="row__val row__val--bank" data-label="Tu banco"></span>
      <span class="row__val row__val--g66" data-label="Global66"></span>
      <span class="row__chev">${chevron}</span>
    </button>
    <div class="row__panel">
      <p class="row__info"></p>
      <div class="ctrl">
        <div class="ctrl__top">
          <span class="ctrl__label">${isG66 ? 'Costo de Global66' : 'Lo que cobra tu banco'}</span>
          ${isG66 ? '' : '<label class="switch"><input type="checkbox" checked /><i></i><span>Lo cobra</span></label>'}
        </div>
        <div class="ctrl__top">
          <input type="range" class="ctrl__range" aria-label="Ajustar valor" />
          <span class="ctrl__num"><input inputmode="decimal" aria-label="Valor exacto" /><span></span></span>
        </div>
        <div class="ctrl__scale"><span></span><span></span></div>
      </div>
    </div>`;

  const main = row.querySelector('.row__main');
  main.addEventListener('click', () => {
    const open = !row.classList.contains('is-open');
    row.classList.toggle('is-open', open);
    main.setAttribute('aria-expanded', String(open));
    open ? state.open.add(rowKey) : state.open.delete(rowKey);
  });
  row.addEventListener('mouseenter', () => highlight(rowKey));
  row.addEventListener('mouseleave', () => highlight(null));

  const range = row.querySelector('.ctrl__range');
  const field = row.querySelector('.ctrl__num input');
  const setValue = (v) => {
    const aKey = pick(def.key, state.mode);
    state.overrides[aKey] = Math.max(0, v);
    if (!isG66) setPreset(null);
    render();
  };
  range.addEventListener('input', () => setValue(Number(range.value)));
  field.addEventListener('input', () => {
    const v = Number(field.value.replace(',', '.'));
    if (field.value !== '' && !Number.isNaN(v)) setValue(v);
  });
  field.addEventListener('blur', () => render());
  row.querySelector('.switch input')?.addEventListener('change', (e) => {
    e.target.checked ? state.off.delete(rowKey) : state.off.add(rowKey);
    render();
  });
  return row;
}

function buildTable() {
  rowsRoot.replaceChildren(...rowKeysFor(state.mode).map(buildRow));
  rowsRoot.querySelectorAll('.row').forEach((row) => {
    const open = state.open.has(row.dataset.key);
    row.classList.toggle('is-open', open);
    row.querySelector('.row__main').setAttribute('aria-expanded', String(open));
  });
}

function renderTable(r, base) {
  const { mode, from } = state;
  const lines = Object.fromEntries([...r.bank.lines, ...r.g66.lines].map((l) => [l.key, l]));
  rowsRoot.querySelectorAll('.row').forEach((row) => {
    const rowKey = row.dataset.key;
    const def = ROWS[rowKey];
    const line = lines[rowKey];
    const isG66 = rowKey === 'fee';
    const off = state.off.has(rowKey);
    row.classList.toggle('is-off', off);

    const label = row.querySelector('.row__label');
    label.textContent = isG66 ? `${line.label} Global66` : line.label;
    if (line.hidden && !off) {
      const t = document.createElement('span');
      t.className = 'tag';
      t.textContent = 'Oculto';
      label.append(t);
    }

    const bankVal = row.querySelector('.row__val--bank');
    const g66Val = row.querySelector('.row__val--g66');
    if (isG66) {
      bankVal.textContent = 'No aplica';
      bankVal.className = 'row__val row__val--bank is-none';
      g66Val.textContent = money(line.value, from);
      g66Val.className = 'row__val row__val--g66';
    } else {
      bankVal.textContent = off ? 'No lo cobra' : money(line.value, from);
      bankVal.className = 'row__val row__val--bank';
      g66Val.textContent = def.g66;
      g66Val.className = 'row__val row__val--g66 is-free';
    }

    row.querySelector('.row__info').textContent = def.info(mode);
    const aKey = pick(def.key, mode);
    const v = base[aKey];
    const max = Math.max(pick(def.max, mode), v);
    const range = row.querySelector('.ctrl__range');
    range.min = def.min; range.max = max; range.step = def.step;
    if (document.activeElement !== range) range.value = v;
    range.style.setProperty('--p', `${(v / max) * 100}%`);
    const field = row.querySelector('.ctrl__num input');
    if (document.activeElement !== field) field.value = nf(def.step < 1 ? 1 : 0).format(v);
    row.querySelector('.ctrl__num span').textContent = def.unit;
    const [lo, hi] = row.querySelectorAll('.ctrl__scale span');
    lo.textContent = unitText(def.min, def.unit);
    hi.textContent = unitText(max, def.unit);
    row.querySelector('.ctrl').classList.toggle('is-off', off);
  });

  const foot = [
    ['foot-row--total', 'Costo total', `${money(r.bank.cost, from)} · ${pct(r.bank.costPct)}`, `${money(r.g66.cost, from)} · ${pct(r.g66.costPct)}`],
    ['', 'Tipo de cambio', rateLine(r.bank.rate, from, state.to), rateLine(r.g66.rate, from, state.to)],
    ['', 'Llega en', MODES[mode].delivery.bank, MODES[mode].delivery.g66],
    ['foot-row--receive', COPY[mode].receive, money(r.bank.receive, state.to), money(r.g66.receive, state.to)],
  ];
  $('[data-foot]').replaceChildren(...foot.map(([cls, name, bank, g66]) => {
    const div = document.createElement('div');
    div.className = `foot-row ${cls}`;
    div.setAttribute('role', 'row');
    div.innerHTML = '<span></span><span class="is-bank" data-label="Tu banco"></span><span class="is-g66" data-label="Global66"></span><span></span>';
    const [a, b, c] = div.children;
    a.textContent = name; b.textContent = bank; c.textContent = g66;
    return div;
  }));
}

// ---------- barras y resaltado ----------
function renderStacks(r) {
  const max = Math.max(r.g66.cost, r.bank.cost, 1);
  const fill = (bar, lines) => {
    bar.replaceChildren(...lines.map((l) => {
      const s = document.createElement('span');
      s.dataset.key = l.key;
      s.style.background = COLORS[l.key];
      s.style.width = `${(Math.max(0, l.value) / max) * 100}%`;
      s.title = `${l.label}: ${money(l.value, state.from)}`;
      s.addEventListener('mouseenter', () => highlight(l.key));
      s.addEventListener('mouseleave', () => highlight(null));
      s.addEventListener('click', () => openRow(l.key));
      return s;
    }));
  };
  fill($('[data-bar="bank"]'), r.bank.lines);
  fill($('[data-bar="g66"]'), r.g66.lines);
}

function highlight(key) {
  document.querySelectorAll('.stack').forEach((st) => {
    st.classList.toggle('is-dim', Boolean(key));
    st.querySelectorAll('span').forEach((s) => s.classList.toggle('is-hot', s.dataset.key === key));
  });
  rowsRoot.querySelectorAll('.row').forEach((row) => row.classList.toggle('is-hot', row.dataset.key === key));
}

function openRow(key) {
  const row = rowsRoot.querySelector(`.row[data-key="${key}"]`);
  if (!row) return;
  if (!row.classList.contains('is-open')) row.querySelector('.row__main').click();
  row.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
}

// ---------- cotizador ----------
function renderQuoter(r) {
  const { mode, from, to, perMonth } = state;
  const copy = COPY[mode];
  setText('modeHint', copy.hint);
  setText('sendLabel', copy.send);
  setText('receiveLabel', copy.receive);
  $('[data-payments]').hidden = mode !== 'payout';

  setNum('g66Receive', r.g66.receive, (v) => money(v, to));
  setNum('bankReceive', r.bank.receive, (v) => money(v, to));
  $('[data-fill="bank"]').style.width = `${r.g66.receive ? (r.bank.receive / r.g66.receive) * 100 : 0}%`;
  out('perPayment').forEach((el) => {
    el.hidden = mode !== 'payout';
    el.textContent = `Cada beneficiario: ${money(r.g66.receive / r.payments, to)} con Global66 vs ${money(r.bank.receive / r.payments, to)} con tu banco`;
  });

  setNum('savings', r.savings, (v) => money(v, from));
  setText('savingsNote', `por ${copy.unit[0]} · ${copy.more} ${money(r.savingsDest, to)} más`);
  setText('bankCostPct', pct(r.bank.costPct));

  const list = $('[data-bankfees]');
  list.replaceChildren(
    ...r.bank.lines.map((l) => {
      const li = document.createElement('li');
      if (state.off.has(l.key)) li.className = 'is-off';
      li.innerHTML = `<span><i style="background:${COLORS[l.key]}"></i></span><span></span>`;
      li.firstChild.append(l.label);
      li.lastChild.textContent = money(l.value, from);
      return li;
    }),
    Object.assign(document.createElement('li'), { className: 'is-total', innerHTML: '<span>Total banco</span><span></span>' }),
  );
  list.lastChild.lastChild.textContent = money(r.bank.cost, from);
  const edit = document.createElement('li');
  edit.style.borderTop = '0';
  edit.innerHTML = '<a class="fees__edit" href="#detalle">Ajustar estos valores</a>';
  list.append(edit);

  // Proyección
  setNum('savingsYear', r.savingsYear, (v) => money(v, from));
  setText('savingsYearUsd', `≈ ${nf(0).format(r.savingsYear / state.rates[from])} USD al año`);
  setText('perMonth', plural(perMonth, copy.unit));
  setText('projLead', copy.proj);
  perMonthInput.style.setProperty('--p', `${((perMonth - 1) / 59) * 100}%`);
}

function render() {
  const { base, eff } = assumptions();
  const { mode, amount, from, to, rates, perMonth, payments } = state;
  const r = compare({ mode, amount, from, to, rates, assumptions: eff, perMonth, payments });

  renderQuoter(r);
  setText('detailLead', COPY[mode].lead);
  setNum('bankCost', r.bank.cost, (v) => money(v, from));
  setNum('g66Cost', r.g66.cost, (v) => money(v, from));
  setText('bankPctText', `${pct(r.bank.costPct)} de lo que ${mode === 'fx' ? 'conviertes' : 'envías'}`);
  setText('g66PctText', `${pct(r.g66.costPct)} de lo que ${mode === 'fx' ? 'conviertes' : 'envías'}`);
  out('bankWarn').forEach((el) => { el.hidden = !r.bank.insufficient; });
  renderStacks(r);
  renderTable(r, base);
  syncUrl();
}

function syncUrl() {
  const q = new URLSearchParams({ mode: state.mode, amount: state.amount, from: state.from, to: state.to, n: state.perMonth });
  if (state.mode === 'payout') q.set('p', state.payments);
  history.replaceState(null, '', `${location.pathname}?${q}`);
}

// ---------- perfiles de banco ----------
function setPreset(name) {
  state.preset = name;
  document.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === name)));
}
document.querySelectorAll('[data-preset]').forEach((b) => {
  b.addEventListener('click', () => {
    const g66Pct = state.overrides.g66Pct;
    state.overrides = { ...PRESETS[b.dataset.preset] };
    if (g66Pct !== undefined) state.overrides.g66Pct = g66Pct;
    state.off.clear();
    setPreset(b.dataset.preset);
    render();
  });
});
$('[data-reset]').addEventListener('click', () => {
  state.overrides = {};
  state.off.clear();
  setPreset('typical');
  render();
});

// ---------- modo ----------
const tabs = [...document.querySelectorAll('.seg [data-mode]')];
function setMode(mode) {
  state.mode = mode;
  tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.mode === mode)));
  buildTable();
  render();
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => setMode(t.dataset.mode));
  t.addEventListener('keydown', (e) => {
    const dir = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!dir) return;
    const next = tabs[(i + dir + tabs.length) % tabs.length];
    next.focus();
    setMode(next.dataset.mode);
  });
});

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
    li.innerHTML = `<img src="assets/flags/${c.flag}.svg" alt="" /><b>${code}</b><span>${c.name}</span>`;
    const choose = () => {
      if (which === 'from' && code !== state.from) {
        // Mantiene el tamaño de la operación al cambiar de moneda de origen.
        const usd = state.amount / state.rates[state.from];
        const step = state.rates[code] > 100 ? 1000 : 10;
        state.amount = Math.max(step, Math.round((usd * state.rates[code]) / step) * step);
        delete state.overrides.ivaPct;
        paintAmount();
      }
      state[which] = code;
      paint();
      close();
      render();
      btn.focus();
    };
    li.addEventListener('click', choose);
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); li.nextElementSibling?.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); li.previousElementSibling?.focus(); }
    });
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
  render();
});
amountInput.addEventListener('focus', () => amountInput.select());

// ---------- número de pagos (dispersión) ----------
const paymentsInput = $('#payments');
const setPayments = (n) => {
  state.payments = Math.min(1000, Math.max(2, Math.round(n) || 2));
  paymentsInput.value = state.payments;
  render();
};
paymentsInput.value = state.payments;
paymentsInput.addEventListener('change', () => setPayments(Number(paymentsInput.value.replace(/\D/g, ''))));
paymentsInput.addEventListener('input', () => {
  const n = Number(paymentsInput.value.replace(/\D/g, ''));
  if (n >= 2 && n <= 1000) { state.payments = n; render(); }
});
document.querySelectorAll('[data-step]').forEach((b) => {
  b.addEventListener('click', () => setPayments(state.payments + Number(b.dataset.step)));
});

// ---------- frecuencia ----------
const perMonthInput = $('#perMonth');
perMonthInput.value = state.perMonth;
perMonthInput.addEventListener('input', () => {
  state.perMonth = Number(perMonthInput.value);
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
    ? `Tasa real de mercado del ${when} · open.er-api.com`
    : 'Tasas de referencia del 5 de octubre de 2026 (sin conexión).');
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
setMode(state.mode);
loadRates();
