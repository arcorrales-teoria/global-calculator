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
