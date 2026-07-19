const express = require('express');
const { Types } = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const { HttpError } = require('../utils/errors');
const { requirePermission } = require('../middlewares/auth');
const Item = require('../models/Item');
const Location = require('../models/Location');
const { recordAuditEvent } = require('../services/auditService');
const { getShopifyAuthStatus, getAdminAccessToken } = require('../services/shopifyAuthService');
const { syncShopifyProduct, archiveShopifyProduct } = require('../services/shopifyProductService');

const router = express.Router();
const MAX_BULK_ITEMS = 100;

function escapeRegex(value) {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function getShopifyStatus(item) {
  const status = item.shopify?.status;
  if (['draft', 'active', 'archived', 'deleted'].includes(status)) {
    return status;
  }
  return item.shopify?.productId ? 'active' : 'draft';
}

function sumStock(stock) {
  const total = { boxes: 0, units: 0 };
  const entries = stock instanceof Map ? Array.from(stock.values()) : Object.values(stock || {});
  entries.forEach(quantity => {
    total.boxes += Number(quantity?.boxes) || 0;
    total.units += Number(quantity?.units) || 0;
  });
  return total;
}

function plainAttributes(attributes) {
  if (!attributes) return {};
  if (attributes instanceof Map) return Object.fromEntries(attributes.entries());
  return attributes;
}

function buildShopifyPayload(item, locations = []) {
  const locationNames = new Map(locations.map(location => [String(location.id), location.name]));
  const stockByLocation = [];
  const entries = item.stock instanceof Map ? Array.from(item.stock.entries()) : Object.entries(item.stock || {});
  entries.forEach(([locationId, quantity]) => {
    const boxes = Number(quantity?.boxes) || 0;
    const units = Number(quantity?.units) || 0;
    if (boxes <= 0 && units <= 0) return;
    stockByLocation.push({
      locationId,
      locationName: locationNames.get(String(locationId)) || 'Ubicación',
      boxes,
      units
    });
  });

  return {
    title: item.description,
    sku: item.sku || item.code,
    vendor: 'GestionThibe',
    productType: item.group?.name || 'General',
    status: getShopifyStatus(item),
    price: item.pDecimal ?? null,
    tags: Object.values(plainAttributes(item.attributes)).filter(Boolean),
    inventory: sumStock(item.stock),
    stockByLocation,
    images: Array.isArray(item.images) ? item.images : []
  };
}

function setShopifyFields(item, fields) {
  Object.entries(fields).forEach(([key, value]) => {
    item.set(`shopify.${key}`, value);
  });
}

function getPersistedShopifyProductId(item) {
  const productId = item.shopify?.productId;
  if (typeof productId === 'string' && productId.startsWith('gid://shopify/Product/')) {
    return productId;
  }
  return null;
}

function serializeShopifyItem(item, locations = []) {
  return {
    id: item.id,
    code: item.code,
    sku: item.sku || null,
    description: item.description,
    group: item.group ? { id: item.group.id, name: item.group.name } : null,
    precio: item.pDecimal ?? null,
    shopify: {
      productId: item.shopify?.productId || null,
      variantId: item.shopify?.variantId || null,
      handle: item.shopify?.handle || null,
      status: getShopifyStatus(item),
      lastSyncedAt: item.shopify?.lastSyncedAt || null,
      lastAction: item.shopify?.lastAction || null,
      lastError: item.shopify?.lastError || null
    },
    payload: buildShopifyPayload(item, locations)
  };
}

function getRequestBody(body) {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    return body;
  }
  if (typeof body === 'string' && body.trim()) {
    try {
      const parsed = JSON.parse(body);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
      throw new HttpError(400, 'El formato del payload Shopify es inválido.');
    }
  }
  return {};
}

async function loadItemsByIds(ids) {
  const normalizedIds = [...new Set((ids || []).map(id => String(id || '').trim()).filter(Boolean))];
  if (normalizedIds.length === 0) {
    throw new HttpError(400, 'Seleccioná al menos un artículo.');
  }
  if (normalizedIds.length > MAX_BULK_ITEMS) {
    throw new HttpError(400, `Solo se pueden procesar hasta ${MAX_BULK_ITEMS} artículos por operación.`);
  }
  if (!normalizedIds.every(Types.ObjectId.isValid)) {
    throw new HttpError(400, 'La selección contiene artículos inválidos.');
  }
  const items = await Item.find({ _id: { $in: normalizedIds }, deletedAt: null }).populate('group');
  if (items.length !== normalizedIds.length) {
    throw new HttpError(404, 'No se encontraron todos los artículos seleccionados.');
  }
  return items;
}

router.get(
  '/config',
  requirePermission('items.read'),
  asyncHandler(async (req, res) => {
    res.json(getShopifyAuthStatus());
  })
);

router.get(
  '/products',
  requirePermission('items.read'),
  asyncHandler(async (req, res) => {
    const { page = '1', pageSize = '20', search, status } = req.query || {};
    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 100);
    const filter = { deletedAt: null };
    if (typeof search === 'string' && search.trim()) {
      const matcher = new RegExp(escapeRegex(search.trim()), 'i');
      filter.$or = [{ code: matcher }, { sku: matcher }, { description: matcher }];
    }
    if (typeof status === 'string' && status.trim()) {
      const normalizedStatus = status.trim();
      if (normalizedStatus === 'draft') {
        filter.$and = [
          ...(filter.$and || []),
          { $or: [{ 'shopify.status': 'draft' }, { 'shopify.status': { $exists: false } }, { 'shopify.status': null }] }
        ];
      } else {
        filter['shopify.status'] = normalizedStatus;
      }
    }
    const [total, items, locations] = await Promise.all([
      Item.countDocuments(filter),
      Item.find(filter).populate('group').sort({ updatedAt: -1 }).skip((pageNumber - 1) * limit).limit(limit),
      Location.find().sort({ name: 1 })
    ]);
    res.json({
      config: getShopifyAuthStatus(),
      total,
      page: pageNumber,
      pageSize: limit,
      items: items.map(item => serializeShopifyItem(item, locations))
    });
  })
);

router.post(
  '/products/sync',
  requirePermission('items.write'),
  asyncHandler(async (req, res) => {
    const payload = getRequestBody(req.body);
    const items = await loadItemsByIds(payload.itemIds);
    const shopifyConfig = getShopifyAuthStatus();
    if (!shopifyConfig.dryRun && shopifyConfig.configured) {
      await getAdminAccessToken();
    }
    const now = new Date();
    const results = [];
    const locations = await Location.find().sort({ name: 1 });
    for (const item of items) {
      const nextStatus = payload.status === 'draft' ? 'draft' : 'active';
      const productPayload = buildShopifyPayload(item, locations);
      const syncedProduct = shopifyConfig.configured
        ? await syncShopifyProduct({ existingProductId: getPersistedShopifyProductId(item), payload: productPayload, status: nextStatus })
        : {
            productId: item.shopify?.productId || `local-${item.id}`,
            variantId: item.shopify?.variantId || `variant-${item.id}`,
            handle: item.description.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || item.code,
            status: nextStatus
          };
      setShopifyFields(item, {
        productId: syncedProduct.productId,
        variantId: syncedProduct.variantId,
        handle: syncedProduct.handle,
        status: syncedProduct.status,
        lastSyncedAt: now,
        lastAction: shopifyConfig.configured ? 'sync' : 'dry-run',
        lastError: null
      });
      await item.save();
      results.push({
        itemId: item.id,
        code: item.code,
        status: shopifyConfig.configured ? 'synced' : 'dry-run',
        productId: syncedProduct.productId,
        handle: syncedProduct.handle
      });
    }
    await recordAuditEvent({
      action: 'Shopify',
      request: `Sincronización Shopify de ${items.length} artículo(s)`,
      user: req.user?.username || 'Desconocido',
      details: { shopifyConfig, itemIds: items.map(item => item.id), results }
    });
    res.json({ config: shopifyConfig, processed: results.length, results });
  })
);

router.post(
  '/products/archive',
  requirePermission('items.write'),
  asyncHandler(async (req, res) => {
    const payload = getRequestBody(req.body);
    const items = await loadItemsByIds(payload.itemIds);
    const shopifyConfig = getShopifyAuthStatus();
    if (!shopifyConfig.dryRun && shopifyConfig.configured) {
      await getAdminAccessToken();
    }
    const now = new Date();
    const results = [];
    const locations = await Location.find().sort({ name: 1 });
    for (const item of items) {
      const persistedProductId = getPersistedShopifyProductId(item);
      const archivedProduct = shopifyConfig.configured && persistedProductId
        ? await archiveShopifyProduct(persistedProductId, buildShopifyPayload(item, locations))
        : null;
      setShopifyFields(item, {
        status: archivedProduct?.status || 'archived',
        lastSyncedAt: now,
        lastAction: shopifyConfig.configured ? 'archive' : 'dry-run-archive',
        lastError: null
      });
      await item.save();
      results.push({ itemId: item.id, code: item.code, status: archivedProduct?.status || 'archived' });
    }
    await recordAuditEvent({
      action: 'Shopify',
      request: `Baja Shopify de ${items.length} artículo(s)`,
      user: req.user?.username || 'Desconocido',
      details: { shopifyConfig, itemIds: items.map(item => item.id), results }
    });
    res.json({ config: shopifyConfig, processed: results.length, results });
  })
);

module.exports = router;
