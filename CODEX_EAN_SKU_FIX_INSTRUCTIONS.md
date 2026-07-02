# Instrucciones para Codex: fix EAN-13 interno, SKU con ceros y prioridad de escaneo

## Contexto del problema

En el sistema hay códigos EAN-13 internos generados desde el SKU del artículo.

Ejemplo real:

- Artículo esperado en PDF/Impresión: `FS024`
- EAN mostrado/escaneado: `0400002700005`
- Resultado incorrecto en Escaneo de Productos: se agrega `MT1809`

La causa es una ambigüedad entre el formato actual y el formato legacy:

- En formato actual, `0400002700005` puede representar SKU `27` / `000027`.
- En formato legacy, el mismo EAN puede coincidir con SKU `270` / `000270`.

Por eso hay que hacer dos cambios:

1. Backend: al derivar SKUs desde un EAN-13 interno, probar variantes con y sin ceros a la izquierda.
2. Frontend: cuando un código coincida con formato actual y legacy, priorizar el formato actual.

---

## Archivos a modificar

Modificar estos dos archivos:

1. `backend/src/routes/stock.js`
2. `frontend/src/pages/items/BarcodeReceptionPage.jsx`

---

## Cambio 1: Backend

Archivo: `backend/src/routes/stock.js`

### 1.1 Agregar helper `buildSkuLookupVariants`

Buscar esta función:

```js
function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}
```

Agregar inmediatamente debajo:

```js
function buildSkuLookupVariants(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) {
    return [];
  }
  const trimmed = digits.replace(/^0+(?=\d)/, '');
  return uniqueValues([digits, trimmed]);
}
```

### 1.2 Usar el helper en `deriveSkusFromInternalEan13`

Dentro de `deriveSkusFromInternalEan13`, buscar el bloque de formato actual:

```js
// Formato actual: 04 + SKU de 6 dígitos + 0000 + verificador.
if (digits.slice(8, 12) === '0000') {
  skuCandidates.push(digits.slice(2, 8));
}
```

Reemplazarlo por:

```js
// Formato actual: 04 + SKU de 6 dígitos + 0000 + verificador.
if (digits.slice(8, 12) === '0000') {
  skuCandidates.push(...buildSkuLookupVariants(digits.slice(2, 8)));
}
```

Después buscar el bloque de formato legacy:

```js
// Formato legado: 04 + SKU llevado a 7 dígitos + 000 + verificador.
// Como el SKU guardado es de 6 dígitos, se toma el final del segmento.
if (digits.slice(9, 12) === '000') {
  skuCandidates.push(digits.slice(2, 9).slice(-6));
}
```

Reemplazarlo por:

```js
// Formato legado: 04 + SKU llevado a 7 dígitos + 000 + verificador.
// Como el SKU guardado es de 6 dígitos, se toma el final del segmento.
if (digits.slice(9, 12) === '000') {
  skuCandidates.push(...buildSkuLookupVariants(digits.slice(2, 9).slice(-6)));
}
```

### Resultado esperado del backend

Si el EAN interno deriva un SKU como `000027`, la búsqueda debe probar:

- `000027`
- `27`

Esto evita fallos cuando el SKU está guardado sin ceros a la izquierda.

---

## Cambio 2: Frontend

Archivo: `frontend/src/pages/items/BarcodeReceptionPage.jsx`

Buscar la función `getMatchScore` dentro de `findItemByBarcode`.

Ubicar este bloque:

```js
if (scannedValues.includes(code) || scannedValues.includes(sku)) return 4;
if (scannedValues.includes(legacyInternalBarcode)) return 3;
if (scannedValues.includes(currentInternalBarcode)) return 2;
if (returnedBarcodes.some(barcodeValue => scannedValues.includes(barcodeValue))) return 1;
return 0;
```

Reemplazarlo por:

```js
if (scannedValues.includes(code) || scannedValues.includes(sku)) return 4;
// El formato actual debe ganar sobre el legado: un mismo EAN puede
// representar SKU 27 en el formato actual y SKU 270 en el legacy.
if (scannedValues.includes(currentInternalBarcode)) return 3;
if (scannedValues.includes(legacyInternalBarcode)) return 2;
if (returnedBarcodes.some(barcodeValue => scannedValues.includes(barcodeValue))) return 1;
return 0;
```

### Resultado esperado del frontend

Cuando el EAN `0400002700005` coincida con:

- formato actual de SKU `27`, y
- formato legacy de SKU `270`,

el escáner debe elegir el artículo del formato actual.

En el caso reportado, debe agregar `FS024`, no `MT1809`.

---

## Pruebas a ejecutar

Desde el backend:

```bash
cd backend
npm test
```

Desde el frontend:

```bash
cd frontend
npm run build
```

Si el proyecto tiene lint configurado:

```bash
cd frontend
npm run lint
```

---

## Prueba manual recomendada

1. Levantar backend y frontend.
2. Entrar a `PDF e Impresión`.
3. Buscar el artículo `FS024`.
4. Confirmar que el EAN mostrado sea `0400002700005`.
5. Entrar a `Escaneo de Productos`.
6. Pegar o escanear `0400002700005`.
7. Confirmar que se agregue `FS024`.
8. Confirmar que no se agregue `MT1809`.

---

## Resumen corto del cambio

Corregir la resolución de SKU desde EAN-13 para que, cuando el código derive algo como `000027`, también pruebe `27`; además, en el escáner, priorizar el EAN interno actual por encima del legacy para evitar que un código como `0400002700005` resuelva al artículo equivocado.

---

## Mensaje sugerido de commit

```bash
git commit -m "Fix internal EAN SKU lookup and scanner priority"
```

---

## Título sugerido de PR

```text
Fix internal EAN SKU lookup and scanner priority
```

## Descripción sugerida de PR

```md
## Summary
- Add SKU lookup variants with and without leading zeros when deriving SKUs from internal EAN-13 codes.
- Prefer current internal EAN matches over legacy matches in barcode scanning.
- Prevent ambiguous EANs like `0400002700005` from resolving to the wrong item.

## Testing
- npm test
- npm run build
```
