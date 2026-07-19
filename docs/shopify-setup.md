# Configuración requerida para Shopify

Para que el ABM de Shopify deje de funcionar como preparación local y pueda conectarse contra una tienda real, necesitamos configurar una **app personalizada** en Shopify y guardar sus credenciales en el backend.

## 1. Datos que necesitamos

- **Dominio de la tienda**: por ejemplo `mi-tienda.myshopify.com`.
- **Client ID** y **Client Secret** de la app creada en Shopify Dev Dashboard, o un **Admin API access token** ya obtenido.
- **Versión de API** a usar. Recomendado: `2026-07` mientras sea la versión estable actual del proyecto.
- **Permisos/scopes Admin API** mínimos:
  - `read_products`
  - `write_products`
  - `read_inventory`
  - `write_inventory`
  - `read_locations`
- Definición funcional de publicación:
  - si los productos se crean como `draft` o `active` por defecto;
  - qué ubicación Shopify se toma como stock principal;
  - si el stock se envía en unidades, cajas o ambas;
  - si las imágenes locales deben subirse a Shopify o solo quedar como referencia interna. Para subirlas, el backend necesita `PUBLIC_BACKEND_URL` y que `/uploads/items` sea accesible públicamente.

## 2. Variables de entorno del backend

Agregar estas variables al `.env` del backend o al entorno del servidor:

```env
SHOPIFY_STORE=mi-tienda.myshopify.com
SHOPIFY_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SHOPIFY_CLIENT_SECRET=shpss_xxxxxxxxxxxxxxxxxxxxx
SHOPIFY_ADMIN_ACCESS_TOKEN=
SHOPIFY_API_VERSION=2026-07
SHOPIFY_DRY_RUN=true
SHOPIFY_DEFAULT_LOCATION_ID=
PUBLIC_BACKEND_URL=https://tu-dominio-o-ip
```

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `SHOPIFY_STORE` / `SHOPIFY_SHOP_DOMAIN` | Sí para conexión real | Dominio `*.myshopify.com` de la tienda. |
| `SHOPIFY_CLIENT_ID` | Sí si no hay token manual | ID de cliente que se ve en Shopify Dev Dashboard. |
| `SHOPIFY_CLIENT_SECRET` | Sí si no hay token manual | Secreto de cliente que se ve en Shopify Dev Dashboard. No debe ir al frontend. |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Alternativo | Token privado de Admin API si ya se obtuvo. No debe ir al frontend. |
| `SHOPIFY_API_VERSION` | No | Versión de Admin API. Por defecto: `2026-07`. |
| `SHOPIFY_DRY_RUN` | No | Si está en `true`, el sistema prepara payloads y registra estado local sin llamar a Shopify. |
| `SHOPIFY_DEFAULT_LOCATION_ID` | No | ID de ubicación Shopify para sincronizar inventario cuando se defina el mapeo. |
| `PUBLIC_BACKEND_URL` / `BACKEND_PUBLIC_URL` | Recomendado para imágenes | URL pública desde donde Shopify puede descargar imágenes guardadas en `uploads/items`. Debe apuntar al backend y ser accesible desde internet. |

> Seguridad: el secreto y cualquier token solo deben existir en el backend. Nunca deben exponerse en React, commits, capturas ni logs.

## 3. Pasos en Shopify Admin

1. Entrar a **Shopify Admin → Settings → Apps and sales channels → Develop apps**.
2. Crear o abrir una app personalizada.
3. En **Configuration**, habilitar los scopes Admin API listados arriba.
4. Instalar la app en la tienda.
5. Copiar el **Client ID** y el **Client Secret** del Dev Dashboard y cargarlos como `SHOPIFY_CLIENT_ID` y `SHOPIFY_CLIENT_SECRET`.
6. Si Shopify entrega un token manual, cargarlo como `SHOPIFY_ADMIN_ACCESS_TOKEN`; si no, el backend lo solicitará con `grant_type=client_credentials` contra `/admin/oauth/access_token`.
7. Reiniciar el backend.
8. Validar la conexión desde la pantalla Shopify del sistema.

## 4. Próximo paso técnico

Con esas credenciales, el backend ya puede obtener un token por `client_credentials` y luego reemplazar el modo `dry-run` por llamadas reales a GraphQL Admin API para:

- crear producto si no existe `shopify.productId`;
- actualizar producto si ya existe;
- archivar producto para la baja;
- actualizar variante/precio/SKU;
- enviar imágenes públicas del artículo como media del producto;
- mapear inventario por ubicación.
