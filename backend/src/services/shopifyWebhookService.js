const crypto = require('crypto');
const Item = require('../models/Item');
const Location = require('../models/Location');
const { recordAuditEvent } = require('./auditService');
const config = require('../config');

function shopifyGid(resource, id) {
  const value = String(id || '').trim();
  if (!value) return null;
  if (value.startsWith('gid://shopify/')) return value;
  return /^\d+$/.test(value) ? `gid://shopify/${resource}/${value}` : value;
}

function getIdCandidates(resource, value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const candidates = new Set([raw]);
  const numeric = raw.match(/\/(\d+)$/)?.[1] || (/^\d+$/.test(raw) ? raw : null);
  if (numeric) {
    candidates.add(numeric);
    candidates.add(`gid://shopify/${resource}/${numeric}`);
  }
  return Array.from(candidates);
}

function verifyShopifyWebhook(rawBody, hmacHeader) {
  const secret = config.shopify.clientSecret;
  if (!secret) return { ok: false, reason: 'Falta SHOPIFY_CLIENT_SECRET para validar webhooks.' };
  if (!hmacHeader) return { ok: false, reason: 'Falta X-Shopify-Hmac-Sha256.' };
  const digest = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const expected = Buffer.from(digest, 'utf8');
  const received = Buffer.from(String(hmacHeader), 'utf8');
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
    return { ok: false, reason: 'Firma HMAC inválida.' };
  }
  return { ok: true };
}

function parseWebhookBody(rawBody) {
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch (error) {
    return null;
  }
}

async function applyInventoryLevelUpdate(payload) {
  if (!config.shopify.inventoryWebhookSyncEnabled) {
    return {
      status: 'disabled',
      reason: 'La sincronización automática de stock desde webhooks Shopify está deshabilitada.'
    };
  }

  const inventoryItemCandidates = getIdCandidates('InventoryItem', payload.inventory_item_id || payload.inventoryItemId);
  const locationCandidates = getIdCandidates('Location', payload.location_id || payload.locationId);
  const available = Number(payload.available);
  if (!Number.isInteger(available) || available < 0) {
    return { status: 'ignored', reason: 'El webhook no incluye stock disponible válido.' };
  }
  if (inventoryItemCandidates.length === 0 || locationCandidates.length === 0) {
    return { status: 'ignored', reason: 'El webhook no incluye IDs de inventario y ubicación.' };
  }

  const [item, location] = await Promise.all([
    Item.findOne({ deletedAt: null, 'shopify.inventoryItemId': { $in: inventoryItemCandidates } }),
    Location.findOne({ shopifyLocationId: { $in: locationCandidates } })
  ]);

  if (!item || !location) {
    return {
      status: 'unmapped',
      reason: !item ? 'Inventario Shopify sin artículo mapeado.' : 'Ubicación Shopify sin ubicación mapeada.',
      inventoryItemId: shopifyGid('InventoryItem', payload.inventory_item_id || payload.inventoryItemId),
      locationId: shopifyGid('Location', payload.location_id || payload.locationId)
    };
  }

  if (!item.stock || !(item.stock instanceof Map)) {
    item.stock = new Map(Object.entries(item.stock || {}));
  }
  const locationId = location.id;
  if (available === 0) {
    item.stock.delete(locationId);
  } else {
    item.stock.set(locationId, { boxes: 0, units: available });
  }
  item.shopify.lastSyncedAt = new Date();
  item.shopify.lastAction = 'webhook-inventory-levels-update';
  item.shopify.lastError = null;
  item.markModified('stock');
  await item.save();

  await recordAuditEvent({
    action: 'Shopify',
    request: `Stock actualizado por webhook Shopify para ${item.code}`,
    user: 'Shopify webhook',
    details: { itemId: item.id, locationId, available, shopifyPayload: payload }
  });

  return { status: 'updated', itemId: item.id, locationId, available };
}

module.exports = { verifyShopifyWebhook, parseWebhookBody, applyInventoryLevelUpdate };
