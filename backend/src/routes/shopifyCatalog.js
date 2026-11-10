const express = require('express');
const path = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');
const { createHash } = require('node:crypto');
const Location = require('../models/Location');
const { sanitizeDataUrl, getDataUrlMeta } = require('../utils/imageDataUrl');
const Item = require('../models/Item');
const ShopifyCatalogModel = require('../models/ShopifyCatalogModel');
const { requirePermission } = require('../middlewares/auth');
const { HttpError } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');
const { recordAuditEvent } = require('../services/auditService');
const { getShopifyAuthStatus } = require('../services/shopifyAuthService');
const { normalizeCatalogInput, getCatalogAvailability, getExistingBoxStock, getVariantSku, suggestOpening, validateOpeningStock, validateSingleProduct } = require('../services/shopifyCatalogService');
const { syncCatalogDraft } = require('../services/shopifyCatalogDraftService');
const { getLinkedProductId } = require('../services/shopifyCatalogLinkService');

const router = express.Router();
const read = requirePermission('items.read');
const write = requirePermission('items.write');
const syncing = new Set();
const idPattern = /^[a-f\d]{24}$/i;
const itemFields = 'code sku description attributes images pDecimal unitsPerBox stock deletedAt shopify.productId';

function serializeItem(item, locations) {
  return {
    id: String(item._id),
    code: item.code,
    sku: item.sku || item.code,
    description: item.description,
    attributes: item.attributes || {},
    images: item.images || [],
    boxStock: getExistingBoxStock(item, locations),
    unitsPerBox: item.unitsPerBox ?? null,
    price: item.pDecimal,
    linked: Boolean(getLinkedProductId(item)),
    deleted: Boolean(item.deletedAt)
  };
}

async function loadItems(variants, principals = []) {
  const ids = [...new Set([...variants.map(variant => variant.sourceItemId || variant.itemId), ...principals].filter(Boolean).map(String))];
  const items = await Item.find({ _id: { $in: ids } }).select(itemFields).lean();
  return new Map(items.map(item => [String(item._id), item]));
}

function validateItems(variants, items, principalItemId) {
  const skus = new Set();
  for (const variant of variants) {
    const sourceId = String(variant.sourceItemId || variant.itemId);
    const item = items.get(sourceId);
    if (!item || item.deletedAt) throw new HttpError(409, 'Hay artículos eliminados o inexistentes en el modelo.');
    const sku = getVariantSku(variant, item);
    if (getLinkedProductId(item) && sourceId !== String(principalItemId)) {
      throw new HttpError(409, `El SKU ${sku} ya está vinculado a una ficha individual de Shopify.`);
    }
    if (skus.has(sku)) throw new HttpError(409, `El SKU ${sku} está repetido.`);
    skus.add(sku);
  }
}

function serializeModel(model, items, locations) {
  const availability = getCatalogAvailability(model);
  return {
    id: String(model._id),
    code: model.code,
    title: model.title,
    principal: items.has(String(model.principalItemId)) ? serializeItem(items.get(String(model.principalItemId)), locations) : null,
    revision: model.revision,
    productId: model.productId,
    syncedAt: model.syncedAt,
    syncError: model.syncError,
    pending: model.revision !== model.syncedRevision || Boolean(model.syncError),
    boxes: model.boxes,
    testOrders: model.testOrders || [],
    galleries: model.galleries,
    variants: model.variants.map(variant => {
      const item = items.get(String(variant.sourceItemId || variant.itemId));
      return {
        ...variant,
        item: item ? serializeItem(item, locations) : null,
        sku: item ? getVariantSku(variant, item) : null,
        available: availability.get(String(variant.itemId))
      };
    })
  };
}

async function findModel(id) {
  if (!idPattern.test(id)) throw new HttpError(400, 'Modelo inválido.');
  const model = await ShopifyCatalogModel.findById(id).lean();
  if (!model) throw new HttpError(404, 'No se encontró el modelo.');
  return model;
}

async function loadLocationNames(items) {
  const ids = new Set();
  for (const item of items) {
    for (const id of Object.keys(item.stock || {})) {
      if (idPattern.test(id)) ids.add(id);
    }
  }
  if (!ids.size) return new Map();
  const locations = await Location.find({ _id: { $in: [...ids] } }).select('name').lean();
  return new Map(locations.map(location => [String(location._id), location.name]));
}

async function sendModel(res, model, items, status = 200) {
  res.status(status).json(serializeModel(model, items, await loadLocationNames(items.values())));
}

router.post('/images', write, asyncHandler(async (req, res) => {
  const dataUrl = sanitizeDataUrl(req.body?.image);
  if (!dataUrl) throw new HttpError(400, 'Seleccioná una foto JPG, PNG, WebP o GIF de hasta 5 MB.');
  const meta = getDataUrlMeta(dataUrl);
  const content = Buffer.from(dataUrl.slice(meta.normalized.length), 'base64');
  if (!content.length) throw new HttpError(400, 'La foto está vacía.');
  const name = createHash('sha256').update(content).digest('hex') + '.' + meta.extension;
  const directory = path.join(__dirname, '..', '..', 'uploads', 'shopify-catalog');
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(path.join(directory, name), content, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  res.json({ path: 'uploads/shopify-catalog/' + name });
}));

router.get('/items', read, asyncHandler(async (req, res) => {
  const search = String(req.query.search || '').trim().slice(0, 100);
  const id = String(req.query.id || '');
  const filter = { deletedAt: null };
  if (idPattern.test(id)) {
    filter._id = id;
  } else if (search) {
    const matcher = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ code: matcher }, { sku: matcher }, { description: matcher }];
  } else {
    return res.json([]);
  }
  const items = await Item.find(filter).select(itemFields).sort({ code: 1 }).limit(20).lean();
  const locations = await loadLocationNames(items);
  res.json(items.map(item => serializeItem(item, locations)));
}));

router.get('/items/:id/opening', read, asyncHandler(async (req, res) => {
  if (!idPattern.test(req.params.id)) throw new HttpError(400, 'Artículo inválido.');
  const item = await Item.findOne({ _id: req.params.id, deletedAt: null }).select(itemFields).lean();
  if (!item) throw new HttpError(404, 'No se encontró el SKU principal.');
  const options = req.query.color == null && req.query.size == null ? undefined : req.query;
  res.json(suggestOpening(item, options));
}));

router.get('/models', read, asyncHandler(async (req, res) => {
  const itemId = String(req.query.itemId || '');
  const filter = idPattern.test(itemId) ? { $or: [{ 'variants.itemId': itemId }, { principalItemId: itemId }] } : {};
  const models = await ShopifyCatalogModel.find(filter).sort({ title: 1 }).lean();
  const items = await loadItems(models.flatMap(model => model.variants), models.map(model => model.principalItemId));
  const locations = await loadLocationNames(items.values());
  res.json(models.map(model => serializeModel(model, items, locations)));
}));

async function saveModel(req, res) {
  if (req.params.id && !idPattern.test(req.params.id)) throw new HttpError(400, 'Modelo inválido.');
  const input = normalizeCatalogInput(req.body);
  const before = req.params.id ? await findModel(req.params.id) : null;
  if (before && (!Number.isSafeInteger(req.body.revision) || req.body.revision !== before.revision)) {
    throw new HttpError(409, 'El modelo cambió. Volvé a cargarlo antes de guardar.');
  }
  validateSingleProduct(input, before);
  const items = await loadItems(input.variants, [input.principalItemId]);
  if (input.principalItemId) {
    const principal = items.get(String(input.principalItemId));
    if (!principal || principal.deletedAt) {
      throw new HttpError(409, 'El SKU principal ya no está disponible para este modelo.');
    }
    input.code = (principal.sku || principal.code).toUpperCase();
  }
  const claimedItemIds = [...items.keys()];
  const conflict = await ShopifyCatalogModel.exists({
    ...(req.params.id ? { _id: { $ne: req.params.id } } : {}),
    $or: [{ principalItemId: { $in: claimedItemIds } }, { 'variants.itemId': { $in: claimedItemIds } }]
  });
  if (conflict) throw new HttpError(409, 'Uno de los SKU ya pertenece a otro modelo online.');
  input.claimedItemIds = claimedItemIds;
  validateItems(input.variants, items, input.principalItemId);
  validateOpeningStock(input, items);
  const updatedBy = req.user?.username || 'Desconocido';
  let saved;
  try {
    if (before) {
      const available = getCatalogAvailability({ ...input, testOrders: before.testOrders });
      const reserved = before.testOrders?.filter(order => order.status === 'reserved') || [];
      if (reserved.some(order => (available.get(String(order.itemId)) ?? -1) < 0)) {
        throw new HttpError(409, 'Hay pedidos de prueba reservados. Conservá el stock que los respalda o cancelalos primero.');
      }
      saved = await ShopifyCatalogModel.findOneAndUpdate(
        { _id: before._id, revision: req.body.revision },
        { $set: { ...input, updatedBy }, $inc: { revision: 1 } },
        { new: true, runValidators: true }
      ).lean();
      if (!saved) throw new HttpError(409, 'El modelo cambió. Volvé a cargarlo antes de guardar.');
    } else {
      saved = (await ShopifyCatalogModel.create({ ...input, updatedBy })).toObject();
    }
  } catch (error) {
    if (error.code === 11000) throw new HttpError(409, 'El código de modelo o uno de sus SKU ya está en Catálogo online.');
    throw error;
  }

  await recordAuditEvent({
    action: 'Shopify',
    request: `Catálogo online: ${saved.code}`,
    user: updatedBy,
    details: { modelId: saved._id, revision: saved.revision, previousBoxes: before?.boxes || [], boxes: saved.boxes }
  });
  await sendModel(res, saved, items, before ? 200 : 201);
}

router.post('/models', write, asyncHandler(saveModel));
router.put('/models/:id', write, asyncHandler(saveModel));

router.post('/models/:id/sync-draft', write, asyncHandler(async (req, res) => {
  const settings = getShopifyAuthStatus();
  if (settings.dryRun || !settings.configured) {
    throw new HttpError(409, 'Para enviar el borrador, configurá Shopify y desactivá el modo de simulación.');
  }
  const model = await findModel(req.params.id);
  const id = String(model._id);
  if (syncing.has(id)) throw new HttpError(409, 'Este modelo ya se está sincronizando.');
  syncing.add(id);
  try {
    const items = await loadItems(model.variants, [model.principalItemId]);
    validateItems(model.variants, items, model.principalItemId);
    validateOpeningStock(model, items);
    const productId = await syncCatalogDraft(model, items, undefined, {
      async beforeAdopt(adoptedProductId) {
        try {
          const claimed = await ShopifyCatalogModel.findOneAndUpdate(
            { _id: id, revision: model.revision, productId: null },
            { $set: { productId: adoptedProductId, adoptedProductId } }
          );
          if (!claimed) throw new HttpError(409, 'El modelo cambió. Volvé a cargarlo antes de enviar el borrador.');
        } catch (error) {
          if (error.code === 11000) throw new HttpError(409, 'Esa ficha Shopify ya está asignada a otro modelo.');
          throw error;
        }
      }
    });
    const saved = await ShopifyCatalogModel.findByIdAndUpdate(
      id,
      { $set: { productId, syncedRevision: model.revision, syncedAt: new Date(), syncError: null } },
      { new: true }
    ).lean();
    await sendModel(res, saved, await loadItems(saved.variants, [saved.principalItemId]));
  } catch (error) {
    await ShopifyCatalogModel.findByIdAndUpdate(id, { $set: { syncError: error.message.slice(0, 500) } });
    throw error;
  } finally {
    syncing.delete(id);
  }
}));

router.post('/models/:id/test-orders', write, asyncHandler(async (req, res) => {
  const model = await findModel(req.params.id);
  const { itemId, units, key } = req.body || {};
  if (typeof key !== 'string' || !/^[a-f\d-]{36}$/i.test(key) || !Number.isSafeInteger(units) || units < 1) {
    throw new HttpError(400, 'Ingresá una cantidad válida para el pedido de prueba.');
  }
  const orders = model.testOrders || [];
  if (orders.some(order => order.key === key)) {
    return sendModel(res, model, await loadItems(model.variants, [model.principalItemId]));
  }
  if (orders.length >= 200) throw new HttpError(409, 'El modelo alcanzó el máximo de pedidos de prueba.');
  const variant = model.variants.find(row => String(row.itemId) === itemId);
  const available = getCatalogAvailability(model).get(itemId) || 0;
  if (!variant || units > available) throw new HttpError(409, 'La variante no tiene suficientes unidades disponibles.');
  const items = await loadItems(model.variants, [model.principalItemId]);
  validateItems(model.variants, items, model.principalItemId);
  const item = items.get(String(variant.sourceItemId || itemId));
  const saved = await ShopifyCatalogModel.findOneAndUpdate(
    { _id: model._id, revision: model.revision },
    {
      $push: { testOrders: { key, itemId, units, sku: getVariantSku(variant, item), color: variant.color, size: variant.size, status: 'reserved', createdAt: new Date() } },
      $inc: { revision: 1 }
    },
    { new: true }
  ).lean();
  if (!saved) throw new HttpError(409, 'El modelo cambió. Recargalo y volvé a intentar.');
  await sendModel(res, saved, items, 201);
}));

router.post('/models/:id/test-orders/:key/resolve', write, asyncHandler(async (req, res) => {
  const model = await findModel(req.params.id);
  const { status, source } = req.body || {};
  if (!['cancelled', 'prepared'].includes(status)) throw new HttpError(400, 'Acción de pedido inválida.');
  const order = model.testOrders?.find(row => row.key === req.params.key);
  if (!order) throw new HttpError(404, 'No se encontró el pedido de prueba.');
  const items = await loadItems(model.variants, [model.principalItemId]);
  if (order.status === status) return sendModel(res, model, items);
  if (order.status !== 'reserved') throw new HttpError(409, 'El pedido de prueba ya se resolvió.');

  let boxes = model.boxes;
  let sourceLabel = null;
  if (status === 'prepared') {
    if (source === 'office' || source === 'branch') {
      sourceLabel = source === 'office' ? 'Sucursal de la oficina' : 'Otra sucursal';
    } else if (typeof source === 'string' && source.startsWith('box:')) {
      const box = boxes.find(row => row.label === source.slice(4));
      const quantity = box?.quantities.find(row => String(row.itemId) === String(order.itemId));
      if (!quantity || quantity.units < order.units) throw new HttpError(409, 'Esa caja no tiene suficientes unidades.');
      boxes = boxes.map(row => row === box ? {
        ...row,
        opened: true,
        quantities: row.quantities.map(entry => entry === quantity ? { ...entry, units: entry.units - order.units } : entry)
      } : row);
      sourceLabel = 'Caja ' + box.label;
    } else {
      throw new HttpError(400, 'Seleccioná de dónde salió la mercadería de prueba.');
    }
  }

  const saved = await ShopifyCatalogModel.findOneAndUpdate(
    { _id: model._id, revision: model.revision, 'testOrders.key': order.key },
    { $set: { 'testOrders.$.status': status, 'testOrders.$.source': sourceLabel, boxes }, $inc: { revision: 1 } },
    { new: true }
  ).lean();
  if (!saved) throw new HttpError(409, 'El modelo cambió. Recargalo y volvé a intentar.');
  await sendModel(res, saved, items);
}));

module.exports = router;
