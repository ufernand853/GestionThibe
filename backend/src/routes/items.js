const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { HttpError } = require('../utils/errors');
const { requirePermission } = require('../middlewares/auth');
const Item = require('../models/Item');
const Group = require('../models/Group');

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
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt
  };
}

function buildStock(input = {}) {
  const stock = {};
  for (const key of ['general', 'overstockGeneral', 'overstockThibe', 'overstockArenal']) {
    const value = input[key];
    if (value === undefined) continue;
    const numeric = Number(value);
    if (Number.isNaN(numeric) || numeric < 0) {
      throw new HttpError(400, 'Stock inválido');
    }
    stock[key] = numeric;
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
  asyncHandler(async (req, res) => {
    const { code, description, groupId, attributes = {}, stock = {} } = req.body || {};
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
    const item = await Item.create({
      code,
      description,
      group: group ? group.id : null,
      attributes,
      stock: stockData
    });
    const populated = await item.populate('group');
    res.status(201).json(serializeItem(populated));
  })
);

router.put(
  '/:id',
  requirePermission('items.write'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const item = await Item.findById(id);
    if (!item) {
      throw new HttpError(404, 'Artículo no encontrado');
    }
    const { description, groupId, attributes, stock } = req.body || {};
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
    await item.save();
    const populated = await item.populate('group');
    res.json(serializeItem(populated));
  })
);

module.exports = router;
