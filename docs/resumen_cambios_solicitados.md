# Resumen de cambios solicitados

Este documento consolida los ajustes implementados para el módulo de stock, tomando como base los requerimientos textuales y el mockup entregado. Se detalla cómo cada pedido se materializó tanto en backend como en frontend.

## Backend
- **Filtros de auditoría y movimientos:** Las rutas `/logs/movements` y `/stock/requests` ahora aceptan filtros por acción/tipo y por rango de fechas (`from`/`to`), reutilizando el helper `parseDateBoundary` para normalizar los límites de día.
- **Ejecución de transferencias:** Se mantiene la bitácora de cada acción (`requested`, `approved`, `executed`, `rejected`, `resubmitted`) con sus metadatos para permitir el seguimiento completo desde la auditoría.
- **Ubicaciones semilla:** El seed incorpora los depósitos requeridos (Guadalupe, Justicia, Arnavia, Flex, Sobrestock Arenal Import y Sobrestock Thibe, entre otros) para que estén disponibles de inmediato al crear solicitudes.

## Frontend
### Branding y layout principal
- El nombre visible de la aplicación se redujo a **“Stock”** en el `index.html`, el `Header` y el `Sidebar`, alineando el branding con el mockup.
- Se actualizó la paleta de estilos (`index.css`) para reflejar la estética mostrada (tarjetas elevadas, badges e indicadores de color).

### Dashboard / Panel principal
- Se eliminaron los módulos "Artículos activos" y "Clientes con stock reservado" y se incorporaron recordatorios destacados para artículos con recuento pendiente y artículos agotados.
- Se añadieron métricas de stock total, depósitos internos, destinos externos y solicitudes pendientes, junto con el **Top 5 de artículos por stock** que muestra código, descripción, stock consolidado y fecha del último retiro.

### Indicadores de stock reutilizables
- Se creó el helper `stockStatus` y el componente `StockStatusBadge` para representar los estados **Actualizado (verde)**, **Pendiente (amarillo)** y **Agotado (rojo)**.
- Estos indicadores aparecen ahora en los listados de Artículos, Solicitudes y Bandeja de Aprobaciones, mostrando también cuántas solicitudes pendientes afectan a cada artículo.

### Solicitudes de movimiento
- El formulario prioriza los orígenes solicitados (Guadalupe, Justicia, Arnavia, Flex, Sobrestock Arenal Import y Sobrestock Thibe), incluye una leyenda de referencia y permite filtrar el historial por estado y por fechas.
- Se habilitó el reenvío de solicitudes rechazadas y se mantiene un resumen de disponibilidad del artículo al momento de consultar el historial.

### Auditoría
- La vista de auditoría permite filtrar por acción y por rango de fechas, mostrando las etiquetas localizadas de cada acción, el identificador de la solicitud asociada y los metadatos capturados (IP, user agent, notas).

## Estado final
- Todos los requerimientos mencionados en el mockup y el documento de alcance quedaron cubiertos; no se identifican pendientes adicionales dentro del alcance definido.
