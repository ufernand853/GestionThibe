const { HttpError } = require('../utils/errors');

const MAX_VARIANTS = 50;
const MAX_BOXES = 100;
const MAX_PHOTOS = 50;
const normalizeLabel = value => value.normalize('NFC').trim().toLocaleLowerCase('es');

function invalid(message) {
  throw new HttpError(400, message);
}

function label(value, field, max = 100) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) {
    invalid(`Ingresá ${field} (máximo ${max} caracteres).`);
  }
  return value.trim().normalize('NFC');
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

function imageSource(value, publicBackendUrl) {
  const source = label(value, 'una URL de foto', 2048);
  const isUpload = /^\/?uploads\/items\/[^/?#]+$/i.test(source);
  let url;
  try {
    url = isUpload && publicBackendUrl
      ? new URL(source.replace(/^\/+/, ''), `${publicBackendUrl}/`)
      : new URL(source);
  } catch {
    invalid('Usá una URL HTTPS o una foto de GestionThibe con URL pública configurada.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) invalid('La foto debe usar una URL HTTPS pública.');
  url.hash = '';
  return url.href;
}

function normalizeCatalogInput(input, publicBackendUrl) {
  const code = label(input?.code, 'el código del modelo', 60).toUpperCase();
  const title = label(input?.title, 'el nombre del modelo', 150);
  const items = new Set();
  const combinations = new Set();
  const colors = new Map();
  const sizes = new Map();
  const variants = list(input.variants, 'variantes', MAX_VARIANTS, 1).map(row => {
    const id = itemId(row?.itemId);
    const color = label(row?.color, 'un color');
    const size = label(row?.size, 'un talle');
    const colorKey = normalizeLabel(color);
    const sizeKey = normalizeLabel(size);
    const combination = JSON.stringify([colorKey, sizeKey]);
    if (items.has(id)) invalid('Un mismo SKU solo puede aparecer en una variante.');
    if (combinations.has(combination)) invalid(`La combinación ${color} / ${size} está repetida.`);
    items.add(id);
    combinations.add(combination);
    if (!colors.has(colorKey)) colors.set(colorKey, color);
    if (!sizes.has(sizeKey)) sizes.set(sizeKey, size);
    return { itemId: id, color: colors.get(colorKey), size: sizes.get(sizeKey) };
  });

  const boxLabels = new Set();
  const boxes = list(input.boxes, 'cajas', MAX_BOXES).map(box => {
    const name = label(box?.label, 'el identificador de la caja');
    const key = normalizeLabel(name);
    if (boxLabels.has(key)) invalid(`La caja ${name} está repetida.`);
    boxLabels.add(key);
    const counted = new Set();
    const quantities = list(box.quantities, 'cantidades de la caja', MAX_VARIANTS).map(row => {
      const id = itemId(row?.itemId);
      if (!items.has(id) || counted.has(id)) invalid(`Revisá las variantes de la caja ${name}.`);
      if (!Number.isSafeInteger(row.units) || row.units < 0 || row.units > 10000) {
        invalid(`Ingresá cantidades enteras entre 0 y 10000 para la caja ${name}.`);
      }
      counted.add(id);
      return { itemId: id, units: row.units };
    });
    return { label: name, opened: box.opened === true, quantities: quantities.filter(row => row.units > 0) };
  });

  const galleryColors = new Set();
  let photoCount = 0;
  const galleries = list(input.galleries, 'galerías', MAX_VARIANTS).map(gallery => {
    const key = normalizeLabel(label(gallery?.color, 'el color de la galería'));
    if (!colors.has(key) || galleryColors.has(key)) invalid('Debe haber una sola galería por color del modelo.');
    galleryColors.add(key);
    const images = [...new Set(list(gallery.images, 'fotos', MAX_PHOTOS).map(source => imageSource(source, publicBackendUrl)))];
    photoCount += images.length;
    return { color: colors.get(key), images };
  });
  if (photoCount > MAX_PHOTOS) invalid(`El modelo admite hasta ${MAX_PHOTOS} fotos.`);
  return { code, title, variants, boxes, galleries };
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

module.exports = { MAX_VARIANTS, normalizeCatalogInput, getCatalogAvailability };
