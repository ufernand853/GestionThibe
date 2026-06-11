const path = require('path');
const fs = require('fs');
const Item = require('../models/Item');
const { recordAuditEvent } = require('./auditService');

const { promises: fsPromises } = fs;
const projectRoot = path.join(__dirname, '..', '..');

function sanitizeItemImagePath(value) {
  if (typeof value !== 'string') return null;
  const normalized = path.posix.normalize(value.trim().replace(/^\/+/, ''));
  return normalized.startsWith('uploads/items/') ? normalized : null;
}

async function removeImage(relativePath) {
  const safePath = sanitizeItemImagePath(relativePath);
  if (!safePath) return;
  try {
    await fsPromises.unlink(path.join(projectRoot, safePath));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('No se pudo purgar una imagen de la papelera', { path: safePath, error });
    }
  }
}

async function permanentlyDeleteItem(item, { user = 'Sistema', automatic = false } = {}) {
  const images = Array.isArray(item.images) ? item.images : [];
  await Promise.allSettled(images.map(removeImage));
  const summary = `${automatic ? 'Eliminación automática' : 'Eliminación definitiva'} de artículo: ${item.code} - ${item.description}`;
  await item.deleteOne();
  await recordAuditEvent({
    action: 'Artículo',
    request: summary,
    user,
    details: { summary, itemId: String(item._id), code: item.code, automatic }
  });
}

async function purgeExpiredItems() {
  const expired = await Item.find({
    deletedAt: { $ne: null },
    scheduledDeletionAt: { $ne: null, $lte: new Date() }
  });
  for (const item of expired) {
    await permanentlyDeleteItem(item, { automatic: true });
  }
  return expired.length;
}

module.exports = { permanentlyDeleteItem, purgeExpiredItems };
