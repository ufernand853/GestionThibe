const express = require('express');
const Item = require('../models/Item');
const ShopifyCatalogModel = require('../models/ShopifyCatalogModel');
const { requirePermission } = require('../middlewares/auth');
const { HttpError } = require('../utils/errors');
const asyncHandler = require('../utils/asyncHandler');
const { recordAuditEvent } = require('../services/auditService');
const { getShopifyAuthStatus } = require('../services/shopifyAuthService');
const { normalizeCatalogInput, getCatalogAvailability } = require('../services/shopifyCatalogService');
const { syncCatalogDraft } = require('../services/shopifyCatalogDraftService');
const config = require('../config');

const router = express.Router();
const read = requirePermission('items.read');
const write = requirePermission('items.write');
const syncing = new Set();
const idPattern = /^[a-f\d]{24}$/i;
const itemFields = 'code sku description attributes images pDecimal deletedAt shopify.productId';

function isLinked(item) {
  const productId = item?.shopify?.productId;
  return Boolean(productId && !productId.startsWith('local-'));
}

function serializeItem(item) {
  return {
    id: String(item._id),
    code: item.code,
    sku: item.sku || item.code,
    description: item.description,
    attributes: item.attributes || {},
    images: item.images || [],
    price: item.pDecimal,
    linked: isLinked(item),
    deleted: Boolean(item.deletedAt)
  };
}

async function loadItems(variants) {
  const ids = [...new Set(variants.map(variant => String(variant.itemId)))];
  const items = await Item.find({ _id: { $in: ids } }).select(itemFields).lean();
  return new Map(items.map(item => [String(item._id), item]));
}

function validateItems(variants, items) {
  const skus = new Set();
  for (const variant of variants) {
    const item = items.get(String(variant.itemId));
    if (!item || item.deletedAt) throw new HttpError(409, 'Hay artículos eliminados o inexistentes en el modelo.');
    const sku = item.sku || item.code;
    if (isLinked(item)) {
      throw new HttpError(409, `El SKU ${sku} ya está vinculado a una ficha individual de Shopify.`);
    }
    if (skus.has(sku)) throw new HttpError(409, `El SKU ${sku} está repetido.`);
    skus.add(sku);
  }
}

function serializeModel(model, items) {
  const availability = getCatalogAvailability(model);
  return {
    id: String(model._id),
    code: model.code,
    title: model.title,
    revision: model.revision,
    productId: model.productId,
    syncedAt: model.syncedAt,
    syncError: model.syncError,
    pending: model.revision !== model.syncedRevision || Boolean(model.syncError),
    boxes: model.boxes,
    testOrders: model.testOrders || [],
    galleries: model.galleries,
    variants: model.variants.map(variant => ({
      ...variant,
      item: items.has(String(variant.itemId)) ? serializeItem(items.get(String(variant.itemId))) : null,
      available: availability.get(String(variant.itemId))
    }))
  };
}

async function findModel(id) {
  if (!idPattern.test(id)) throw new HttpError(400, 'Modelo inválido.');
  const model = await ShopifyCatalogModel.findById(id).lean();
  if (!model) throw new HttpError(404, 'No se encontró el modelo.');
  return model;
}

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
  res.json(items.map(serializeItem));
}));

router.get('/models', read, asyncHandler(async (req, res) => {
  const itemId = String(req.query.itemId || '');
  const filter = idPattern.test(itemId) ? { 'variants.itemId': itemId } : {};
  const models = await ShopifyCatalogModel.find(filter).sort({ title: 1 }).lean();
  const items = await loadItems(models.flatMap(model => model.variants));
  res.json(models.map(model => serializeModel(model, items)));
}));

async function saveModel(req, res) {
  const input = normalizeCatalogInput(req.body, config.shopify.publicBackendUrl);
  const items = await loadItems(input.variants);
  validateItems(input.variants, items);
  const updatedBy = req.user?.username || 'Desconocido';
  let saved;
  let before;
  try {
    if (req.params.id) {
      before = await findModel(req.params.id);
      if (!Number.isSafeInteger(req.body.revision) || req.body.revision !== before.revision) {
        throw new HttpError(409, 'El modelo cambió. Volvé a cargarlo antes de guardar.');
      }
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
  res.status(before ? 200 : 201).json(serializeModel(saved, items));
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
    const items = await loadItems(model.variants);
    validateItems(model.variants, items);
    const productId = await syncCatalogDraft(model, items);
    const saved = await ShopifyCatalogModel.findByIdAndUpdate(
      id,
      { $set: { productId, syncedRevision: model.revision, syncedAt: new Date(), syncError: null } },
      { new: true }
    ).lean();
    res.json(serializeModel(saved, await loadItems(saved.variants)));
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
    return res.json(serializeModel(model, await loadItems(model.variants)));
  }
  if (orders.length >= 200) throw new HttpError(409, 'El modelo alcanzó el máximo de pedidos de prueba.');
  const variant = model.variants.find(row => String(row.itemId) === itemId);
  const available = getCatalogAvailability(model).get(itemId) || 0;
  if (!variant || units > available) throw new HttpError(409, 'La variante no tiene suficientes unidades disponibles.');
  const items = await loadItems(model.variants);
  validateItems(model.variants, items);
  const item = items.get(itemId);
  const saved = await ShopifyCatalogModel.findOneAndUpdate(
    { _id: model._id, revision: model.revision },
    {
      $push: { testOrders: { key, itemId, units, sku: item.sku || item.code, color: variant.color, size: variant.size, status: 'reserved', createdAt: new Date() } },
      $inc: { revision: 1 }
    },
    { new: true }
  ).lean();
  if (!saved) throw new HttpError(409, 'El modelo cambió. Recargalo y volvé a intentar.');
  res.status(201).json(serializeModel(saved, items));
}));

router.post('/models/:id/test-orders/:key/resolve', write, asyncHandler(async (req, res) => {
  const model = await findModel(req.params.id);
  const { status, source } = req.body || {};
  if (!['cancelled', 'prepared'].includes(status)) throw new HttpError(400, 'Acción de pedido inválida.');
  const order = model.testOrders?.find(row => row.key === req.params.key);
  if (!order) throw new HttpError(404, 'No se encontró el pedido de prueba.');
  const items = await loadItems(model.variants);
  if (order.status === status) return res.json(serializeModel(model, items));
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
  res.json(serializeModel(saved, items));
}));

module.exports = router;
