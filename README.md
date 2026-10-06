# Global Calculator

Comparador de costos de transferencias internacionales para empresas: **Global66 Business vs banco tradicional**.

Muestra, línea por línea, lo que realmente cuesta pagar a un proveedor en el exterior: el costo de envío de Global66 frente al spread en el tipo de cambio, la comisión SWIFT, el IVA, el banco corresponsal y el banco receptor que cobra un banco tradicional.

## Qué hace

- **Cotizador** con el look del cotizador de Global66: monto, moneda de origen (COP, CLP, PEN, MXN) y de destino (USD, EUR, GBP).
- **Lo que recibe tu proveedor** con Global66 y con el banco, y la diferencia.
- **Dónde se va tu dinero**: desglose de cada cobro, marcando los costos ocultos.
- **Anatomía del costo**: barra comparativa por componente.
- **Proyección anual** según la cantidad de envíos al mes.
- **Supuestos editables**: spread, comisión SWIFT, IVA, corresponsal y receptor, para ajustar con la cotización real de un banco.
- Tasa real de mercado en vivo desde [open.er-api.com](https://open.er-api.com), con valores de respaldo si no hay conexión.
- El escenario queda en la URL (`?amount=20000000&from=COP&to=USD&n=4`), útil para compartir una simulación con un cliente.

## Cómo se calcula

| | Global66 | Banco tradicional |
|---|---|---|
| Costo de envío / comisión | % por tramo de monto (todo incluido) | Comisión SWIFT USD 35 + IVA local |
| Tipo de cambio | Tasa real | Tasa real menos spread (3,5% / 2,5% / 1,8% por tramo) |
| Intermediarios | Sin costo (pago local) | Corresponsal USD 25 + receptor USD 15 |
| Llegada | 1 a 2 días hábiles | 3 a 5 días hábiles |

Los tramos de Global66 van de 3,5% (envíos chicos) a 0,5% (más de USD 50.000), en línea con lo que muestra su cotizador: a mayor monto, menor costo. Todo vive en `js/pricing.js`.

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
