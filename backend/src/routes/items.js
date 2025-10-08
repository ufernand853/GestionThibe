const express = require('express');
const path = require('path');
const fs = require('fs');
const asyncHandler = require('../utils/asyncHandler');
const { HttpError } = require('../utils/errors');
const { requirePermission } = require('../middlewares/auth');
const Item = require('../models/Item');
const Group = require('../models/Group');
const { normalizeQuantityInput } = require('../services/stockService');

const { promises: fsPromises } = fs;

const MAX_IMAGES = 10;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const projectRoot = path.join(__dirname, '..', '..');
const uploadsRoot = path.join(projectRoot, 'uploads');
const itemUploadsDir = path.join(uploadsRoot, 'items');
fs.mkdirSync(itemUploadsDir, { recursive: true });

const ALLOWED_DATA_URL_PREFIXES = [
  { match: 'data:image/jpeg;base64,', normalized: 'data:image/jpeg;base64,' },
  { match: 'data:image/jpg;base64,', normalized: 'data:image/jpeg;base64,' },
  { match: 'data:image/png;base64,', normalized: 'data:image/png;base64,' },
  { match: 'data:image/webp;base64,', normalized: 'data:image/webp;base64,' },
  { match: 'data:image/gif;base64,', normalized: 'data:image/gif;base64,' }
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

function sanitizeIncomingImages(values, existingSet = null) {
  if (!Array.isArray(values)) {
    return [];
  }
  const sanitized = [];
  const seen = new Set();
  values.forEach(value => {
    const sanitizedDataUrl = sanitizeDataUrl(value);
    if (sanitizedDataUrl) {
      if (!seen.has(sanitizedDataUrl)) {
        seen.add(sanitizedDataUrl);
        sanitized.push(sanitizedDataUrl);
      }
      return;
    }
    const sanitizedPath = sanitizeImagePath(value);
    if (!sanitizedPath) {
      return;
    }
    if (existingSet && !existingSet.has(sanitizedPath)) {
      return;
    }
    if (seen.has(sanitizedPath)) {
      return;
    }
    seen.add(sanitizedPath);
    sanitized.push(sanitizedPath);
  });
  return sanitized;
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
    stock: doc.stock,
    images: Array.isArray(doc.images) ? doc.images : [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

function buildStock(input = {}) {
  const stock = {};
  for (const key of ['general', 'overstockGeneral', 'overstockThibe', 'overstockArenal']) {
    const value = input[key];
    if (value === undefined) continue;
    stock[key] = normalizeQuantityInput(value, { allowZero: true, fieldName: `Stock ${key}` });
  }
  return stock;
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
  uploadMiddleware,
  asyncHandler(async (req, res) => {
    const payload = parseItemPayload(req);
    const { code, description, groupId, attributes = {}, stock = {}, images = [] } = payload;
    if (!code || !description) {
      throw new HttpError(400, 'code y description son obligatorios');
    }
    const existing = await Item.findOne({ code });
    if (existing) {
      throw new HttpError(400, 'El código ya existe');
    }
    let group = null;
    if (groupId) {
      group = await Group.findById(groupId);
      if (!group) {
        throw new HttpError(400, 'Grupo inválido');
      }
    }
    const stockData = buildStock(stock);
    const sanitizedImages = sanitizeIncomingImages(images);
    if (sanitizedImages.length > MAX_IMAGES) {
      throw new HttpError(400, `Solo se permiten hasta ${MAX_IMAGES} imágenes por artículo.`);
    }
    let item;
    item = await Item.create({
      code,
      description,
      group: group ? group.id : null,
      attributes,
      stock: stockData,
      images: sanitizedImages
    });
    const populated = await item.populate('group');
    res.status(201).json(serializeItem(populated));
  })
);

router.put(
  '/:id',
  requirePermission('items.write'),
  uploadMiddleware,
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const item = await Item.findById(id);
    if (!item) {
      throw new HttpError(404, 'Artículo no encontrado');
    }
    const payload = parseItemPayload(req);
    const { description, groupId, attributes, stock, images, imagesToKeep } = payload || {};
    if (description) {
      item.description = description;
    }
    if (groupId !== undefined) {
      if (groupId === null) {
        item.group = null;
      } else {
        const group = await Group.findById(groupId);
        if (!group) {
          throw new HttpError(400, 'Grupo inválido');
        }
        item.group = group.id;
      }
    }
    if (attributes) {
      if (!(item.attributes instanceof Map)) {
        item.attributes = new Map(Object.entries(item.attributes || {}));
      }
      Object.entries(attributes).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '') {
          item.attributes.delete(key);
        } else {
          item.attributes.set(key, value);
        }
      });
    }
    if (stock) {
      const stockUpdates = buildStock(stock);
      Object.entries(stockUpdates).forEach(([key, value]) => {
        item.stock[key] = value;
      });
    }

    const currentImages = Array.isArray(item.images) ? item.images : [];
    const existingPathSet = new Set(currentImages.map(sanitizeImagePath).filter(Boolean));
    let nextImages;
    if (images !== undefined) {
      nextImages = sanitizeIncomingImages(images, existingPathSet);
    } else if (imagesToKeep !== undefined) {
      nextImages = sanitizeIncomingImages(imagesToKeep, existingPathSet);
    } else {
      nextImages = currentImages;
    }
    if (nextImages.length > MAX_IMAGES) {
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
    if (pathsToRemove.length > 0) {
      await Promise.allSettled(pathsToRemove.map(removeFileSafe));
    }
    item.images = nextImages;

    await item.save();
    const populated = await item.populate('group');
    res.json(serializeItem(populated));
  })
);

module.exports = router;
