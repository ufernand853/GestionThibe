# Proyecto Técnico – Gestión de Stock Multidepósito

## 1. Objetivo
Desarrollar un sistema de gestión de inventario enfocado en depósitos configurables que permita:
- Controlar existencias de múltiples **grupos de artículos** con atributos flexibles.
- Administrar **sobrestocks** específicos y depósitos intermedios para preparar envíos.
- Gestionar **destinos comerciales** (clientes finales, franquicias, marketplaces) y su información de contacto.
- Registrar **movimientos de transferencia entre depósitos** con flujos de autorización.
- Mantener una **bitácora de auditoría** de los movimientos y de las operaciones críticas de ABM.
- Operar con **roles y permisos** (RBAC) y autenticación JWT.
- Consultar y exportar **reportes** de stock por depósito y por grupo.

---

## 2. Alcance Funcional
- **Taxonomía de artículos**: Medias, Ropa Interior, Blancos, Accesorios, Jean Hombre/Dama/Niño, Ropa Hombre/Dama/Niño, Calzado, Electrónicos, Juguetes, Escolares (extensible con jerarquía padre → subgrupo).
- **Atributos configurables** por artículo:
  - **Género**: Dama, Caballero, Niño/a, Unisex.
  - **Talle / tamaño**.
  - **Color**.
  - **Material**.
  - **Temporada**.
  - Otros campos libres según la categoría.
- **Ubicaciones**:
  - Depósitos internos (General, Sobrestock General, Sobrestock Thibe, Sobrestock Arenal, Preparación de despachos).
  - Destinos externos configurables con información de contacto.
  - Alta/Baja/Edición de ubicaciones adicionales según la operación.
- **Operaciones**:
  - Alta y edición de artículos con stock distribuido por depósito.
  - Solicitud de transferencias entre depósitos (origen ≠ destino).
  - Flujo de aprobación: Solicitud → Aprobación (rol con permiso `stock.approve`) → Ejecución.
  - Registro automático de logs (requested/approved/executed/rejected).
- **ABM de Usuarios**:
  - Crear/editar/deshabilitar usuarios y asignar roles.
  - Roles base: **Administrador**, **Operador**, **Consulta** (extensible con permisos granulares).
- **Reportes**:
  - Stock consolidado por grupo (detalle por artículo y depósito).
  - Stock consolidado por depósito (detalle por artículo).
  - Exportaciones CSV.

---

## 3. Arquitectura Técnica

### 3.1 Backend
- **Lenguaje**: Node.js + Express.
- **Base de datos**: MongoDB.
- **Autenticación y seguridad**:
  - JWT (access + refresh tokens).
  - Contraseñas con bcrypt/Argon2.
  - Middleware RBAC (`requirePermission`).
  - Validación estricta de depósitos (origen/destino activos, distintos) en transferencias.
  - HTTPS, CORS controlado, rate limiting.
- **API REST** (principales):
  - `POST /api/items`, `GET /api/items`, `PUT /api/items/:id`.
  - `GET /api/groups`, `POST /api/groups`, `PUT /api/groups/:id`.
  - `GET /api/locations`, `POST /api/locations`, `PUT /api/locations/:id`, `DELETE /api/locations/:id`.
  - `POST /api/stock/request`, `POST /api/stock/approve/:id`, `POST /api/stock/reject/:id`, `GET /api/stock/requests`.
  - `GET /api/reports/stock/by-group`, `GET /api/reports/stock/by-deposit`.
  - `GET /api/logs/movements`.
  - `POST /api/auth/login`, `POST /api/auth/refresh`, `POST /api/auth/logout`.
  - `GET /api/users`, `POST /api/users`, `PUT /api/users/:id`, `DELETE /api/users/:id`.
- **Cola de aprobaciones**: los estados se persisten en MongoDB; opcional integrar BullMQ para procesar ejecuciones automáticas.

### 3.2 Frontend
- **Framework**: React.
- **Módulos**:
  - ABM de artículos con atributos y carga de imágenes.
  - Gestión de depósitos (alta/baja/estado) y destinos.
  - Solicitud y aprobación de transferencias entre depósitos.
  - Panel de reportes con filtros por depósito, grupo y atributos.
  - Administración de usuarios, roles y permisos.
  - Auditoría de movimientos.

### 3.3 Infraestructura
- **Hosting**: VM en Google Cloud (ej. e2-standard-4 ~ USD 150/mes) o plataforma equivalente.
- **Contenedores**: Docker (backend, frontend, MongoDB).
- **Seguridad**: HTTPS, backups automáticos, rotación de claves, monitoreo.

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
    "gender": "Dama|Caballero|Niño/a|Unisex|null",
    "size": "string|null",
    "color": "string|null",
    "material": "string|null",
    "season": "string|null",
    "[otros]": "string|null"
  },
  "stock": {
    "<depositId>": { "boxes": "int", "units": "int" }
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
  "metadata": {
    "ip": "string|null",
    "userAgent": "string|null",
    "notes": "string|null"
  }
}
```

---

## 5. Casos de Uso Clave

1. **Transferencia interna**
   - Operador genera solicitud Depósito General → Sobrestock General.
   - Admin aprueba y ejecuta; el stock se descuenta/abona en cada depósito.
2. **Preparación de despacho**
   - Operador mueve mercadería desde Depósito General a Preparación de despachos.
   - Cuando se confirma el envío físico se crea la documentación externa (fuera del sistema) vinculada al destino.
3. **Reabastecimiento por campaña**
   - Reporte por grupo identifica faltantes.
   - Operador mueve stock desde Sobrestock Thibe hacia Depósito General para reponer tiendas.
4. **Auditoría**
   - Usuario de consulta revisa logs filtrados por depósito, artículo o fecha para validar quién autorizó cada transferencia.

---

## 6. Requerimientos No Funcionales
- **Escalabilidad**: >100k artículos, decenas de depósitos, millones de movimientos anuales.
- **Disponibilidad**: 99.5% mensual.
- **Integridad**: validación transaccional de transferencias (origen y destino consistentes).
- **Auditoría**: histórico inmutable de logs (solo append).
- **Performance**: listados < 2s (con paginación y filtros indexados).

---

## 7. Roadmap Sugerido
1. Backend base (auth, grupos, artículos, depósitos, destinos).
2. Movimientos con aprobación y logs.
3. Reportes por depósito/grupo + exportaciones.
4. Frontend React completo.
5. Integraciones externas (ERP, WMS) y automatizaciones.
6. Métricas, monitoreo y CI/CD.
