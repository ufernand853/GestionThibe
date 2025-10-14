const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middlewares/auth');
const Item = require('../models/Item');
const MovementRequest = require('../models/MovementRequest');
const { normalizeStoredQuantity } = require('../services/stockService');

const router = express.Router();

router.get(
  '/stock',
  requirePermission('reports.read'),
  asyncHandler(async (req, res) => {
    const items = await Item.find().populate('group');
    res.json(
      items.map(item => ({
        id: item.id,
        code: item.code,
        description: item.description,
        groupId: item.group ? item.group.id : item.group,
        group: item.group ? { id: item.group.id, name: item.group.name } : null,
        stock: item.stock
      }))
    );
  })
);

function createEmptyTrendEntry() {
  return {
    general: { boxes: 0, units: 0 },
    overstock: { boxes: 0, units: 0 }
  };
}

function addQuantity(target, quantity, factor = 1) {
  const normalized = normalizeStoredQuantity(quantity);
  target.boxes += normalized.boxes * factor;
  target.units += normalized.units * factor;
}

const LIST_TO_BUCKET = {
  general: 'general',
  overstockGeneral: 'overstock',
  overstockThibe: 'overstock',
  overstockArenal: 'overstock'
};

router.get(
  '/stock/trends',
  requirePermission('reports.read'),
  asyncHandler(async (req, res) => {
    const { days = '30' } = req.query || {};
    const parsedDays = Math.min(Math.max(parseInt(days, 10) || 30, 1), 180);
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const windowStart = new Date(todayStart);
    windowStart.setDate(windowStart.getDate() - (parsedDays - 1));

    const executedRequests = await MovementRequest.find({
      status: 'executed',
      executedAt: { $gte: windowStart }
    })
      .sort({ executedAt: 1 })
      .select(['executedAt', 'type', 'fromList', 'toList', 'quantity']);

    const trendMap = new Map();
    for (let i = 0; i < parsedDays; i += 1) {
      const date = new Date(windowStart);
      date.setDate(windowStart.getDate() + i);
      const key = date.toISOString().slice(0, 10);
      trendMap.set(key, createEmptyTrendEntry());
    }

    executedRequests.forEach(request => {
      if (!request.executedAt) {
        return;
      }
      const dateKey = new Date(request.executedAt).toISOString().slice(0, 10);
      if (!trendMap.has(dateKey)) {
        trendMap.set(dateKey, createEmptyTrendEntry());
      }
      const entry = trendMap.get(dateKey);
      const quantity = normalizeStoredQuantity(request.quantity);

      if (request.type === 'in') {
        const bucket = LIST_TO_BUCKET[request.toList];
        if (bucket) {
          addQuantity(entry[bucket], quantity, 1);
        }
      } else if (request.type === 'out') {
        const bucket = LIST_TO_BUCKET[request.fromList];
        if (bucket) {
          addQuantity(entry[bucket], quantity, -1);
        }
      } else if (request.type === 'transfer') {
        const fromBucket = LIST_TO_BUCKET[request.fromList];
        const toBucket = LIST_TO_BUCKET[request.toList];
        if (fromBucket) {
          addQuantity(entry[fromBucket], quantity, -1);
        }
        if (toBucket) {
          addQuantity(entry[toBucket], quantity, 1);
        }
      }
    });

    const points = Array.from(trendMap.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, deltas]) => ({ date, deltas }));

    res.json({
      from: windowStart.toISOString(),
      to: todayStart.toISOString(),
      days: parsedDays,
      points
    });
  })
);

module.exports = router;
