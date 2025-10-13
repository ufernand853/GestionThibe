# Guía de despliegue rápido para demo

Esta guía resume los pasos necesarios para levantar el backend y el frontend de la solución en una máquina nueva para realizar una demo.

## Opción recomendada: script de despliegue automático

Para automatizar todas las tareas puedes usar el script `scripts/demo_deployer.py`. Desde la raíz del repositorio ejecuta:

```bash
python scripts/demo_deployer.py
```

El asistente validará que Node.js (y Docker, si eliges esa opción) estén disponibles, generará los archivos `.env`, instalará dependencias y levantará backend y frontend con los valores por defecto:

- Backend en `http://localhost:3000`
- Frontend en `http://localhost:4173`
- MongoDB en un contenedor Docker (`gestionthibe-mongo`) apuntado por la URI `mongodb://admin:admin123@localhost:27017/gestionthibe?authSource=admin`

### Parámetros útiles

El script acepta varias banderas para personalizar la demo:

| Bandera | Descripción |
| --- | --- |
| `--mongo-mode {docker,uri,skip}` | Controla cómo se prepara MongoDB. `docker` (por defecto) crea/reutiliza un contenedor local. `uri` exige proporcionar `--mongo-uri`. `skip` asume que ya tienes MongoDB listo e igualmente puedes definir `--mongo-uri`. |
| `--mongo-uri <cadena>` | Cadena de conexión a MongoDB cuando no usas Docker o necesitas un host diferente. |
| `--backend-port <puerto>` | Puerto HTTP para el backend (por defecto `3000`). |
| `--frontend-port <puerto>` | Puerto para `npm run preview` del frontend (por defecto `4173`). |
| `--admin-email <correo>` | Email del usuario administrador semilla. |
| `--admin-password <clave>` | Contraseña del usuario administrador semilla. |
| `--skip-build` | Evita ejecutar `npm run build` en el frontend (útil para validaciones rápidas). |
| `--no-start` | Prepara todo pero no deja procesos corriendo; así puedes iniciarlos manualmente luego. |

> Presiona `Ctrl+C` para detener los procesos iniciados por el script. Al hacerlo, se envían señales de terminación a backend y frontend.

Si prefieres ejecutar cada paso manualmente o necesitas comprender el detalle de lo que hace el script, continúa con la guía paso a paso.

## 1. Requisitos previos

1. **Sistema operativo**: Linux, macOS o Windows 10/11 con WSL2.
2. **Herramientas base**:
   - [Node.js 18 LTS](https://nodejs.org/) (incluye `npm`).
   - [Git](https://git-scm.com/).
3. **Base de datos MongoDB**:
   - Puede ser un servidor existente accesible por red o un contenedor local con Docker.
4. (Opcional) [Docker](https://www.docker.com/) para levantar MongoDB rápidamente.

> Si la demo se realizará en una red sin acceso a Internet, descarga previamente el instalador de Node.js y el binario/imagen de MongoDB.

## 2. Preparar MongoDB

### Opción A: Usar un contenedor Docker (recomendado para demos)

```bash
docker run --name gestionthibe-mongo \
  -p 27017:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=admin123 \
  -d mongo:6
```

- El backend se conectará a `mongodb://admin:admin123@localhost:27017/gestionthibe?authSource=admin`.
- Si Docker no está instalado, salta a la opción B.

### Opción B: Usar una instalación existente de MongoDB

1. Instala MongoDB Community Edition o usa un clúster de MongoDB Atlas.
2. Asegúrate de que el puerto 27017 esté accesible desde la máquina donde correrá el backend.
3. Crea un usuario con permisos de lectura/escritura sobre la base que utilizará la demo (`gestionthibe`).

## 3. Clonar el repositorio

```bash
git clone https://github.com/<ORGANIZACION>/GestionThibe.git
cd GestionThibe
```

Si ya tienes una copia, actualízala con `git pull`.

## 4. Configurar el backend

1. Ve al directorio del backend:

   ```bash
   cd backend
   npm install
   cp .env.example .env
   ```

2. Edita `.env` y completa los valores. Para el escenario Docker anterior puedes usar:

   ```ini
   PORT=3000
   MONGO_URI=mongodb://admin:admin123@localhost:27017/gestionthibe?authSource=admin
   JWT_SECRET=cambia-este-valor
   ACCESS_TOKEN_TTL=3600
   REFRESH_TOKEN_TTL=604800
   ADMIN_EMAIL=admin@example.com
   ADMIN_PASSWORD=ChangeMe123!
   ```

   - Cambia `JWT_SECRET` por una cadena aleatoria.
   - Personaliza `ADMIN_EMAIL`/`ADMIN_PASSWORD` si quieres una cuenta distinta para la demo.

3. Inicia el backend:

   ```bash
   npm start
   ```

   El servidor escuchará en `http://localhost:3000` (o el puerto indicado en `.env`).

4. (Opcional) Ejecuta el backend en segundo plano con `npx pm2 start src/index.js --name gestionthibe`.

## 5. Configurar el frontend

1. En una nueva terminal, sitúate en la raíz del repositorio y luego en `frontend`:

   ```bash
   cd frontend
   npm install
   cp .env.example .env
   ```

2. Edita `.env` y apunta la variable `VITE_API_BASE_URL` al backend. Ejemplo en la misma máquina:

   ```ini
   VITE_API_BASE_URL=http://localhost:3000/api
   ```

   Si el frontend servirá a clientes remotos, reemplaza `localhost` por la IP o dominio público del backend.

3. Construye y lanza el modo preview (simula un despliegue productivo con archivos estáticos):

   ```bash
   npm run build
   npm run preview -- --host 0.0.0.0 --port 4173
   ```

   - El sitio estará disponible en `http://<IP_DE_LA_MAQUINA>:4173`.
   - Si prefieres un entorno de desarrollo rápido, usa `npm run dev -- --host` (no recomendado para demos públicas).

## 6. Verificar el funcionamiento

1. Abre el navegador y navega a `http://<IP_DE_LA_MAQUINA>:4173`.
2. Inicia sesión con las credenciales del administrador definidas en el backend (`admin@example.com` / `ChangeMe123!`, salvo cambios).
3. Realiza acciones de prueba: crear un artículo, generar una solicitud de movimiento y revisar los reportes.

## 7. Resolución de problemas frecuentes

- **El backend no arranca**: revisa la cadena `MONGO_URI` y que MongoDB esté en ejecución (`docker ps` o `systemctl status mongod`).
- **Error de CORS**: confirma que `VITE_API_BASE_URL` usa la misma URL y puerto en la que está publicado el backend.
- **No puedo iniciar sesión**: verifica que el backend pudo ejecutar la inicialización de roles/usuarios en los logs al arrancar.
- **Quiero reiniciar la base para otra demo**: borra la base `gestionthibe` (`use gestionthibe; db.dropDatabase();`) o elimina el contenedor `docker rm -f gestionthibe-mongo` y créalo otra vez.

Con estos pasos tendrás la solución lista para presentar en otra máquina sin depender de tu entorno de desarrollo original.
