# Global Calculator

Comparador de costos de transferencias internacionales para empresas: **Global66 Business vs banco tradicional**.

Muestra, línea por línea, lo que realmente cuesta pagar a un proveedor en el exterior: el costo de envío de Global66 frente al spread en el tipo de cambio, la comisión SWIFT, el IVA, el banco corresponsal y el banco receptor que cobra un banco tradicional.

## Modos

| Modo | Global66 | Banco tradicional |
|---|---|---|
| **Transferencia internacional** | Costo de envío por tramo, pago local | Spread + SWIFT + IVA + corresponsal + receptor |
| **Conversión de divisas** | Costo de tipo de cambio por tramo, instantánea | Spread + comisión por operación de cambio + IVA |
| **Dispersión de pagos** (multienvío) | Una sola conversión para todo el lote | Un giro SWIFT por beneficiario: las comisiones fijas se multiplican |

## Qué hace

1. **Cotizador**: pestañas Transferir / Convertir / Dispersar, monto y monedas. Muestra cuánto recibe tu proveedor con Global66 y con tu banco, y cuánto ahorras. El detalle de lo que cobra el banco se despliega en "Ver lo que te cobra tu banco".
2. **Simulador "Dónde se va tu dinero"**: tabla Concepto | Tu banco | Global66. Cada cobro se abre con una explicación y un control para ajustarlo (deslizador, valor exacto e interruptor "Lo cobra"). Perfiles rápidos de banco: Poco, Lo típico, Mucho. Pasar el mouse por una fila resalta su parte en la barra de costos y viceversa.
3. **Proyección anual** según operaciones al mes.

Todo se recalcula en vivo. La tasa real viene de [open.er-api.com](https://open.er-api.com), con valores de respaldo sin conexión. El escenario queda en la URL (`?mode=payout&amount=150000000&from=COP&to=USD&n=2&p=25`).

## Cómo se calcula

| | Global66 | Banco tradicional |
|---|---|---|
| Costo de envío / comisión | % por tramo de monto (todo incluido) | Comisión SWIFT USD 35 + IVA local |
| Tipo de cambio | Tasa real | Tasa real menos spread (3,5% / 2,5% / 1,8% por tramo) |
| Intermediarios | Sin costo (pago local) | Corresponsal USD 25 + receptor USD 15 |
| Llegada | 1 a 2 días hábiles | 3 a 5 días hábiles |

Los tramos de Global66 van de 3,5% (envíos chicos) a 0,5% (más de USD 50.000), en línea con lo que muestra su cotizador: a mayor monto, menor costo. El modelo vive en `js/pricing.js`; la interacción en `js/app.js`.

## Correr local

Sitio estático, sin dependencias ni build.

```bash
npm start      # http://localhost:5173
npm test       # tests del modelo de costos (node --test)
```

## Publicar en GitHub Pages

Settings → Pages → Deploy from a branch → `main` / root.

## Aviso

Proyecto demostrativo independiente, no oficial de Global66. Los costos son estimaciones referenciales por tramo y no constituyen una cotización. Logo y marca pertenecen a Global66.
