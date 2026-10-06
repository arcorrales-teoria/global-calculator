// Modelo de costos: Global66 vs banco tradicional.
// Todo se calcula en la moneda de origen salvo lo que se indica.
// Los valores son referenciales y editables desde la UI.

export const ORIGINS = {
  COP: { country: 'Colombia', flag: 'co', decimals: 0, iva: 19 },
  CLP: { country: 'Chile', flag: 'cl', decimals: 0, iva: 19 },
  PEN: { country: 'Perú', flag: 'pe', decimals: 2, iva: 18 },
  MXN: { country: 'México', flag: 'mx', decimals: 2, iva: 16 },
};

export const DESTINATIONS = {
  USD: { country: 'Estados Unidos', flag: 'us', decimals: 2 },
  EUR: { country: 'Unión Europea', flag: 'eu', decimals: 2 },
  GBP: { country: 'Reino Unido', flag: 'gb', decimals: 2 },
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

// Spread típico de un banco sobre la tasa real, por tramo.
export const BANK_SPREAD_TIERS = [
  { upToUsd: 10000, pct: 3.5 },
  { upToUsd: 50000, pct: 2.5 },
  { upToUsd: Infinity, pct: 1.8 },
];

export const BANK_DEFAULTS = {
  swiftUsd: 35, // comisión de giro al exterior
  correspondentUsd: 25, // banco intermediario / corresponsal
  receivingUsd: 15, // comisión del banco que recibe
};

export const DELIVERY = {
  g66: '1 a 2 días hábiles',
  bank: '3 a 5 días hábiles',
};

const tierPct = (tiers, usd) => tiers.find((t) => usd <= t.upToUsd).pct;

export const g66PctFor = (usd) => tierPct(G66_TIERS, usd);
export const bankSpreadFor = (usd) => tierPct(BANK_SPREAD_TIERS, usd);

// rates: unidades de cada moneda por 1 USD.
export function midRate(rates, from, to) {
  return rates[to] / rates[from];
}

export function defaultAssumptions(amount, from, rates) {
  const usd = amount / rates[from];
  return {
    g66Pct: g66PctFor(usd),
    bankSpreadPct: bankSpreadFor(usd),
    ivaPct: ORIGINS[from].iva,
    ...BANK_DEFAULTS,
  };
}

export function compare({ amount, from, to, rates, assumptions, perMonth = 1 }) {
  const mid = midRate(rates, from, to);
  const usdToOrigin = rates[from];
  const usdToDest = rates[to];
  const a = assumptions;

  // Global66: un solo costo de envío visible, se convierte el resto.
  const g66Fee = amount * (a.g66Pct / 100);
  const g66Convert = amount - g66Fee;
  const g66Rate = mid;
  const g66Receive = Math.max(0, g66Convert * g66Rate);

  // Banco: comisión SWIFT + IVA se descuentan antes de convertir,
  // se aplica el spread y en el camino descuentan corresponsal y receptor.
  const swift = a.swiftUsd * usdToOrigin;
  const iva = swift * (a.ivaPct / 100);
  const bankConvert = Math.max(0, amount - swift - iva);
  const bankRate = mid * (1 - a.bankSpreadPct / 100);
  const spread = bankConvert * (a.bankSpreadPct / 100);
  const intermediariesDest = (a.correspondentUsd + a.receivingUsd) * usdToDest;
  const bankGross = bankConvert * bankRate;
  const bankReceive = Math.max(0, bankGross - intermediariesDest);
  // Lo que no alcanzó a cubrirse no se puede cobrar: se recorta al monto.
  const deducted = Math.min(intermediariesDest, bankGross);
  const correspondent = (deducted * (a.correspondentUsd / (a.correspondentUsd + a.receivingUsd || 1))) / mid;
  const receiving = deducted / mid - correspondent;

  const g66Cost = amount - g66Receive / mid;
  const bankCost = amount - bankReceive / mid;
  const savings = bankCost - g66Cost;

  return {
    mid,
    g66: {
      receive: g66Receive,
      rate: g66Rate,
      convert: g66Convert,
      cost: g66Cost,
      costPct: amount ? (g66Cost / amount) * 100 : 0,
      lines: [{ key: 'fee', label: 'Costo de envío', value: g66Fee }],
    },
    bank: {
      receive: bankReceive,
      rate: bankRate,
      convert: bankConvert,
      cost: bankCost,
      costPct: amount ? (bankCost / amount) * 100 : 0,
      insufficient: bankGross <= intermediariesDest,
      lines: [
        { key: 'spread', label: 'Spread en el tipo de cambio', value: spread, hidden: true },
        { key: 'swift', label: 'Comisión de giro SWIFT', value: swift },
        { key: 'iva', label: `IVA sobre comisión (${a.ivaPct}%)`, value: iva },
        { key: 'correspondent', label: 'Banco corresponsal', value: correspondent, hidden: true },
        { key: 'receiving', label: 'Comisión banco receptor', value: receiving, hidden: true },
      ],
    },
    savings,
    savingsDest: g66Receive - bankReceive,
    savingsYear: savings * perMonth * 12,
  };
}
