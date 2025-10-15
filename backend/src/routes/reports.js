const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middlewares/auth');
const Item = require('../models/Item');
const Group = require('../models/Group');
const Location = require('../models/Location');
const { normalizeStoredQuantity } = require('../services/stockService');

const router = express.Router();

function ensureQuantity(value) {
  const normalized = normalizeStoredQuantity(value);
  return {
    boxes: Number.isFinite(normalized.boxes) ? normalized.boxes : 0,
    units: Number.isFinite(normalized.units) ? normalized.units : 0
  };
}

function addQuantity(target, quantity) {
  const normalized = ensureQuantity(quantity);
  target.boxes += normalized.boxes;
  target.units += normalized.units;
}

function mapStockToArray(stock, locationsById) {
  const entries = [];
  if (stock instanceof Map) {
    for (const [locationId, quantity] of stock.entries()) {
      const key = String(locationId);
      entries.push({
        locationId: key,
        quantity: normalizeStoredQuantity(quantity),
        location: locationsById.get(key) || null
      });
    }
  } else if (stock && typeof stock === 'object') {
    Object.entries(stock).forEach(([locationId, quantity]) => {
      const key = String(locationId);
      entries.push({
        locationId: key,
        quantity: normalizeStoredQuantity(quantity),
        location: locationsById.get(key) || null
      });
    });
  }
  return entries;
}

router.get(
  '/stock/by-group',
  requirePermission('reports.read'),
  asyncHandler(async (req, res) => {
    const [items, groups, locations] = await Promise.all([
      Item.find().populate('group'),
      Group.find(),
      Location.find()
    ]);
    const locationsById = new Map(
      locations.map(location => [location.id, { id: location.id, name: location.name, status: location.status, type: location.type }])
    );
    const groupIndex = new Map();
    groups.forEach(group => {
      groupIndex.set(group.id, { id: group.id, name: group.name, items: [], total: { boxes: 0, units: 0 } });
    });

    const ungrouped = { id: null, name: 'Sin grupo', items: [], total: { boxes: 0, units: 0 } };

    items.forEach(item => {
      const stockEntries = mapStockToArray(item.stock, locationsById);
      const targetGroup = item.group ? groupIndex.get(item.group.id) : ungrouped;
      const itemTotal = stockEntries.reduce(
        (acc, entry) => {
          addQuantity(acc, entry.quantity);
          return acc;
        },
        { boxes: 0, units: 0 }
      );

      targetGroup.items.push({
        id: item.id,
        code: item.code,
        description: item.description,
        stockByLocation: stockEntries,
        total: itemTotal
      });
      addQuantity(targetGroup.total, itemTotal);
    });

    const response = Array.from(groupIndex.values()).filter(group => group.items.length > 0);
    if (ungrouped.items.length > 0) {
      response.push(ungrouped);
    }

    res.json(response);
  })
);

async function respondStockByLocation(req, res) {
  const [items, locations] = await Promise.all([Item.find(), Location.find()]);
  const totals = new Map(
    locations.map(location => [location.id, { id: location.id, name: location.name, type: location.type, total: { boxes: 0, units: 0 } }])
  );

  items.forEach(item => {
    if (item.stock instanceof Map) {
      for (const [locationId, quantity] of item.stock.entries()) {
        let bucket = totals.get(locationId);
        if (!bucket) {
          const locationInfo = locations.find(location => location.id === locationId);
          bucket = {
            id: locationId,
            name: locationInfo ? locationInfo.name : '',
            type: locationInfo ? locationInfo.type : undefined,
            total: { boxes: 0, units: 0 }
          };
          totals.set(locationId, bucket);
        }
        const normalized = normalizeStoredQuantity(quantity);
        bucket.total.boxes += normalized.boxes;
        bucket.total.units += normalized.units;
      }
    } else if (item.stock && typeof item.stock === 'object') {
      Object.entries(item.stock).forEach(([locationId, quantity]) => {
        let bucket = totals.get(locationId);
        if (!bucket) {
          const locationInfo = locations.find(location => location.id === locationId);
          bucket = {
            id: locationId,
            name: locationInfo ? locationInfo.name : '',
            type: locationInfo ? locationInfo.type : undefined,
            total: { boxes: 0, units: 0 }
          };
          totals.set(locationId, bucket);
        }
        const normalized = normalizeStoredQuantity(quantity);
        bucket.total.boxes += normalized.boxes;
        bucket.total.units += normalized.units;
      });
    }
  });

  const response = Array.from(totals.values()).map(entry => ({
    id: entry.id,
    name: entry.name,
    type: entry.type,
    total: entry.total
  }));

  res.json(response);
}

router.get('/stock/by-location', requirePermission('reports.read'), asyncHandler(respondStockByLocation));
router.get('/stock/by-deposit', requirePermission('reports.read'), asyncHandler(respondStockByLocation));

module.exports = router;
