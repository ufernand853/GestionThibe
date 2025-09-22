# Proyecto Técnico – Gestión de Stock y Clientes

## 1. Objetivo
Desarrollar un sistema de gestión de stock que permita:
- Controlar inventario en múltiples **grupos de artículos**.
- Administrar **sobrestock** general y específico (Thibe, Arenal Import).
- Gestionar **stock reservado para clientes** (evitar mezcla con stock general).
- Registrar **movimientos** (entrada, salida, transferencia) con **flujo de autorización** por usuarios **rol Administrador** en salidas y movimientos críticos.
- Mantener **auditoría completa (logs)** de movimientos y acciones críticas (ABM).
- **ABM de usuarios** con **roles y permisos** (RBAC).
- Consultar y exportar **reportes** de stock, movimientos y aprobaciones.

---

## 2. Alcance Funcional
- **Grupos de artículos (Taxonomía base)**: Medias, Ropa Interior, Blancos, Accesorios, Jean Hombre/Dama/Niño, Ropa Hombre/Dama/Niño, Calzado, Electrónicos, Juguetes, Escolares.
- **Clasificaciones y atributos por producto (facetas)**:
  - **Grupo**: Pantalones → (Jean, Deportivos, Chinos, Joggers, etc.).
  - **Género**: Dama, Caballero, Niño/a, Unisex.
  - **Tamaños**: Sistema flexible (p.ej., S–XXL, 36–48, numérico calzado, talla niños).
  - **Colores**: catálogo estándar + colores libres (hex/rgb) para variantes.
  - **Atributos adicionales** por tipo de producto (ej.: material, temporada, calce).
- **Listas de stock**:
  - **Stock General**
  - **Sobrestock** (General, Thibe, Arenal Import)
  - **Clientes** (stock reservado por cliente)
- **Operaciones**:
  - **Alta de artículos** (entrada de cajas)
  - **Baja de stock** (venta/retiro)
  - **Transferencias** entre listas (ej.: General → Cliente)
  - **Flujo de autorización**: Solicitud → Aprobación (Admin) → Ejecución (para salidas y movimientos críticos).
- **ABM de Usuarios**:
  - Crear/editar/deshabilitar usuarios, reasignar roles.
  - Roles mínimos: **Administrador**, **Operador**, **Consulta** (extensible).
- **Reportes**:
  - Stock por grupo/facetas.
  - Stock reservado por cliente.
  - Histórico de movimientos y **bitácora de aprobación**.
  - Exportación CSV/Excel.

---

## 3. Arquitectura Técnica

### 3.1 Backend
- **Lenguaje**: Node.js + Express
- **Base de datos**: MongoDB (preferido) o PostgreSQL
- **Autenticación y seguridad**:
  - **JWT** (access/refresh), **hash de contraseña Argon2**, política de contraseñas.
  - **RBAC** en middleware (verificar permisos por endpoint/acción).
  - **Autorización de movimientos** mediante estados y cola de aprobaciones.
  - HTTPS, CORS restringido, rate limiting.
- **API REST (principales)**:
  - `POST /api/items` → crear artículo
  - `GET /api/items` → listar artículos (filtros por grupo/facetas)
  - `POST /api/stock/request` → solicitar movimiento
  - `POST /api/stock/approve/:requestId` → aprobar (Admin) y ejecutar
  - `POST /api/stock/reject/:requestId` → rechazar (Admin)
  - `GET /api/stock/requests` → listar solicitudes (pendientes/históricas)
  - `GET /api/customers/:id/stock` → stock del cliente
  - `GET /api/reports/stock` → reportes de stock
  - `GET /api/logs/movements` → logs de movimientos
  - `POST /api/auth/login` / `POST /api/auth/refresh` / `POST /api/auth/logout`
  - `GET /api/users` / `POST /api/users` / `PUT /api/users/:id` / `DELETE /api/users/:id`
  - `GET /api/roles` → definición de roles/permisos
- **Cola de aprobaciones**: persistida en BD; opcionalmente, usar job queue (BullMQ) para ejecutar transacciones al aprobar.

### 3.2 Frontend
- **Framework**: React.js
- **Módulos**:
  - Gestión de artículos y variantes (facetas: género, talla, color, etc.).
  - **Solicitudes de movimiento** (Operador): formulario y tracking de estado.
  - **Bandeja de aprobación** (Admin): aprobar/rechazar con observaciones.
  - Gestión de usuarios y roles (Admin).
  - Reportes y exportaciones.
  - Auditoría (visualización de logs y filtros).

### 3.3 Infraestructura
- **Hosting**: VM en Google Cloud (ej. e2-standard-4 ~ USD 150/mes)
- **Contenedores**: Docker (backend, frontend)
- **BD administrada**: MongoDB Atlas o Cloud SQL
- **Seguridad**: JWT + HTTPS, backups automáticos, rotación de claves

---

## 4. Modelo de Datos

### Groups
```json
{ "id": "uuid", "name": "string", "parentId": "uuid|null" }
```

### Items
```json
{
  "id": "uuid",
  "code": "string",
  "description": "string",
  "groupId": "uuid",
  "attributes": {
    "gender": "Dama|Caballero|Niño/a|Unisex",
    "size": "string",
    "color": "string",
    "material": "string|null",
    "season": "string|null",
    "fit": "string|null"
  },
  "stock": {
    "general": "int",
    "overstockGeneral": "int",
    "overstockThibe": "int",
    "overstockArenal": "int"
  },
  "createdAt": "datetime",
  "updatedAt": "datetime"
}
```

### Customers
```json
{ "id": "uuid", "name": "string", "contactInfo": "string", "status": "active|inactive" }
```

### CustomerStock
```json
{
  "id": "uuid",
  "customerId": "uuid",
  "itemId": "uuid",
  "quantity": "int",
  "status": "reserved|delivered",
  "dateCreated": "datetime",
  "dateDelivered": "datetime|null"
}
```

### MovementRequest
```json
{
  "id": "uuid",
  "itemId": "uuid",
  "type": "in|out|transfer",
  "fromList": "general|overstockGeneral|overstockThibe|overstockArenal|customer",
  "toList": "general|overstockGeneral|overstockThibe|overstockArenal|customer",
  "quantity": "int",
  "reason": "string",
  "requestedBy": "uuid",
  "requestedAt": "datetime",
  "status": "pending|approved|rejected|executed",
  "approvedBy": "uuid|null",
  "approvedAt": "datetime|null",
  "rejectedReason": "string|null",
  "customerId": "uuid|null"
}
```

### MovementLog
```json
{
  "id": "uuid",
  "movementRequestId": "uuid",
  "action": "requested|approved|rejected|executed|rollback",
  "actorUserId": "uuid",
  "timestamp": "datetime",
  "metadata": { "ip": "string", "userAgent": "string", "notes": "string|null" }
}
```

### Users
```json
{
  "id": "uuid",
  "username": "string",
  "email": "string",
  "passwordHash": "string",
  "roleId": "uuid",
  "status": "active|disabled",
  "createdAt": "datetime",
  "lastLoginAt": "datetime|null"
}
```

### Roles
```json
{
  "id": "uuid",
  "name": "Admin|Operator|Viewer|...",
  "permissions": [
    "items.read", "items.write",
    "stock.request", "stock.approve", "stock.logs.read",
    "users.read", "users.write"
  ]
}
```

---

## 5. Casos de Uso

### Regla de Aprobaciones
- **Aprobaciones requeridas**: únicamente para **salidas de depósitos** (ventas, entregas) y **movimientos críticos** entre listas (ej. General → Cliente, Sobrestock → Cliente).
- **Entradas de stock** (altas por compra, producción o devolución) **no requieren aprobación**, pero sí quedan registradas en el log de movimientos.

1. **Alta stock general**  
   - Operador crea ítem o incrementa stock en lista General → se registra en log (sin aprobación).
2. **Venta con retiro inmediato**  
   - Operador solicita **baja** en General → **Aprobación Admin** → **Ejecución** → Log.
3. **Venta con reserva (cliente sin retiro)**  
   - Operador solicita **transferencia** General → Cliente (customerId) → **Aprobación Admin** → **Ejecución** → Log.
4. **Entrega diferida**  
   - Operador solicita **transferencia** Cliente → Entregado (actualiza `CustomerStock.status`) → **Aprobación Admin** → **Ejecución** → Log.
5. **ABM Usuarios**  
   - Admin crea/edita/inhabilita usuarios, asigna roles; todas las acciones se registran en log.
6. **Reportes y Auditoría**  
   - Consultas por stock/facetas, movimientos, estado de solicitudes, y exportación.

---

## 6. Seguridad y Auditoría
- **JWT** con expiración corta; **refresh tokens** seguros.
- **RBAC** en middleware por permiso/endpoint.
- **Logs inmutables** (append-only) con sellado temporal.
- **IP/userAgent** en cada log de acción.
- **Backups** diarios + retención 30 días mínimo.

---

## 7. Requisitos No Funcionales
- Escalabilidad: >100k artículos, >1k clientes, >1M movimientos/año.
- Disponibilidad: 99.5% en Google Cloud.
- Performance: listados < 1s (paginación e índices por facetas).
- Observabilidad: métricas y trazas básicas (p. ej., OpenTelemetry).

---

## 8. Roadmap
1. **Fase 1**: Autenticación, RBAC, Modelo de datos, Endpoints Items/Users.
2. **Fase 2**: Flujo de **MovementRequest** + ejecución y logs.
3. **Fase 3**: Frontend Operador/Admin (bandeja de aprobación) + reportes.
4. **Fase 4**: Hardening seguridad, backups, monitoreo y despliegue cloud.
