# Gestión de Stock y Clientes

Este repositorio reúne la documentación funcional y una base de código inicial para construir la solución de inventario y reservas descrita en `Proyecto_Tecnico_Stock.md`.

## Contenido principal

- `SPEC.md`: arquitectura detallada, alcance funcional y roadmap sugerido.
- `Proyecto_Tecnico_Stock.md`: visión funcional extendida (casos de uso, roles, flujos).
- `openapi.yaml`: contrato API de alto nivel para el backend.
- `codex_prompts.md`: guías para generación asistida.
- `backend/`: implementación de referencia de la API REST sobre Node.js + Express + MongoDB.

## Backend incluido

El directorio `backend/` contiene un proyecto Express que persiste la información en MongoDB mediante Mongoose. Cubre:

- Autenticación por JWT (access + refresh tokens) y control de acceso por permisos de rol.
- ABM de usuarios, grupos, artículos, clientes y reservas.
- Solicitud, aprobación, ejecución y rechazo de movimientos de stock con bitácora de auditoría.
- Reportes básicos de stock general y reservas por cliente.

La capa de persistencia utiliza colecciones dedicadas (`users`, `roles`, `items`, `customers`, `customerstocks`, `movementrequests`, `movementlogs`, `refreshtokens`). Al iniciar el servicio se crean automáticamente los roles base y el usuario administrador inicial.

### Requisitos previos

- Node.js 18+
- MongoDB en ejecución (local o remota)

### Instalación y ejecución local

```bash
cd backend
npm install
# Variables opcionales en un archivo .env (ver sección siguiente)
npm start
```

Por defecto el servidor se levanta en `http://localhost:3000` y se conecta a `mongodb://localhost:27017/gestionthibe`.

#### Variables de entorno soportadas

| Variable | Descripción | Valor por defecto |
|----------|-------------|-------------------|
| `PORT` | Puerto HTTP del backend | `3000` |
| `MONGO_URI` | Cadena de conexión a MongoDB | `mongodb://localhost:27017/gestionthibe` |
| `JWT_SECRET` | Secreto para firmar los tokens JWT | `development-secret` |
| `ACCESS_TOKEN_TTL` | Tiempo de vida del access token (segundos) | `3600` |
| `REFRESH_TOKEN_TTL` | Tiempo de vida del refresh token (segundos) | `604800` |
| `ADMIN_EMAIL` | Email del usuario administrador semilla | `admin@example.com` |
| `ADMIN_PASSWORD` | Contraseña del usuario administrador semilla | `ChangeMe123!` |

### Credenciales iniciales

Al primer arranque se crean los roles `Administrador`, `Operador` y `Consulta`, junto con un usuario administrador activo:

- **Usuario**: valor de `ADMIN_EMAIL` (por defecto `admin@example.com`)
- **Contraseña**: valor de `ADMIN_PASSWORD` (por defecto `ChangeMe123!`)

Se recomienda cambiar la contraseña apenas se acceda al sistema y ajustar los permisos según la operación real.

### Endpoints principales

La API implementa el contrato descripto en `openapi.yaml`, incluyendo:

- `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`
- `/api/users` (CRUD), `/api/roles`
- `/api/groups`, `/api/items`
- `/api/customers`, `/api/customers/{id}/stock`
- `/api/stock/request`, `/api/stock/approve/{id}`, `/api/stock/reject/{id}`, `/api/stock/requests`
- `/api/logs/movements`
- `/api/reports/stock`

Todas las rutas (excepto `POST /api/auth/login` y `POST /api/auth/refresh`) requieren encabezado `Authorization: Bearer <token>` generado desde el login.

### Próximos pasos sugeridos

1. Incorporar pruebas automatizadas (unitarias/integración) para los casos críticos de negocio.
2. Completar endpoints adicionales, paginaciones avanzadas y validaciones específicas según las necesidades de la operación.
3. Construir el frontend React y pipelines CI/CD descritos en la hoja de ruta.
4. Configurar métricas, monitoreo y backups para la instancia de MongoDB en los ambientes de despliegue.

## ¿Necesitas desplegar una demo rápida?

Ejecuta el asistente automático incluido en [`scripts/demo_deployer.py`](scripts/demo_deployer.py):

```bash
python scripts/demo_deployer.py
```

El script se encargará de:

- Instalar MongoDB automáticamente (modo `install`) o crear/reutilizar un contenedor Docker listo para la demo.
- Instalar dependencias y generar los archivos `.env` del backend y frontend.
- Construir el frontend y levantar ambos servicios (puedes omitir el arranque con `--no-start`).
- Opcionalmente, empaquetar todo en un ZIP portable mediante `--package-zip` para moverlo a otra máquina (si Docker no está
  disponible, el script generará el paquete y omitirá el arranque de servicios automáticamente).

Para más detalles y opciones avanzadas (`--mongo-mode`, `--backend-port`, etc.), revisa la guía [`docs/demo-deployment.md`](docs/demo-deployment.md).
