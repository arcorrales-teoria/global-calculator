// Modelo de costos: Global66 vs banco tradicional.
// Todo se calcula en la moneda de origen salvo lo que se indica.
// Los valores son referenciales y editables desde la UI.

export const ORIGINS = {
  COP: { name: 'Peso colombiano', flag: 'co', decimals: 0, iva: 19 },
  CLP: { name: 'Peso chileno', flag: 'cl', decimals: 0, iva: 19 },
  PEN: { name: 'Sol', flag: 'pe', decimals: 2, iva: 18 },
  MXN: { name: 'Peso mexicano', flag: 'mx', decimals: 2, iva: 16 },
};

export const DESTINATIONS = {
  USD: { name: 'Dólar estadounidense', flag: 'us', decimals: 2 },
  EUR: { name: 'Euro', flag: 'eu', decimals: 2 },
  GBP: { name: 'Libra esterlina', flag: 'gb', decimals: 2 },
};

// Respaldo si la API de tasas no responde (USD base, 05-oct-2026).
export const FALLBACK_RATES = {
  USD: 1,
  COP: 3286.0,
  CLP: 988.73,
  PEN: 3.4447,
  MXN: 18.106,
  EUR: 0.8921,
  GBP: 0.7565,
};

// Costo de envío Global66 por tramo (monto en USD equivalente).
// A mayor monto, menor costo: así lo describe Global66 en su cotizador.
export const G66_TIERS = [
  { upToUsd: 500, pct: 3.5 },
  { upToUsd: 2000, pct: 2.5 },
  { upToUsd: 10000, pct: 1.2 },
  { upToUsd: 50000, pct: 0.8 },
  { upToUsd: Infinity, pct: 0.5 },
];

// Costo de tipo de cambio Global66 al convertir dentro de la cuenta.
export const G66_FX_TIERS = [
  { upToUsd: 2000, pct: 2.0 },
  { upToUsd: 10000, pct: 1.0 },
  { upToUsd: 50000, pct: 0.7 },
  { upToUsd: Infinity, pct: 0.4 },
];

// Spread típico de un banco sobre la tasa real, por tramo.
export const BANK_SPREAD_TIERS = [
  { upToUsd: 10000, pct: 3.5 },
  { upToUsd: 50000, pct: 2.5 },
  { upToUsd: Infinity, pct: 1.8 },
];

// Lo que cobra normalmente un banco en un giro internacional.
export const BANK_DEFAULTS = {
  swiftUsd: 35, // comisión de giro al exterior, por giro
  correspondentUsd: 25, // banco intermediario / corresponsal, por giro
  receivingUsd: 15, // comisión del banco que recibe, por giro
  fxFeeUsd: 10, // comisión por operación de cambio (compra/venta de divisas)
};

export const MODES = {
  transfer: {
    label: 'Transferencia internacional',
    g66Tiers: G66_TIERS,
    delivery: { g66: '1 a 2 días hábiles', bank: '3 a 5 días hábiles' },
  },
  fx: {
    label: 'Conversión de divisas',
    g66Tiers: G66_FX_TIERS,
    delivery: { g66: 'Instantánea', bank: '1 día hábil' },
  },
  payout: {
    label: 'Dispersión de pagos',
    g66Tiers: G66_TIERS,
    delivery: { g66: '1 a 2 días hábiles', bank: '3 a 5 días hábiles' },
  },
};

const tierPct = (tiers, usd) => tiers.find((t) => usd <= t.upToUsd).pct;

export const g66PctFor = (usd, mode = 'transfer') => tierPct(MODES[mode].g66Tiers, usd);
export const bankSpreadFor = (usd) => tierPct(BANK_SPREAD_TIERS, usd);

// rates: unidades de cada moneda por 1 USD.
export function midRate(rates, from, to) {
  return rates[to] / rates[from];
}

const countFor = (mode, payments) => (mode === 'payout' ? Math.max(1, Math.round(payments) || 1) : 1);

export function defaultAssumptions(amount, from, rates, mode = 'transfer', payments = 1) {
  const usd = amount / rates[from];
  const n = countFor(mode, payments);
  return {
    // Global66 convierte el lote completo de una vez; el banco cotiza cada giro por separado.
    g66Pct: g66PctFor(usd, mode),
    bankSpreadPct: bankSpreadFor(usd / n),
    ivaPct: ORIGINS[from].iva,
    ...BANK_DEFAULTS,
  };
}

export function compare({ mode = 'transfer', amount, from, to, rates, assumptions, perMonth = 1, payments = 1 }) {
  const mid = midRate(rates, from, to);
  const usdToOrigin = rates[from];
  const usdToDest = rates[to];
  const a = assumptions;
  const n = countFor(mode, payments);
  const isFx = mode === 'fx';

  // Global66: un solo costo visible, se convierte el resto a tasa real.
  const g66Fee = amount * (a.g66Pct / 100);
  const g66Convert = amount - g66Fee;
  const g66Receive = Math.max(0, g66Convert * mid);

  // Banco: comisión fija + IVA antes de convertir (una por giro), spread en la tasa
  // y, si el dinero sale por SWIFT, corresponsal y receptor descuentan en el camino.
  const fee = (isFx ? a.fxFeeUsd : a.swiftUsd) * n * usdToOrigin;
  const iva = fee * (a.ivaPct / 100);
  const bankConvert = Math.max(0, amount - fee - iva);
  const bankRate = mid * (1 - a.bankSpreadPct / 100);
  const spread = bankConvert * (a.bankSpreadPct / 100);
  const perWireUsd = isFx ? 0 : a.correspondentUsd + a.receivingUsd;
  const intermediariesDest = perWireUsd * n * usdToDest;
  const bankGross = bankConvert * bankRate;
  const bankReceive = Math.max(0, bankGross - intermediariesDest);
  // Lo que no alcanzó a cubrirse no se puede cobrar: se recorta al monto.
  const deducted = Math.min(intermediariesDest, bankGross);
  const correspondent = perWireUsd ? (deducted * (a.correspondentUsd / perWireUsd)) / mid : 0;
  const receiving = deducted / mid - correspondent;

  const g66Cost = amount - g66Receive / mid;
  const bankCost = amount - bankReceive / mid;
  const savings = bankCost - g66Cost;
  const times = n > 1 ? ` (${n} giros)` : '';

  const bankLines = isFx
    ? [
      { key: 'spread', label: 'Spread en el tipo de cambio', value: spread, hidden: true },
      { key: 'swift', label: 'Comisión por operación de cambio', value: fee },
      { key: 'iva', label: `IVA sobre comisión (${a.ivaPct}%)`, value: iva },
    ]
    : [
      { key: 'spread', label: 'Spread en el tipo de cambio', value: spread, hidden: true },
      { key: 'swift', label: `Comisión de giro SWIFT${times}`, value: fee },
      { key: 'iva', label: `IVA sobre comisión (${a.ivaPct}%)`, value: iva },
      { key: 'correspondent', label: `Banco corresponsal${times}`, value: correspondent, hidden: true },
      { key: 'receiving', label: `Comisión banco receptor${times}`, value: receiving, hidden: true },
    ];

  return {
    mode,
    payments: n,
    mid,
    g66: {
      receive: g66Receive,
      rate: mid,
      convert: g66Convert,
      cost: g66Cost,
      costPct: amount ? (g66Cost / amount) * 100 : 0,
      lines: [{ key: 'fee', label: isFx ? 'Costo de tipo de cambio' : 'Costo de envío', value: g66Fee }],
    },
    bank: {
      receive: bankReceive,
      rate: bankRate,
      convert: bankConvert,
      cost: bankCost,
      costPct: amount ? (bankCost / amount) * 100 : 0,
      insufficient: bankGross <= intermediariesDest || amount <= fee + iva,
      lines: bankLines,
    },
    savings,
    savingsDest: g66Receive - bankReceive,
    savingsYear: savings * perMonth * 12,
  };
}
