# Prompts para Codex – Generación de Código

## 1) Modelos de Datos (Mongoose)
Genera esquemas Mongoose para las entidades definidas en `SPEC.md`:
- Users, Roles
- Items, Groups
- MovementRequest, MovementLog
- Deposits, Destinations

Requisitos: timestamps, índices útiles (code, groupId, attributes.gender/size/color), validaciones básicas, enum de estados.

> Prompt:
"Usando la sección 'Modelo de Datos' de SPEC.md, genera los esquemas Mongoose con TypeScript.
Incluye índices por `code`, `groupId`, y `MovementRequest.status`. 
Exporta modelos tipados y configura `collection` explícita."

## 2) Autenticación y RBAC
> Prompt:
"Implementa auth con JWT (access/refresh) usando Express + TypeScript. 
Hash de contraseña con Argon2. 
Crea middleware `requireAuth` y `requirePermission(permission:string)` leyendo permisos del rol del usuario."

## 3) Flujo de Aprobaciones de Movimientos
> Prompt:
"Implementa endpoints: 
POST /api/stock/request, POST /api/stock/approve/:requestId, POST /api/stock/reject/:requestId, GET /api/stock/requests.
Respeta la 'Regla de Aprobaciones' de SPEC.md: aprobaciones SOLO para salidas y movimientos críticos. 
Entradas no requieren aprobación pero generan log. 
Actualizar stocks de manera transaccional al aprobar."

## 4) Logging de Auditoría
> Prompt:
"Implementa el servicio `AuditLogger` que persista `MovementLog` para acciones: requested, approved, rejected, executed, rollback, con ip y userAgent.
Crea endpoint GET /api/logs/movements con filtros por fecha, usuario, itemId, fromDepositId, toDepositId, tipo de acción y status."

## 5) Endpoints de Catálogo
> Prompt:
"Implementa CRUD de Items, Groups, Deposits y Destinations con soporte de facetas (género, talla, color).
GET /api/items debe permitir filtros por facetas y paginación; responde en <1s con índices adecuados."

## 6) Frontend Básico (React)
> Prompt:
"Crea un front React con módulos: ABM Items/Users, Bandeja de Aprobación (Admin), Solicitudes de Movimiento (Operador), Reportes. 
Implementa login JWT y guarda tokens de forma segura."

## 7) Docker e Infra
> Prompt:
"Crea Dockerfiles para backend y frontend, y docker-compose para desarrollo local. 
Incluye `.env.example` y scripts de seed inicial (roles y admin)." 
