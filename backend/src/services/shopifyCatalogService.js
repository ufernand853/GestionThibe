const { createHash } = require('node:crypto');
const { HttpError } = require('../utils/errors');
const { coerceQuantity } = require('../utils/quantity');

const MAX_VARIANTS = 50;
const MAX_BOXES = 100;
const MAX_BOX_UNITS = 1000000;
const MAX_PHOTOS = 50;
const normalizeLabel = value => value.normalize('NFC').trim().toLocaleLowerCase('es');
const splitColors = value => value.split(/[/\-–—]/).map(part => part.trim()).filter(Boolean);

function invalid(message) {
  throw new HttpError(400, message);
}

function label(value, field, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    invalid(`Ingresá ${field} (máximo ${max} caracteres).`);
  }
  return value.trim().normalize('NFC');
}

function optionalLabel(value, field) {
  return value == null || (typeof value === 'string' && !value.trim()) ? '' : label(value, field);
}

function list(value, field, max, min = 0) {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    invalid(`La lista de ${field} debe tener entre ${min} y ${max} entradas.`);
  }
  return value;
}

function itemId(value) {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) invalid('Seleccioná un artículo válido.');
  return value.toLowerCase();
}

function variantId(sourceItemId, color, size) {
  return createHash('sha256')
    .update(JSON.stringify([sourceItemId, normalizeLabel(color), normalizeLabel(size)]))
    .digest('hex').slice(0, 24);
}

function getVariantSku(row, item) {
  const base = item.sku || item.code;
  if (!row.sourceItemId) return base;
  const slug = value => value.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return [base, slug(row.color), slug(row.size), String(row.itemId).slice(-5).toUpperCase()].filter(Boolean).join('-');
}

function suggestOpening(item, overrides) {
  const sourceItemId = String(item._id);
  const color = optionalLabel(overrides?.color ?? item.attributes?.color, 'un color');
  const size = optionalLabel(overrides?.size ?? item.attributes?.size, 'un talle');
  const options = value => value ? [...new Map(splitColors(value).map(part => [normalizeLabel(part), part])).values()] : [''];
  const colors = options(color);
  const sizes = options(size);
  if (colors.length * sizes.length > MAX_VARIANTS) invalid('El artículo supera las 50 combinaciones del piloto.');
  const variants = colors.length > 1 || sizes.length > 1
    ? colors.flatMap(color => sizes.map(size => ({ itemId: variantId(sourceItemId, color, size), sourceItemId, color, size })))
    : [{ itemId: sourceItemId, color, size }];
  return variants.map(row => ({ ...row, sku: getVariantSku(row, item) }));
}

function validateSingleProduct(input, previous) {
  const principal = input.principalItemId;
  const previousPrincipal = previous?.principalItemId ? String(previous.principalItemId) : null;
  const previousSources = new Set((previous?.variants || []).map(row => String(row.sourceItemId || row.itemId)));
  if ((!previous && !principal) || (previousPrincipal && previousPrincipal !== principal) ||
      (previous && principal && !previousPrincipal && !previousSources.has(principal))) {
    invalid('Elegí un solo producto como SKU principal del modelo.');
  }
  if (input.variants.some(row => {
    const source = row.sourceItemId || row.itemId;
    return source !== principal && !previousSources.has(source);
  })) {
    invalid('El modelo solo puede incluir variantes del producto elegido.');
  }
}

function validateOpeningStock(model, items) {
  const sourceIds = new Map(model.variants.filter(row => row.sourceItemId).map(row => [String(row.itemId), String(row.sourceItemId)]));
  const totals = new Map();
  for (const box of model.boxes) {
    for (const quantity of box.quantities) {
      const sourceId = sourceIds.get(String(quantity.itemId));
      if (sourceId) totals.set(sourceId, (totals.get(sourceId) || 0) + quantity.units);
    }
  }
  for (const [sourceId, units] of totals) {
    const item = items.get(sourceId);
    const unitsPerBox = item.unitsPerBox;
    if (!Number.isSafeInteger(unitsPerBox) || unitsPerBox <= 0) continue;
    const available = getExistingBoxStock(item).reduce((total, row) => total + row.boxes * unitsPerBox, 0);
    if (units > available) {
      invalid(`El reparto del SKU ${item.sku || item.code} suma ${units} unidades y hay ${available} en las cajas registradas.`);
    }
  }
}

function imageSource(value) {
  const source = label(value, 'una foto', 2048);
  if (/^\/?uploads\/(?:items|shopify-catalog)\/[\w-]+\.[a-z0-9]+$/i.test(source)) {
    return source.replace(/^\/+/, '');
  }
  let url;
  try {
    url = new URL(source);
  } catch {
    invalid('Seleccioná una foto de GestionThibe o usá una URL HTTPS.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) invalid('La foto debe usar una URL HTTPS pública.');
  url.hash = '';
  return url.href;
}

function resolveCatalogPhotoUrl(value, publicBackendUrl) {
  const source = imageSource(value);
  if (source.startsWith('https:')) return source;
  if (!publicBackendUrl) invalid('Configurá la URL pública del servidor para enviar las fotos a Shopify.');
  return imageSource(new URL(source, publicBackendUrl + '/').href);
}

function getExistingBoxStock(item, locations = new Map()) {
  const unitsPerBox = Number.isSafeInteger(item.unitsPerBox) && item.unitsPerBox > 0 ? item.unitsPerBox : null;
  const stock = item.stock instanceof Map ? item.stock.entries() : Object.entries(item.stock || {});
  return [...stock].flatMap(([locationId, quantity]) => {
    const { boxes } = coerceQuantity(quantity);
    if (!boxes || !/^[a-f\d]{24}$/i.test(locationId)) return [];
    return [{ locationId, locationName: locations.get(locationId) || 'Ubicación ' + locationId, boxes, unitsPerBox }];
  });
}

function normalizeCatalogInput(input) {
  const code = label(input?.code, 'el código del modelo', 60).toUpperCase();
  const title = label(input?.title, 'el nombre del modelo', 150);
  const principalItemId = input.principalItemId == null ? null : itemId(input.principalItemId);
  const items = new Set();
  const combinations = new Set();
  const colors = new Map();
  const sizes = new Map();
  const variants = list(input.variants, 'variantes', MAX_VARIANTS, 1).map(row => {
    const id = itemId(row?.itemId);
    const color = optionalLabel(row?.color, 'un color');
    const size = optionalLabel(row?.size, 'un talle');
    const sourceItemId = row.sourceItemId == null ? null : itemId(row.sourceItemId);
    if (sourceItemId && (sourceItemId !== principalItemId || variantId(sourceItemId, color, size) !== id)) {
      invalid('La variante generada no corresponde al SKU principal.');
    }
    const colorKey = normalizeLabel(color);
    const sizeKey = normalizeLabel(size);
    const combination = JSON.stringify([colorKey, sizeKey]);
    if (items.has(id)) invalid('Un mismo SKU solo puede aparecer en una variante.');
    if (combinations.has(combination)) invalid(`La combinación ${color} / ${size} está repetida.`);
    items.add(id);
    combinations.add(combination);
    if (!colors.has(colorKey)) colors.set(colorKey, color);
    if (!sizes.has(sizeKey)) sizes.set(sizeKey, size);
    return { itemId: id, ...(sourceItemId ? { sourceItemId } : {}), color: colors.get(colorKey), size: sizes.get(sizeKey) };
  });
  if (colors.size > 1 && colors.has('')) invalid('Completá el color en todas las variantes o dejalo vacío en todas.');
  if (sizes.size > 1 && sizes.has('')) invalid('Completá el talle en todas las variantes o dejalo vacío en todas.');

  const sourcesByVariant = new Map(variants.map(row => [row.itemId, row.sourceItemId || row.itemId]));
  if (variants.some(row => row.sourceItemId) && items.has(principalItemId)) {
    invalid('El SKU principal ya está representado por sus variantes generadas.');
  }
  const stockSources = new Set(sourcesByVariant.values());
  const boxLabels = new Set();
  const boxSources = new Set();
  const boxes = list(input.boxes, 'cajas', MAX_BOXES).map(box => {
    const name = label(box?.label, 'el identificador de la caja');
    const key = normalizeLabel(name);
    if (boxLabels.has(key)) invalid(`La caja ${name} está repetida.`);
    boxLabels.add(key);
    const source = box.sourceKey;
    const sourceItemId = typeof source === 'string' ? source.split(':')[0] : null;
    if (source != null) {
      if (typeof source !== 'string' || !/^[a-f\d]{24}:[a-f\d]{24}$/.test(source) ||
          !stockSources.has(sourceItemId) || boxSources.has(source) ||
          !Number.isSafeInteger(box.sourceBoxes) || box.sourceBoxes < 1) {
        invalid('Revisá las cajas importadas para cada SKU y ubicación.');
      }
      boxSources.add(source);
    }
    const counted = new Set();
    const quantities = list(box.quantities, 'cantidades de la caja', MAX_VARIANTS).map(row => {
      const id = itemId(row?.itemId);
      if (!items.has(id) || counted.has(id) || (sourceItemId && sourcesByVariant.get(id) !== sourceItemId)) invalid(`Revisá las variantes de la caja ${name}.`);
      if (!Number.isSafeInteger(row.units) || row.units < 0 || row.units > MAX_BOX_UNITS) {
        invalid(`Ingresá cantidades enteras entre 0 y ${MAX_BOX_UNITS} para la caja ${name}.`);
      }
      counted.add(id);
      return { itemId: id, units: row.units };
    });
    return {
      label: name,
      opened: box.opened === true,
      ...(source ? { sourceKey: source, sourceBoxes: box.sourceBoxes } : {}),
      quantities: quantities.filter(row => row.units > 0)
    };
  });

  const availableColors = new Map(colors);
  for (const color of colors.values()) {
    for (const part of splitColors(color)) {
      if (!availableColors.has(normalizeLabel(part))) availableColors.set(normalizeLabel(part), part);
    }
  }
  const galleryColors = new Set();
  let photoCount = 0;
  const galleries = list(input.galleries, 'galerías', MAX_VARIANTS).map(gallery => {
    const key = normalizeLabel(optionalLabel(gallery?.color, 'el color de la galería'));
    if (!availableColors.has(key) || galleryColors.has(key)) invalid('Debe haber una sola galería por color del modelo.');
    galleryColors.add(key);
    const images = [...new Set(list(gallery.images, 'fotos', MAX_PHOTOS).map(imageSource))];
    photoCount += images.length;
    return { color: availableColors.get(key), images };
  });
  if (photoCount > MAX_PHOTOS) invalid(`El modelo admite hasta ${MAX_PHOTOS} fotos.`);
  return { code, title, ...(principalItemId ? { principalItemId } : {}), variants, boxes, galleries };
}

function getCatalogAvailability(model) {
  const totals = new Map(model.variants.map(row => [String(row.itemId), 0]));
  for (const box of model.boxes) {
    for (const { itemId, units } of box.quantities) {
      const id = String(itemId);
      if (totals.has(id)) totals.set(id, totals.get(id) + units);
    }
  }
  for (const order of model.testOrders || []) {
    const id = String(order.itemId);
    if (order.status === 'reserved' && totals.has(id)) totals.set(id, totals.get(id) - order.units);
  }
  return totals;
}

module.exports = { MAX_VARIANTS, normalizeCatalogInput, getCatalogAvailability, getExistingBoxStock, resolveCatalogPhotoUrl, normalizeLabel, splitColors, suggestOpening, getVariantSku, validateOpeningStock, validateSingleProduct };
