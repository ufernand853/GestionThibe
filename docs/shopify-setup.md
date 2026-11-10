# Configuración requerida para Shopify

Para que el ABM de Shopify deje de funcionar como preparación local y pueda conectarse contra una tienda real, necesitamos configurar una **app personalizada** en Shopify y guardar sus credenciales en el backend.

## 1. Datos que necesitamos

- **Dominio de la tienda**: por ejemplo `mi-tienda.myshopify.com`.
- **Client ID** y **Client Secret** de la app creada en Shopify Dev Dashboard, o un **Admin API access token** ya obtenido.
- **Versión de API** a usar. Recomendado: `2026-07` mientras sea la versión estable actual del proyecto.
- **Permisos/scopes Admin API** mínimos:
  - `read_products`
  - `write_products`
  - `read_files`
  - `write_files`
  - `read_inventory`
  - `write_inventory`
  - `read_locations`
- Definición funcional de publicación:
  - si los productos se crean como `draft` o `active` por defecto;
  - qué ubicación Shopify se toma como stock principal;
  - qué locales o depósitos exponen sus unidades sueltas a Shopify;
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
SHOPIFY_INVENTORY_WEBHOOK_SYNC_ENABLED=true
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
| `SHOPIFY_INVENTORY_WEBHOOK_SYNC_ENABLED` | No | Habilita la aplicación automática de webhooks `inventory_levels/update` sobre el stock local. Por defecto queda en `true`; usar `false` solo si se quiere recibir webhooks sin modificar stock local. |
| `PUBLIC_BACKEND_URL` / `BACKEND_PUBLIC_URL` | Requerido para enviar imágenes locales | URL pública HTTPS desde donde Shopify puede descargar imágenes guardadas en `uploads/items`. Debe apuntar al backend y ser accesible desde internet. Las imágenes en formato `data:image/...` o servidas por `http://` quedan visibles en Thibe, pero no se envían a Shopify porque Shopify necesita una URL pública HTTPS estable. Si Shopify informa errores de procesamiento multimedia, validar que la app tenga `write_files`, que la URL abra desde internet sin login y que el archivo no sea demasiado pesado. |

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
- mapear inventario por ubicación y enviar la existencia disponible a Shopify cuando la ubicación local tenga `shopifyLocationId`.

## 5. Mapeo de ubicaciones y baja automática por ventas

Para que una venta o cualquier ajuste de inventario en Shopify impacte el stock local sin intervención del usuario, `SHOPIFY_INVENTORY_WEBHOOK_SYNC_ENABLED` queda habilitado por defecto en `true`. Si la variable se configura en `false`, el webhook responde correctamente pero no modifica stock local.

1. En el sistema, abrir **Ubicaciones** y cargar en cada depósito interno el **ID ubicación Shopify** correspondiente. Puede guardarse como número (`123456789`) o como GID (`gid://shopify/Location/123456789`).
2. Sincronizar los artículos desde la pantalla **Shopify**. La sincronización guarda el `InventoryItem` de la variante Shopify en cada artículo local.
3. En Shopify, crear un webhook Admin API para el topic `inventory_levels/update` apuntando a:

```text
https://TU_BACKEND_PUBLICO/api/shopify/webhooks/inventory-levels-update
```

El backend valida la firma `X-Shopify-Hmac-Sha256` con `SHOPIFY_CLIENT_SECRET`. Fuera de `dry-run`, el webhook busca el artículo por `inventory_item_id` y la ubicación por `location_id`. Actualiza las unidades sueltas con el `available` recibido y conserva las cajas cerradas. El envío hacia Shopify también publica únicamente unidades sueltas. Si una ubicación vinculada se queda sin unidades, se actualiza a cero en Shopify si el nivel ya estaba activo.

## 6. Categoría, talle, color y género

- El **grupo** del artículo se envía como tipo de producto (`productType`) en Shopify. Si no tiene grupo, se usa `General`.
- Al crear o actualizar explícitamente un producto, las categorías internas configuradas agregan además un tag de colección principal: `MUJER`, `HOMBRE`, `NIÑOS`, `CALZADO`, `BAZAR`, `ELECTRONICA` o `HOGAR`. Las categorías no configuradas (incluida `NOVEDADES`) no agregan ningún tag de colección.
- En Shopify, cada colección principal debe ser una **colección automática** cuya condición sea «tag del producto es igual a» su nombre. Esta integración no crea colecciones, no modifica la navegación y no ejecuta reclasificaciones masivas.
- El atributo interno `size` se envía como la opción Shopify **Talle**.
- El atributo interno `color` se envía como la opción Shopify **Color**.
- El atributo interno `gender` se envía como la opción Shopify **Género**.
- Los demás atributos siguen enviándose como etiquetas para facilitar búsquedas y colecciones automáticas.
- Todos estos atributos son opcionales: si un artículo no tiene Talle, Color o Género, esas opciones se omiten y el producto se sincroniza con la variante predeterminada, igual que antes.

Antes de sincronizar, completar Grupo, Talle, Color y Género al crear o editar el artículo. Para un producto vinculado de una sola variante, **Enviar a Shopify** puede agregar opciones faltantes o actualizar sus valores conservando su estado actual. **Guardar como borrador** solicita ese estado de forma explícita. Si el producto tiene varias variantes y el vínculo es ambiguo, el sistema pide revisar el mapeo.

Cada artículo/SKU local representa una ficha de producto en Shopify. Por lo tanto, Talle y Color tendrán un solo valor por ficha.

## 7. Imágenes del producto

Al reenviar un artículo, las fotos nuevas se agregan a la galería. Las fotos que ya están en Shopify se conservan. Si Shopify informa que una foto sigue en procesamiento, volvé a enviar el artículo para asociarla cuando esté lista. El sistema vuelve a usar el mismo archivo de Shopify en el reintento.


## Piloto de Catálogo online

En Shopify → Catálogo online, elegí el SKU principal. El código del modelo
se completa con ese SKU. Si el color o el talle trae valores separados por
/ o -, el piloto propone las combinaciones y genera sus códigos online.
Quitá las combinaciones que no existen. Las fotos se cargan por color y se
comparten entre los talles. Guardá o cerrá el modelo para elegir otro producto.

Los códigos generados pertenecen al catálogo online. Repartí las unidades
contadas del SKU principal entre sus variantes. Con unidades por caja
configuradas, el reparto total tiene como tope el stock en cajas del SKU.
En **Envío a Shopify**, desplegá el SKU principal para ver las variantes
antes de enviar el modelo como una ficha en borrador.

En Cajas, revisá las cantidades que GestionThibe ya registra por SKU y
ubicación y usá **Traer cajas** para incorporarlas al modelo. Si se conoce la
cantidad de unidades por caja y el SKU identifica una sola variante, el
piloto completa el saldo inicial. Si falta ese dato o el SKU tiene varios
colores o talles, confirmá el saldo con un conteo. Traer cajas copia los datos
del momento al piloto. Los ajustes posteriores del piloto se registran en
Catálogo online.

Para enviar una ficha de prueba, configurá las credenciales, la URL pública
si se usan fotos de GestionThibe, y `SHOPIFY_DEFAULT_LOCATION_ID`. El botón
**Enviar borrador a Shopify** sincroniza las variantes, sus fotos y el saldo
de las cajas, incluidos los ceros. Si Shopify sigue procesando una foto,
volvé a enviar el borrador cuando esté lista.

Desde **Pedidos online**, reservá la última unidad, revisá **Alertas de stock**
y cancelá para comprobar que vuelva a estar disponible. También se puede
simular la preparación desde una caja o registrar una sucursal de origen.
Los pedidos del piloto son simulados. Este flujo todavía no procesa pedidos
reales ni publica fichas activas.
