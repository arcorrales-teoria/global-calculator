import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compare, defaultAssumptions, FALLBACK_RATES, g66PctFor, bankSpreadFor } from '../js/pricing.js';

const rates = FALLBACK_RATES;
const run = (amount, from = 'COP', to = 'USD', perMonth = 1) =>
  compare({ amount, from, to, rates, perMonth, assumptions: defaultAssumptions(amount, from, rates) });

test('los tramos bajan el costo a medida que sube el monto', () => {
  assert.ok(g66PctFor(300) > g66PctFor(5000));
  assert.ok(g66PctFor(5000) > g66PctFor(100000));
  assert.ok(bankSpreadFor(1000) > bankSpreadFor(100000));
});

test('el costo total de cada lado es igual a la suma de sus líneas', () => {
  for (const [amount, from] of [[20_000_000, 'COP'], [5_000_000, 'CLP'], [50_000, 'PEN'], [400_000, 'MXN']]) {
    const r = run(amount, from);
    const sum = (lines) => lines.reduce((s, l) => s + l.value, 0);
    assert.ok(Math.abs(sum(r.g66.lines) - r.g66.cost) < 1e-6 * amount, `g66 ${from}`);
    assert.ok(Math.abs(sum(r.bank.lines) - r.bank.cost) < 1e-6 * amount, `bank ${from}`);
  }
});

test('Global66 entrega más que el banco en montos típicos de empresa', () => {
  for (const usd of [1000, 5000, 25000, 150000]) {
    const r = run(usd * rates.CLP, 'CLP', 'EUR');
    assert.ok(r.g66.receive > r.bank.receive, `USD ${usd}`);
    assert.ok(r.savings > 0);
  }
});

test('lo recibido con Global66 coincide con monto menos costo a tasa real', () => {
  const r = run(10_000_000, 'COP', 'USD');
  const expected = (10_000_000 * (1 - r.g66.lines[0].value / 10_000_000)) * (rates.USD / rates.COP);
  assert.ok(Math.abs(r.g66.receive - expected) < 1e-9);
});

test('montos muy chicos: el banco no entrega nada y se marca', () => {
  const r = run(50_000, 'COP', 'USD');
  assert.equal(r.bank.receive, 0);
  assert.equal(r.bank.insufficient, true);
});

test('la proyección anual escala con la frecuencia', () => {
  const r = run(20_000_000, 'COP', 'USD', 4);
  assert.ok(Math.abs(r.savingsYear - r.savings * 48) < 1e-6);
});

const runMode = (mode, amount, from, to, payments = 1) =>
  compare({ mode, amount, from, to, rates, payments, assumptions: defaultAssumptions(amount, from, rates, mode, payments) });

test('conversión de divisas: sin SWIFT ni intermediarios en el banco', () => {
  const r = runMode('fx', 10_000_000, 'COP', 'USD');
  const keys = r.bank.lines.map((l) => l.key);
  assert.deepEqual(keys, ['spread', 'swift', 'iva']);
  assert.ok(r.g66.receive > r.bank.receive);
});

test('dispersión: las comisiones fijas del banco se multiplican por cada giro', () => {
  const one = runMode('payout', 50_000_000, 'COP', 'USD', 2);
  const many = runMode('payout', 50_000_000, 'COP', 'USD', 20);
  const swift = (r) => r.bank.lines.find((l) => l.key === 'swift').value;
  assert.ok(Math.abs(swift(many) - swift(one) * 10) < 1e-6);
  assert.ok(many.bank.cost > one.bank.cost);
  assert.ok(many.savings > one.savings);
});

test('en todos los modos el costo es la suma de sus líneas', () => {
  for (const [mode, p] of [['transfer', 1], ['fx', 1], ['payout', 30]]) {
    const r = runMode(mode, 80_000_000, 'COP', 'EUR', p);
    const sum = (lines) => lines.reduce((s, l) => s + l.value, 0);
    assert.ok(Math.abs(sum(r.bank.lines) - r.bank.cost) < 1e-3, mode);
    assert.ok(Math.abs(sum(r.g66.lines) - r.g66.cost) < 1e-3, mode);
  }
});
