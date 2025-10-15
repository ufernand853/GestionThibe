# Proyecto Técnico – Gestión de Stock Multidepósito y Destinos

## 1. Objetivo
Diseñar un sistema que permita administrar inventario en una red de depósitos, controlando el stock por artículo y depósito, gestionando destinos comerciales y registrando movimientos de transferencia con trazabilidad completa.

---

## 2. Alcance Funcional
- **Grupos de artículos** con jerarquía (grupo padre → subgrupo) y atributos configurables (género, talle, color, material, temporada, etc.).
- **Depósitos** configurables (alta/baja/estado). Casos base: Depósito General, Sobrestock General, Sobrestock Thibe, Sobrestock Arenal, Preparación de despachos.
- **Destinos** (clientes, franquicias, marketplaces) con datos de contacto.
- **Movimientos de stock** únicamente entre depósitos (origen y destino distintos) con flujo de aprobación.
- **Reportes** de stock por grupo y por depósito con exportación CSV.
- **Auditoría** de cada movimiento (requested, approved, executed, rejected) y de acciones críticas de ABM.
- **Roles y permisos**: Administrador, Operador y Consulta (extensible).

---

## 3. Arquitectura Técnica

### 3.1 Backend
- Node.js + Express.
- MongoDB como base de datos (colecciones: users, roles, groups, items, locations, movementrequests, movementlogs, refreshtokens).
- Autenticación JWT (access + refresh) y passwords hasheadas.
- Middleware `requirePermission` para RBAC.
- Validación de transferencias: ubicaciones activas, existencia de stock, origen ≠ destino.
- Endpoints principales:
  - `/api/items` (CRUD), `/api/groups` (CRUD jerárquico).
  - `/api/locations` (ABM unificado de depósitos y destinos).
  - `/api/stock/request`, `/api/stock/approve/:id`, `/api/stock/reject/:id`, `/api/stock/requests`.
  - `/api/reports/stock/by-group`, `/api/reports/stock/by-location`.
  - `/api/logs/movements`.
  - `/api/auth/*`, `/api/users`, `/api/roles`.

### 3.2 Frontend
- React + hooks.
- Módulos: artículos (ABM + imágenes), ubicaciones, solicitudes de transferencia, aprobaciones, reportes, auditoría, usuarios.
- Navegación lateral con accesos según permisos.

### 3.3 Infraestructura
- Contenedores Docker (backend, frontend, MongoDB).
- Despliegue sugerido: VM Google Cloud (e2-standard-4) o equivalente.
- HTTPS obligatorio, backups automáticos y monitoreo.

---

## 4. Modelo de Datos

### Groups
```json
{ "id": "ObjectId", "name": "string", "parentId": "ObjectId|null" }
```

### Locations
```json
{
  "id": "ObjectId",
  "name": "string",
  "type": "warehouse|external",
  "description": "string",
  "contactInfo": "string",
  "status": "active|inactive"
}
```

### Items
```json
{
  "id": "ObjectId",
  "code": "string",
  "description": "string",
  "groupId": "ObjectId|null",
  "attributes": {
    "gender": "string|null",
    "size": "string|null",
    "color": "string|null",
    "material": "string|null",
    "season": "string|null"
  },
  "stock": {
    "<locationId>": { "boxes": "int", "units": "int" }
  },
  "images": ["string"],
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
```

### MovementRequest
```json
{
  "id": "ObjectId",
  "itemId": "ObjectId",
  "type": "transfer",
  "fromLocation": "ObjectId",
  "toLocation": "ObjectId",
  "quantity": { "boxes": "int", "units": "int" },
  "reason": "string",
  "requestedBy": "ObjectId",
  "requestedAt": "datetime",
  "status": "pending|approved|rejected|executed",
  "approvedBy": "ObjectId|null",
  "approvedAt": "datetime|null",
  "executedAt": "datetime|null",
  "rejectedReason": "string|null"
}
```

### MovementLog
```json
{
  "id": "ObjectId",
  "movementRequestId": "ObjectId",
  "action": "requested|approved|rejected|executed",
  "actorId": "ObjectId",
  "timestamp": "datetime",
  "metadata": { "ip": "string|null", "userAgent": "string|null", "notes": "string|null" }
}
```

---

## 5. Casos de Uso
1. **Reabastecimiento**: mover stock desde Sobrestock General a Depósito General tras revisar reportes.
2. **Preparación de envío**: transferir mercadería al depósito "Preparación de despachos" para consolidar pedidos de destinos.
3. **Campaña especial**: mover productos consignados (Thibe/Arenal) hacia Depósito General según demanda.
4. **Auditoría**: consultar logs para identificar quién aprobó y ejecutó un movimiento en fecha determinada.

---

## 6. Seguridad y Auditoría
- Autenticación JWT y refresh tokens.
- Permisos granulares (`items.read`, `items.write`, `stock.request`, `stock.approve`, `reports.read`, etc.).
- Logs de movimiento inmutables.
- Validación de integridad antes de ejecutar transferencias.

---

## 7. Requisitos No Funcionales
- Escalabilidad: >100k artículos, decenas de depósitos, millones de movimientos/año.
- Disponibilidad: 99.5% mensual.
- Tiempo de respuesta esperado < 2s para listados paginados.
- Backups automáticos diarios.

---

## 8. Roadmap
1. Backend: auth + ABM (grupos, depósitos, destinos, artículos).
2. Flujo de transferencias con aprobación y logs.
3. Reportes y exportaciones.
4. Frontend completo.
5. Automatizaciones / integraciones externas.
6. Observabilidad (monitoring, alertas) y CI/CD.
