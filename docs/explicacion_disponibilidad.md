# Cómo se calcula y filtra la disponibilidad

Este documento resume, en español, los ajustes hechos en el front para que el estado de disponibilidad de los artículos se alinee con la realidad.

## Lógica general de estados
- **Fuente de datos:** El grid no usa un campo "disponibilidad" del backend, sino que combina stock por depósito y solicitudes de movimiento pendientes.
- **Agregación de pendientes:** Las solicitudes `/stock/requests?status=pending` se agrupan por artículo (`aggregatePendingByItem`) sumando sus cantidades y contando cuántas solicitudes afectan a cada ítem.
- **Pendientes explícitos en stock:** Si un depósito declara `pending` en su stock, ese valor se respeta y no se descuenta del stock, pero igual marca al ítem como pendiente.
- **Derivación del estado:** `deriveStockStatus` define el estado final:
  - *Agotado* si el stock total es 0.
  - *Actualizado* si hay stock y no hay pendientes.
  - *Agotado (reservado)* si los pendientes consumen todo el stock.
  - *Pendiente* si queda stock pero existen cantidades pendientes.

## Ajuste aplicado para reflejar la realidad
Antes, todas las solicitudes pendientes se contaban siempre, aunque provinieran de depósitos ajenos al contexto que el usuario estaba mirando. Esto hacía que muchos ítems aparecieran como "Pendiente" aunque no tuvieran movimientos relevantes.

Para corregirlo:
- `aggregatePendingByItem` ahora acepta una función `filter` opcional que decide qué solicitudes contar.
- En la grilla de artículos (`ItemsPage.jsx`), se pasa un filtro (`shouldCountPendingRequest`) que solo suma las solicitudes cuyo depósito de **origen** está en la lista de depósitos visibles para el usuario. Así, los pendientes de otros depósitos ya no afectan el estado mostrado.

Resultado: la disponibilidad se calcula únicamente con los movimientos que realmente impactan los depósitos visibles, evitando falsos "Pendiente".
