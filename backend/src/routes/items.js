const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Types } = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const { HttpError } = require('../utils/errors');
const { requirePermission } = require('../middlewares/auth');
const Item = require('../models/Item');
const Group = require('../models/Group');
const { normalizeQuantityInput } = require('../services/stockService');

const { promises: fsPromises } = fs;

const MAX_IMAGES = 5;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const projectRoot = path.join(__dirname, '..', '..');
const uploadsRoot = path.join(projectRoot, 'uploads');
const itemUploadsDir = path.join(uploadsRoot, 'items');
fs.mkdirSync(itemUploadsDir, { recursive: true });

const ALLOWED_DATA_URL_PREFIXES = [
  { match: 'data:image/jpeg;base64,', normalized: 'data:image/jpeg;base64,', mimeType: 'image/jpeg', extension: 'jpg' },
  { match: 'data:image/jpg;base64,', normalized: 'data:image/jpeg;base64,', mimeType: 'image/jpeg', extension: 'jpg' },
  { match: 'data:image/png;base64,', normalized: 'data:image/png;base64,', mimeType: 'image/png', extension: 'png' },
  { match: 'data:image/webp;base64,', normalized: 'data:image/webp;base64,', mimeType: 'image/webp', extension: 'webp' },
  { match: 'data:image/gif;base64,', normalized: 'data:image/gif;base64,', mimeType: 'image/gif', extension: 'gif' }
];

function sanitizeImagePath(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim().replace(/^\/+/, '');
  if (!trimmed) {
    return null;
  }
  const normalized = path.posix.normalize(trimmed);
  if (!normalized.startsWith('uploads/items/')) {
    return null;
  }
  return normalized;
}

function sanitizeDataUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  const prefixEntry = ALLOWED_DATA_URL_PREFIXES.find(entry => lower.startsWith(entry.match));
  if (!prefixEntry) {
    return null;
  }
  const base64Part = trimmed.slice(prefixEntry.match.length).replace(/\s+/g, '');
  if (!base64Part) {
    return null;
  }
  if (!/^[0-9a-z+/]+=*$/i.test(base64Part)) {
    return null;
  }
  const paddingMatch = base64Part.match(/=+$/);
  const padding = paddingMatch ? paddingMatch[0].length : 0;
  if (padding > 2) {
    return null;
  }
  const sizeInBytes = Math.floor((base64Part.length * 3) / 4) - padding;
  if (sizeInBytes > MAX_FILE_SIZE) {
    return null;
  }
  return `${prefixEntry.normalized}${base64Part}`;
}

function getDataUrlMeta(dataUrl) {
  return ALLOWED_DATA_URL_PREFIXES.find(entry => dataUrl.startsWith(entry.normalized)) || null;
}

async function persistDataUrl(dataUrl) {
  const meta = getDataUrlMeta(dataUrl);
  if (!meta) {
    throw new HttpError(400, 'Formato de imagen no soportado.');
  }
  const base64Part = dataUrl.slice(meta.normalized.length);
  const buffer = Buffer.from(base64Part, 'base64');
  const fileName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${meta.extension}`;
  const absolutePath = path.join(itemUploadsDir, fileName);
  try {
    await fsPromises.writeFile(absolutePath, buffer);
  } catch (error) {
    throw new HttpError(500, 'No se pudo guardar la imagen en el servidor.');
  }
  return `uploads/items/${fileName}`;
}

async function cleanupNewFiles(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return;
  }
  await Promise.allSettled(paths.map(removeFileSafe));
}

async function processIncomingImages(values, existingSet = null) {
  if (!Array.isArray(values)) {
    return { paths: [], newPaths: [] };
  }
  const seen = new Set();
  const paths = [];
  const newPaths = [];
  try {
    for (const value of values) {
      const sanitizedDataUrl = sanitizeDataUrl(value);
      if (sanitizedDataUrl) {
        if (seen.has(sanitizedDataUrl)) {
          continue;
        }
        seen.add(sanitizedDataUrl);
        const storedPath = await persistDataUrl(sanitizedDataUrl);
        if (storedPath) {
          paths.push(storedPath);
          newPaths.push(storedPath);
        }
        continue;
      }
      const sanitizedPath = sanitizeImagePath(value);
      if (!sanitizedPath) {
        continue;
      }
      if (existingSet && !existingSet.has(sanitizedPath)) {
        continue;
      }
      if (seen.has(sanitizedPath)) {
        continue;
      }
      seen.add(sanitizedPath);
      paths.push(sanitizedPath);
    }
    return { paths, newPaths };
  } catch (error) {
    await cleanupNewFiles(newPaths);
    throw error;
  }
}

async function removeFileSafe(relativePath) {
  const sanitizedPath = sanitizeImagePath(relativePath);
  if (!sanitizedPath) {
    return;
  }
  const absolutePath = path.join(projectRoot, sanitizedPath);
  try {
    await fsPromises.unlink(absolutePath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('No se pudo eliminar la imagen asociada al artículo', {
        path: absolutePath,
        error
      });
    }
  }
}

function parseItemPayload(req) {
  if (req.body && typeof req.body.payload === 'string') {
    try {
      return JSON.parse(req.body.payload);
    } catch (error) {
      throw new HttpError(400, 'El formato del payload es inválido.');
    }
  }
  return req.body || {};
}

function normalizeBooleanFlag(value, { fieldName = 'Flag', defaultValue } = {}) {
  if (value === undefined) {
    return defaultValue;
  }
  if (value === null) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return defaultValue;
    }
    const normalized = trimmed.toLowerCase();
    if (['true', '1', 'yes', 'y', 'si', 'sí', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
      return false;
    }
  }
  throw new HttpError(400, `${fieldName} inválido`);
}

function toPlainAttributes(attributes) {
  if (!attributes) return {};
  if (attributes instanceof Map) {
    return Object.fromEntries(attributes.entries());
  }
  return attributes;
}

function serializeItem(doc) {
  const group = doc.group;
  return {
    id: doc.id,
    code: doc.code,
    description: doc.description,
    groupId: group ? group.id : doc.group,
    group: group ? { id: group.id, name: group.name } : null,
    attributes: toPlainAttributes(doc.attributes),
    stock: toPlainStock(doc.stock),
    images: Array.isArray(doc.images) ? doc.images : [],
    needsRecount: Boolean(doc.needsRecount),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

function toPlainStock(stock) {
  const plain = {};
  if (stock instanceof Map) {
    for (const [key, value] of stock.entries()) {
      if (value === null || value === undefined) {
        continue;
      }
      plain[key] = normalizeQuantityInput(value, { allowZero: true, fieldName: `Stock ${key}` });
    }
  } else if (stock && typeof stock === 'object') {
    Object.entries(stock).forEach(([key, value]) => {
      if (value === null || value === undefined) {
        return;
      }
      plain[key] = normalizeQuantityInput(value, { allowZero: true, fieldName: `Stock ${key}` });
    });
  }
  return plain;
}

function buildStock(input = {}) {
  const stock = {};
  if (!input || typeof input !== 'object') {
    return stock;
  }
  Object.entries(input).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') {
      stock[key] = null;
    } else {
      stock[key] = normalizeQuantityInput(value, { allowZero: true, fieldName: `Stock ${key}` });
    }
  });
  return stock;
}

function normalizeOptionalObjectId(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    return trimmed;
  }
  return value;
}

const router = express.Router();

router.get(
  '/',
  requirePermission('items.read'),
  asyncHandler(async (req, res) => {
    const { page = '1', pageSize = '20', groupId, search, gender, size, color } = req.query || {};
    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(pageSize, 10) || 20, 1), 200);
    const filter = {};
    if (groupId) {
      filter.group = groupId;
    }
    const attributeFilters = {};
    if (gender) attributeFilters['attributes.gender'] = gender;
    if (size) attributeFilters['attributes.size'] = size;
    if (color) attributeFilters['attributes.color'] = color;
    Object.assign(filter, attributeFilters);
    if (search) {
      const regex = new RegExp(search, 'i');
      filter.$or = [{ code: regex }, { description: regex }];
    }
    const [total, items] = await Promise.all([
      Item.countDocuments(filter),
      Item.find(filter)
        .populate('group')
        .sort({ updatedAt: -1 })
        .skip((pageNumber - 1) * limit)
        .limit(limit)
    ]);
    res.json({
      total,
      page: pageNumber,
      pageSize: limit,
      items: items.map(serializeItem)
    });
  })
);

router.post(
  '/',
  requirePermission('items.write'),
  asyncHandler(async (req, res) => {
    const payload = parseItemPayload(req);
    const { code, description, groupId, attributes = {}, stock = {}, images = [], needsRecount } = payload;
    if (!code || !description) {
      throw new HttpError(400, 'code y description son obligatorios');
    }
    const existing = await Item.findOne({ code });
    if (existing) {
      throw new HttpError(400, 'El código ya existe');
    }
    let group = null;
    const normalizedGroupId = normalizeOptionalObjectId(groupId);
    if (normalizedGroupId) {
      if (!Types.ObjectId.isValid(normalizedGroupId)) {
        throw new HttpError(400, 'Grupo inválido');
      }
      group = await Group.findById(normalizedGroupId);
      if (!group) {
        throw new HttpError(400, 'Grupo inválido');
      }
    }
    const stockData = Object.fromEntries(
      Object.entries(buildStock(stock)).filter(([, value]) => value !== null)
    );
    const { paths: sanitizedImages, newPaths: createdPaths } = await processIncomingImages(images);
    if (sanitizedImages.length > MAX_IMAGES) {
      await cleanupNewFiles(createdPaths);
      throw new HttpError(400, `Solo se permiten hasta ${MAX_IMAGES} imágenes por artículo.`);
    }
    const normalizedNeedsRecount = normalizeBooleanFlag(needsRecount, {
      fieldName: 'needsRecount',
      defaultValue: false
    });
    let item;
    try {
      item = await Item.create({
        code,
        description,
        group: group ? group.id : null,
        attributes,
        stock: stockData,
        images: sanitizedImages,
        needsRecount: normalizedNeedsRecount
      });
    } catch (error) {
      await cleanupNewFiles(createdPaths);
      throw error;
    }
    const populated = await item.populate('group');
    res.status(201).json(serializeItem(populated));
  })
);

router.put(
  '/:id',
  requirePermission('items.write'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!Types.ObjectId.isValid(id)) {
      throw new HttpError(400, 'Artículo inválido');
    }
    const item = await Item.findById(id);
    if (!item) {
      throw new HttpError(404, 'Artículo no encontrado');
    }
    const payload = parseItemPayload(req);
    const { description, groupId, attributes, stock, images, imagesToKeep, needsRecount } = payload || {};
    if (typeof description === 'string' && description && description !== item.description) {
      item.description = description;
    }
    const normalizedGroupId = normalizeOptionalObjectId(groupId);
    if (normalizedGroupId !== undefined) {
      if (normalizedGroupId === null) {
        if (item.group !== null) {
          item.group = null;
        }
      } else {
        if (!Types.ObjectId.isValid(normalizedGroupId)) {
          throw new HttpError(400, 'Grupo inválido');
        }
        const group = await Group.findById(normalizedGroupId);
        if (!group) {
          throw new HttpError(400, 'Grupo inválido');
        }
        const currentGroupId = item.group ? String(item.group) : null;
        if (currentGroupId !== String(group.id)) {
          item.group = group.id;
        }
      }
    }
    if (attributes) {
      if (!(item.attributes instanceof Map)) {
        item.attributes = new Map(Object.entries(item.attributes || {}));
      }
      Object.entries(attributes).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '') {
          if (item.attributes.has(key)) {
            item.attributes.delete(key);
          }
        } else {
          const nextValue = String(value);
          const currentValue = item.attributes.get(key);
          if (currentValue !== nextValue) {
            item.attributes.set(key, nextValue);
          }
        }
      });
    }
    if (stock) {
      const stockUpdates = buildStock(stock);
      if (!(item.stock instanceof Map)) {
        item.stock = new Map(Object.entries(item.stock || {}));
      }
      Object.entries(stockUpdates).forEach(([key, value]) => {
        if (value === null) {
          if (item.stock.has(key)) {
            item.stock.delete(key);
          }
        } else {
          const currentValue = item.stock.get(key);
          const currentBoxes = currentValue ? Number(currentValue.boxes) || 0 : 0;
          const currentUnits = currentValue ? Number(currentValue.units) || 0 : 0;
          const nextBoxes = Number(value.boxes) || 0;
          const nextUnits = Number(value.units) || 0;
          if (currentBoxes !== nextBoxes || currentUnits !== nextUnits) {
            item.stock.set(key, value);
          }
        }
      });
    }

    if (payload && Object.prototype.hasOwnProperty.call(payload, 'needsRecount')) {
      const normalizedNeedsRecount = normalizeBooleanFlag(needsRecount, {
        fieldName: 'needsRecount',
        defaultValue: item.needsRecount
      });
      if (normalizedNeedsRecount !== item.needsRecount) {
        item.needsRecount = normalizedNeedsRecount;
      }
    }

    const currentImages = Array.isArray(item.images) ? item.images : [];
    const existingPathSet = new Set(currentImages.map(sanitizeImagePath).filter(Boolean));
    let createdDuringUpdate = [];
    let nextImages;
    if (images !== undefined) {
      const processed = await processIncomingImages(images, existingPathSet);
      nextImages = processed.paths;
      createdDuringUpdate = processed.newPaths;
    } else if (imagesToKeep !== undefined) {
      const processed = await processIncomingImages(imagesToKeep, existingPathSet);
      nextImages = processed.paths;
      createdDuringUpdate = processed.newPaths;
    } else {
      nextImages = currentImages;
    }
    if (nextImages.length > MAX_IMAGES) {
      await cleanupNewFiles(createdDuringUpdate);
      throw new HttpError(400, `Solo se permiten hasta ${MAX_IMAGES} imágenes por artículo.`);
    }
    const nextPathSet = new Set(nextImages.map(sanitizeImagePath).filter(Boolean));
    const currentPathSet = new Set(currentImages.map(sanitizeImagePath).filter(Boolean));
    const pathsToRemove = [];
    currentPathSet.forEach(pathValue => {
      if (pathValue && !nextPathSet.has(pathValue)) {
        pathsToRemove.push(pathValue);
      }
    });
    const imagesChanged =
      nextImages.length !== currentImages.length ||
      nextImages.some((value, index) => value !== currentImages[index]);
    if (pathsToRemove.length > 0) {
      await Promise.allSettled(pathsToRemove.map(removeFileSafe));
    }
    if (imagesChanged) {
      item.images = nextImages;
    }
    const modifiedPaths = item.modifiedPaths();
    if (modifiedPaths.length === 0) {
      if (createdDuringUpdate.length > 0) {
        await cleanupNewFiles(createdDuringUpdate);
      }
      const populated = await item.populate('group');
      return res.json(serializeItem(populated));
    }
    const hasOtherModifications = modifiedPaths.some(path => path !== 'needsRecount');
    try {
      await item.save(hasOtherModifications ? undefined : { timestamps: false });
    } catch (error) {
      await cleanupNewFiles(createdDuringUpdate);
      throw error;
    }
    const populated = await item.populate('group');
    res.json(serializeItem(populated));
  })
);

module.exports = router;
