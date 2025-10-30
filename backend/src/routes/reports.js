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

function hasPositiveQuantity(quantity) {
  if (!quantity) {
    return false;
  }
  const normalized = ensureQuantity(quantity);
  return Number(normalized.boxes) > 0 || Number(normalized.units) > 0;
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
    const includeItems =
      typeof req.query.includeItems === 'string' && req.query.includeItems.toLowerCase() === 'true';
    const requestedGroupId = typeof req.query.groupId === 'string' ? req.query.groupId : null;
    const isRequestingUngrouped = requestedGroupId === 'ungrouped';

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
      groupIndex.set(
        group.id,
        includeItems
          ? { id: group.id, name: group.name, items: [], total: { boxes: 0, units: 0 } }
          : { id: group.id, name: group.name, total: { boxes: 0, units: 0 } }
      );
    });

    const ungrouped = includeItems
      ? { id: null, name: 'Sin grupo', items: [], total: { boxes: 0, units: 0 } }
      : { id: null, name: 'Sin grupo', total: { boxes: 0, units: 0 } };

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

      if (includeItems && Array.isArray(targetGroup.items)) {
        targetGroup.items.push({
          id: item.id,
          code: item.code,
          description: item.description,
          stockByLocation: stockEntries,
          total: itemTotal
        });
      }
      addQuantity(targetGroup.total, itemTotal);
    });

    const hasStock = total => Number(total.boxes) > 0 || Number(total.units) > 0;

    const response = Array.from(groupIndex.values());
    if (includeItems ? ungrouped.items.length > 0 : hasStock(ungrouped.total)) {
      response.push(ungrouped);
    }

    const filtered = response.filter(group => {
      if (requestedGroupId) {
        if (group.id) {
          return String(group.id) === requestedGroupId;
        }
        return isRequestingUngrouped;
      }
      if (includeItems) {
        return Array.isArray(group.items) && group.items.length > 0;
      }
      return hasStock(group.total);
    });

    const formatted = filtered.map(group => {
      const base = {
        id: group.id ?? null,
        name: group.name ?? '',
        total: ensureQuantity(group.total)
      };
      if (includeItems) {
        return {
          ...base,
          items: Array.isArray(group.items)
            ? group.items.map(item => ({
                id: item.id,
                code: item.code,
                description: item.description,
                stockByLocation: item.stockByLocation,
                total: ensureQuantity(item.total)
              }))
            : []
        };
      }
      return base;
    });

    res.json(formatted);
  })
);

async function respondStockByLocation(req, res) {
  const includeItems =
    typeof req.query.includeItems === 'string' && req.query.includeItems.toLowerCase() === 'true';
  const requestedLocationId = typeof req.query.locationId === 'string' ? req.query.locationId : null;

  const [items, locations] = await Promise.all([Item.find(), Location.find()]);
  const locationsById = new Map(
    locations.map(location => [
      String(location.id),
      {
        id: String(location.id),
        name: location.name,
        type: location.type,
        status: location.status
      }
    ])
  );

  const totals = new Map();

  locationsById.forEach(info => {
    totals.set(info.id, {
      id: info.id,
      name: info.name || '',
      type: info.type,
      status: info.status,
      total: { boxes: 0, units: 0 },
      ...(includeItems ? { items: [] } : {})
    });
  });

  function getBucket(locationId) {
    const key = String(locationId);
    let bucket = totals.get(key);
    if (!bucket) {
      const locationInfo = locationsById.get(key) || null;
      bucket = {
        id: key,
        name: locationInfo?.name || '',
        type: locationInfo?.type,
        status: locationInfo?.status,
        total: { boxes: 0, units: 0 },
        ...(includeItems ? { items: [] } : {})
      };
      totals.set(key, bucket);
    }
    return bucket;
  }

  items.forEach(item => {
    const stockEntries = mapStockToArray(item.stock, locationsById);
    stockEntries.forEach(entry => {
      const normalized = ensureQuantity(entry.quantity);
      if (!hasPositiveQuantity(normalized)) {
        return;
      }
      const bucket = getBucket(entry.locationId);
      addQuantity(bucket.total, normalized);

      if (includeItems && Array.isArray(bucket.items)) {
        bucket.items.push({
          id: item.id,
          code: item.code,
          description: item.description,
          stockByLocation: stockEntries.map(locationEntry => ({
            locationId: locationEntry.locationId,
            quantity: ensureQuantity(locationEntry.quantity),
            location: locationEntry.location
              ? {
                  id: locationEntry.location.id,
                  name: locationEntry.location.name,
                  status: locationEntry.location.status,
                  type: locationEntry.location.type
                }
              : null
          })),
          total: normalized
        });
      }
    });
  });

  let response = Array.from(totals.values()).map(entry => {
    const base = {
      id: entry.id,
      name: entry.name,
      type: entry.type,
      status: entry.status,
      total: ensureQuantity(entry.total)
    };
    if (includeItems) {
      return {
        ...base,
        items: Array.isArray(entry.items)
          ? entry.items.map(item => ({
              id: item.id,
              code: item.code,
              description: item.description,
              stockByLocation: Array.isArray(item.stockByLocation)
                ? item.stockByLocation.map(locationEntry => ({
                    locationId: locationEntry.locationId,
                    quantity: ensureQuantity(locationEntry.quantity),
                    location: locationEntry.location
                  }))
                : [],
              total: ensureQuantity(item.total)
            }))
          : []
      };
    }
    return base;
  });

  if (requestedLocationId) {
    const requestedKey = String(requestedLocationId);
    response = response.filter(entry => String(entry.id) === requestedKey);
  } else if (includeItems) {
    response = response.filter(entry => Array.isArray(entry.items) && entry.items.length > 0);
  }

  res.json(response);
}

router.get('/stock/by-location', requirePermission('reports.read'), asyncHandler(respondStockByLocation));
router.get('/stock/by-deposit', requirePermission('reports.read'), asyncHandler(respondStockByLocation));

module.exports = router;
