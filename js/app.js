import {
  ORIGINS, DESTINATIONS, FALLBACK_RATES, MODES,
  compare, defaultAssumptions,
} from './pricing.js';

const RATES_URL = 'https://open.er-api.com/v6/latest/USD';
const ASSUMPTION_KEYS = ['g66Pct', 'bankSpreadPct', 'swiftUsd', 'ivaPct', 'correspondentUsd', 'receivingUsd', 'fxFeeUsd'];
const COLORS = {
  fee: '#2a48af',
  spread: '#e5484d',
  swift: '#f5a524',
  iva: '#b39ddb',
  correspondent: '#ff8a65',
  receiving: '#c3cff5',
};

// Textos que cambian según el modo.
const COPY = {
  transfer: {
    send: 'Monto a enviar:',
    receive: 'Tu proveedor recibe:',
    savingsLead: 'Tu proveedor recibe',
    g66Sub: 'Pago local, sin SWIFT ni intermediarios',
    bankSub: 'Transferencia vía red SWIFT',
    unit: ['envío', 'envíos'],
    proj: '¿Cuántas veces al mes pagas al exterior? Mismo monto y corredor en cada envío.',
  },
  fx: {
    send: 'Monto a convertir:',
    receive: 'Recibes en tu cuenta:',
    savingsLead: 'Recibes',
    g66Sub: 'Conversión instantánea en Tu Cuenta Global',
    bankSub: 'Compra de divisas en el banco',
    unit: ['conversión', 'conversiones'],
    proj: '¿Cuántas veces al mes compras o vendes divisas? Mismo monto en cada operación.',
  },
  payout: {
    send: 'Monto total del lote:',
    receive: 'Tus beneficiarios reciben:',
    savingsLead: 'Tus beneficiarios reciben',
    g66Sub: 'Multienvío: todo el lote en un clic, una sola conversión',
    bankSub: 'Un giro SWIFT por cada beneficiario',
    unit: ['lote', 'lotes'],
    proj: '¿Cuántos lotes de pagos haces al mes? Nóminas, proveedores o comisiones en el exterior.',
  },
};

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
  assumptions: null,
  edited: new Set(), // supuestos que el usuario fijó a mano
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
    tweens.set(el, { value: v, raf: t < 1 ? requestAnimationFrame(tick) : null });
  };
  tweens.set(el, { value: from, raf: requestAnimationFrame(tick) });
}
const setNum = (key, value, format) => out(key).forEach((el) => animateNumber(el, value, format));
const setText = (key, text) => out(key).forEach((el) => { el.textContent = text; });

// ---------- supuestos ----------
const form = $('[data-assume]');
function refreshAssumptions() {
  const defaults = defaultAssumptions(state.amount, state.from, state.rates, state.mode, state.payments);
  const prev = state.assumptions || {};
  state.assumptions = Object.fromEntries(
    ASSUMPTION_KEYS.map((k) => [k, state.edited.has(k) ? prev[k] : defaults[k]]),
  );
  ASSUMPTION_KEYS.forEach((k) => {
    const input = form.elements[k];
    if (document.activeElement !== input) input.value = state.assumptions[k];
  });
  form.querySelectorAll('[data-modes]').forEach((el) => {
    el.hidden = !el.dataset.modes.split(' ').includes(state.mode);
  });
}

// ---------- render ----------
function lineItem({ label, value, ccy, tag, tagOk, zero }) {
  const li = document.createElement('li');
  if (zero) li.className = 'is-zero';
  li.innerHTML = '<span class="dot"></span><span class="lbl"></span><span class="val"></span>';
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
  const { from, mode } = state;
  const fee = r.g66.lines[0];
  const zeros = mode === 'fx'
    ? [lineItem({ label: 'Comisión por operación', value: 'Sin costo', zero: true })]
    : [
      lineItem({ label: mode === 'payout' ? 'Comisiones SWIFT por giro' : 'Comisión SWIFT', value: 'Sin costo', zero: true }),
      lineItem({ label: 'Bancos intermediarios', value: 'Sin costo', zero: true }),
    ];
  $('[data-lines="g66"]').replaceChildren(
    lineItem({ label: fee.label, value: fee.value, ccy: from, tag: 'Todo incluido', tagOk: true }),
    ...zeros,
    lineItem({ label: 'Monto a convertir', value: r.g66.convert, ccy: from }),
  );
  $('[data-lines="bank"]').replaceChildren(
    ...r.bank.lines.map((l) => lineItem({ label: l.label, value: l.value, ccy: from, tag: l.hidden ? 'Oculto' : null })),
    lineItem({ label: 'Monto a convertir', value: r.bank.convert, ccy: from }),
  );

  // Versión compacta dentro del cotizador.
  $('[data-bankfees]').replaceChildren(...r.bank.lines.map((l) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    // En la lista compacta el "(N giros)" solo se muestra en la comisión SWIFT.
    name.textContent = l.key === 'swift' ? l.label : l.label.replace(/ \(\d+ giros\)$/, '');
    if (l.hidden) {
      const em = document.createElement('em');
      em.textContent = 'oculto';
      name.append(em);
    }
    const val = document.createElement('span');
    val.textContent = money(l.value, from);
    li.append(name, val);
    return li;
  }));
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
  $('[data-legend]').replaceChildren(...[...r.g66.lines, ...r.bank.lines].map((l) => {
    const li = document.createElement('li');
    li.innerHTML = `<i style="background:${COLORS[l.key]}"></i>`;
    li.append(l.key === 'fee' ? `${l.label} Global66` : l.label.replace(/ \(\d+ giros\)$/, ''));
    return li;
  }));
}

function render() {
  const { mode, amount, from, to, rates, assumptions, perMonth, payments } = state;
  const r = compare({ mode, amount, from, to, rates, assumptions, perMonth, payments });
  const copy = COPY[mode];

  setText('sendLabel', copy.send);
  setText('receiveLabel', copy.receive);
  setText('savingsLead', copy.savingsLead);
  setText('g66Sub', copy.g66Sub);
  setText('bankSub', mode === 'payout' ? `${payments} giros SWIFT, uno por beneficiario` : copy.bankSub);
  setText('projLead', copy.proj);
  $('[data-payments]').hidden = mode !== 'payout';
  out('perPayment').forEach((el) => {
    el.hidden = mode !== 'payout';
    el.textContent = `Cada uno: ${money(r.g66.receive / r.payments, to)} con Global66 vs ${money(r.bank.receive / r.payments, to)} con tu banco`;
  });

  setNum('g66Receive', r.g66.receive, (v) => num(v, to));
  setNum('bankReceive', r.bank.receive, (v) => num(v, to));
  setNum('savingsDest', r.savingsDest, (v) => money(v, to));
  setNum('savings', r.savings, (v) => money(v, from));
  setNum('bankPct', r.bank.costPct, (v) => `(${pct(v)})`);
  setNum('g66Pct', r.g66.costPct, (v) => `(${pct(v)})`);
  setNum('g66Cost', r.g66.cost, (v) => money(v, from));
  setNum('bankCost', r.bank.cost, (v) => money(v, from));
  setNum('savingsYear', r.savingsYear, (v) => money(v, from));
  setText('savingsYearUsd', `≈ ${nf(0).format(r.savingsYear / rates[from])} USD al año, ${plural(perMonth, copy.unit)} al mes`);
  setText('perMonth', `${plural(perMonth, copy.unit)} al mes`);

  setText('g66CostShort', `${money(r.g66.cost, from)} · ${pct(r.g66.costPct)}`);
  setText('bankCostShort', `${money(r.bank.cost, from)} · ${pct(r.bank.costPct)}`);
  setText('midRate', rateLine(r.mid, from, to));
  setText('bankRate', rateLine(r.bank.rate, from, to));
  setText('g66RateLine', rateLine(r.g66.rate, from, to));
  setText('bankRateLine', rateLine(r.bank.rate, from, to));
  setText('g66Time', MODES[mode].delivery.g66);
  setText('bankTime', MODES[mode].delivery.bank);
  out('bankWarn').forEach((el) => { el.hidden = !r.bank.insufficient; });

  renderLines(r);
  renderBars(r);
  syncUrl();
}

function syncUrl() {
  const q = new URLSearchParams({ mode: state.mode, amount: state.amount, from: state.from, to: state.to, n: state.perMonth });
  if (state.mode === 'payout') q.set('p', state.payments);
  history.replaceState(null, '', `${location.pathname}?${q}`);
}

const update = () => { refreshAssumptions(); render(); };

// ---------- modo ----------
document.querySelectorAll('input[name="mode"]').forEach((radio) => {
  radio.checked = radio.value === state.mode;
  radio.addEventListener('change', () => {
    state.mode = radio.value;
    state.edited.delete('g66Pct');
    state.edited.delete('bankSpreadPct');
    update();
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
    const pick = () => {
      if (which === 'from' && code !== state.from) {
        // Mantiene el tamaño de la operación al cambiar de moneda de origen.
        const usd = state.amount / state.rates[state.from];
        const step = state.rates[code] > 100 ? 1000 : 10;
        state.amount = Math.max(step, Math.round((usd * state.rates[code]) / step) * step);
        state.edited.delete('ivaPct');
        paintAmount();
      }
      state[which] = code;
      paint();
      close();
      update();
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
  update();
});

// ---------- número de pagos (dispersión) ----------
const paymentsInput = $('#payments');
const setPayments = (n) => {
  state.payments = Math.min(1000, Math.max(2, Math.round(n) || 2));
  paymentsInput.value = state.payments;
  update();
};
paymentsInput.value = state.payments;
paymentsInput.addEventListener('change', () => setPayments(Number(paymentsInput.value.replace(/\D/g, ''))));
paymentsInput.addEventListener('input', () => {
  const n = Number(paymentsInput.value.replace(/\D/g, ''));
  if (n >= 2 && n <= 1000) { state.payments = n; update(); }
});
document.querySelectorAll('[data-step]').forEach((b) => {
  b.addEventListener('click', () => setPayments(state.payments + Number(b.dataset.step)));
});

// ---------- frecuencia ----------
const perMonth = $('#perMonth');
perMonth.value = state.perMonth;
perMonth.addEventListener('input', () => {
  state.perMonth = Number(perMonth.value);
  render();
});

// ---------- supuestos editables ----------
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
  update();
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
    ? `Tasa real de mercado del ${when} · Fuente: open.er-api.com`
    : 'Tasas de referencia del 5 de octubre de 2026 (sin conexión a la fuente en vivo).');
  update();
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
update();
loadRates();
