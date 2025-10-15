# Gestión de Stock Multidepósito

Este repositorio reúne la documentación funcional y una base de código inicial para construir una solución de inventario multidepósito centrada en transferencias entre ubicaciones (depósitos internos y destinos externos), tal como se detalla en `Proyecto_Tecnico_Stock.md`.

## Contenido principal

- `SPEC.md`: arquitectura detallada, alcance funcional y roadmap sugerido.
- `Proyecto_Tecnico_Stock.md`: visión funcional extendida (casos de uso, roles, flujos).
- `openapi.yaml`: contrato API de alto nivel para el backend.
- `codex_prompts.md`: guías para generación asistida.
- `backend/`: implementación de referencia de la API REST sobre Node.js + Express + MongoDB.

## Backend incluido

El directorio `backend/` contiene un proyecto Express que persiste la información en MongoDB mediante Mongoose. Cubre:

- Autenticación por JWT (access + refresh tokens) y control de acceso por permisos de rol.
- ABM de usuarios, grupos, artículos y ubicaciones.
- Solicitud, aprobación, ejecución y rechazo de movimientos de stock con bitácora de auditoría.
- Reportes de stock por grupo y por ubicación.

La capa de persistencia utiliza colecciones dedicadas (`users`, `roles`, `items`, `locations`, `movementrequests`, `movementlogs`, `refreshtokens`). Al iniciar el servicio se crean automáticamente los roles base y el usuario administrador inicial.

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
| `MONGO_URI` | Cadena de conexión a MongoDB. Si incluye usuario/contraseña asegurate de agregar los parámetros necesarios (p. ej. `authSource`). | `mongodb://localhost:27017/gestionthibe` |
| `MONGO_DB_NAME` | Nombre de la base de datos a utilizar cuando se provee la URI sin sufijo o se necesita forzar otra base. | `gestionthibe` (si no se especifica en la URI) |
| `MONGO_USER` | Usuario para autenticarse contra MongoDB (alternativa a incrustarlo en la URI). | - |
| `MONGO_PASSWORD` | Contraseña asociada al usuario anterior. | - |
| `MONGO_AUTH_SOURCE` | Base de datos donde está definido el usuario (comúnmente `admin` en instalaciones con autenticación). | - |
| `MONGO_AUTH_MECHANISM` | Mecanismo de autenticación (por ejemplo `SCRAM-SHA-1` o `SCRAM-SHA-256`). | - |
| `MONGO_TLS` | Activa la conexión TLS cuando la instancia lo requiere (`true`/`false`). | - |
| `MONGO_TLS_CA_FILE` | Ruta al certificado CA cuando se habilita TLS con certificados propios. | - |
| `JWT_SECRET` | Secreto para firmar los tokens JWT | `development-secret` |
| `ACCESS_TOKEN_TTL` | Tiempo de vida del access token (segundos) | `3600` |
| `REFRESH_TOKEN_TTL` | Tiempo de vida del refresh token (segundos) | `604800` |
| `ADMIN_EMAIL` | Email del usuario administrador semilla | `admin@example.com` |
| `ADMIN_PASSWORD` | Contraseña del usuario administrador semilla | `ChangeMe123!` |

> 💡 **Tip:** si ves el error `MongoServerError: Authentication failed` asegurate de que las variables `MONGO_USER`, `MONGO_PASSWORD` y `MONGO_AUTH_SOURCE` coincidan con el usuario creado en tu instancia. Alternativamente podés incluirlas directamente en `MONGO_URI`, recordando sumar los parámetros como `authSource=admin` cuando corresponda.

### Credenciales iniciales

Al primer arranque se crean los roles `Administrador`, `Operador` y `Consulta`, junto con un usuario administrador activo:

- **Usuario**: valor de `ADMIN_EMAIL` (por defecto `admin@example.com`)
- **Contraseña**: valor de `ADMIN_PASSWORD` (por defecto `ChangeMe123!`)

Se recomienda cambiar la contraseña apenas se acceda al sistema y ajustar los permisos según la operación real.

### Datos de ejemplo

En `backend/docs/sample-dataset.json` se incluye un juego de datos genérico que cubre roles, usuarios, grupos, artículos, depósitos,
destinos y bitácoras de movimiento. El archivo está pensado para acelerar pruebas manuales o demostraciones locales e incorpora
un catálogo ampliado de artículos para probar listados y filtros. El contenido está expresado en **Extended JSON**, por lo que
conserva los `ObjectId` y referencias entre colecciones al importarlo desde herramientas como MongoDB Compass o `mongoimport`.

El dataset crea automáticamente los depósitos base (Depósito General, Sobrestock General, Sobrestock Thibe, Sobrestock Arenal y Preparación de despachos) y asigna stock a cada artículo utilizando los identificadores reales de esos depósitos. Asimismo, incluye destinos comerciales de ejemplo y solicitudes de transferencia entre depósitos para ilustrar los distintos estados (pendiente, aprobado, ejecutado y rechazado).

El dataset define los grupos iniciales requeridos por la solución:

- Medias
- Ropa Interior
- Blancos
- Accesorios
- Jean Hombre / Jean Dama / Jean Niño
- Ropa Hombre / Ropa Dama / Ropa Niño
- Calzado
- Electrónicos
- Juguetes
- Escolares

Sobre esos grupos se cargan 26 artículos de ejemplo distribuidos en todas las categorías, junto con movimientos de stock que
incluyen casos ejecutados, autorizados pendientes de ejecución y una solicitud todavía pendiente de aprobación.

**Credenciales del dataset:** el usuario administrador incluido (`admin@example.com`) tiene la contraseña `Admin#2024` para iniciar sesión
con los datos importados. Podés modificarla desde la API una vez que accedas al sistema.

#### Importación automática (CLI)

Desde el directorio `backend/` podés ejecutar un script que distribuye el contenido del dataset en las colecciones reales que usa la aplicación:

```bash
cd backend
npm run seed:sample -- --uri mongodb://localhost:27017 --db gestionthibe --drop-existing
```

Opciones disponibles:

- `--uri`: cadena de conexión a MongoDB (por defecto `mongodb://localhost:27017`).
- `--db`: nombre de la base de datos destino (por defecto `gestionthibe`).
- `--file`: ruta alternativa al JSON a importar.
- `--drop-existing`: elimina el contenido previo de cada colección antes de insertar los datos (recomendado para ambientes de prueba limpios).

El script convierte automáticamente las fechas en objetos `Date`, normaliza todos los identificadores a `ObjectId` válidos y muestra
un resumen con la cantidad de documentos insertados por colección.

#### Importación manual con `mongoimport`

Si preferís un enfoque manual, podés cargar el JSON completo en una colección temporal usando `mongoimport` (ajustando la URI y la base de datos destino):

```bash
mongoimport \
  --uri "mongodb://localhost:27017/gestionthibe" \
  --collection seedDataset \
  --file backend/docs/sample-dataset.json
```

La colección destino (`seedDataset` en el ejemplo) actúa como contenedor intermedio para manipular los documentos antes de distribuirlos en las colecciones finales mediante scripts o pipelines personalizados.

#### Importación manual desde MongoDB Compass

Si preferís realizar la importación desde **MongoDB Compass**, seguí estos pasos:

1. Abrí Compass y conectate a tu instancia de MongoDB (por ejemplo `mongodb://localhost:27017`).
2. En el panel izquierdo, creá o seleccioná la base de datos donde querés cargar los datos (por ejemplo `gestionthibe`).
3. Creá una colección vacía (por ejemplo `seedDataset`) y hacé clic en ella.
4. En la barra superior elegí **Add Data** → **Import JSON or CSV file...**.
5. Seleccioná el archivo `backend/docs/sample-dataset.json`, definí el formato como **JSON** y marcá la casilla **Import as Extended JSON**
   para que Compass respete los `ObjectId` definidos.
6. Confirmá con **Import**. Compass cargará todos los documentos en la colección seleccionada.

Una vez importados, podés distribuir los documentos a las colecciones definitivas mediante agregaciones o scripts según tu flujo de trabajo.

### Endpoints principales

La API implementa el contrato descripto en `openapi.yaml`, incluyendo:

- `/api/auth/login`, `/api/auth/refresh`, `/api/auth/logout`
- `/api/users` (CRUD), `/api/roles`
- `/api/groups`, `/api/items`
- `/api/locations`
- `/api/stock/request`, `/api/stock/approve/{id}`, `/api/stock/reject/{id}`, `/api/stock/requests`
- `/api/logs/movements`
- `/api/reports/stock/by-group`, `/api/reports/stock/by-location` (alias `/by-deposit` preservado)

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
