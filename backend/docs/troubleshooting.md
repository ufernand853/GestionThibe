# Solución de errores comunes

## ReferenceError: `uploadMiddleware` is not defined

Este error aparece cuando Node intenta cargar `src/routes/items.js` y encuentra
una referencia a `uploadMiddleware`, pero dicha constante ya no existe en el
archivo. La traza típica es:

```
ReferenceError: uploadMiddleware is not defined
    at Object.<anonymous> (...\backend\src\routes\items.js:251:3)
```

En versiones anteriores el proyecto usaba **multer** y exponía ese middleware
para manejar cargas de archivos. Desde la migración a imágenes codificadas como
_base64_ ya no se usa multer y las rutas de artículos procesan las imágenes con
el nuevo flujo definido en `processIncomingImages`. El módulo exporta
únicamente el enrutador de Express:

```js
module.exports = router;
```

Si en tu entorno local todavía ves `uploadMiddleware` es porque estás ejecutando
una copia antigua de `items.js`. Actualiza el archivo con la versión más reciente
(o vuelve a clonar el repositorio) y reinicia el servidor.
