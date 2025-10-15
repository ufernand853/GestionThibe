const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middlewares/auth');
const Item = require('../models/Item');
const Group = require('../models/Group');
const Deposit = require('../models/Deposit');
const { normalizeStoredQuantity } = require('../services/stockService');

const router = express.Router();

function mapStockToArray(stock, depositsById) {
  const entries = [];
  if (stock instanceof Map) {
    for (const [depositId, quantity] of stock.entries()) {
      const key = String(depositId);
      entries.push({
        depositId: key,
        quantity: normalizeStoredQuantity(quantity),
        deposit: depositsById.get(key) || null
      });
    }
  } else if (stock && typeof stock === 'object') {
    Object.entries(stock).forEach(([depositId, quantity]) => {
      const key = String(depositId);
      entries.push({
        depositId: key,
        quantity: normalizeStoredQuantity(quantity),
        deposit: depositsById.get(key) || null
      });
    });
  }
  return entries;
}

router.get(
  '/stock/by-group',
  requirePermission('reports.read'),
  asyncHandler(async (req, res) => {
    const [items, groups, deposits] = await Promise.all([
      Item.find().populate('group'),
      Group.find(),
      Deposit.find()
    ]);
    const depositsById = new Map(deposits.map(deposit => [deposit.id, { id: deposit.id, name: deposit.name, status: deposit.status }]));
    const groupIndex = new Map();
    groups.forEach(group => {
      groupIndex.set(group.id, { id: group.id, name: group.name, items: [] });
    });

    const ungrouped = { id: null, name: 'Sin grupo', items: [] };

    items.forEach(item => {
      const stockEntries = mapStockToArray(item.stock, depositsById);
      const targetGroup = item.group ? groupIndex.get(item.group.id) : ungrouped;
      targetGroup.items.push({
        id: item.id,
        code: item.code,
        description: item.description,
        stockByDeposit: stockEntries
      });
    });

    const response = Array.from(groupIndex.values()).filter(group => group.items.length > 0);
    if (ungrouped.items.length > 0) {
      response.push(ungrouped);
    }

    res.json(response);
  })
);

router.get(
  '/stock/by-deposit',
  requirePermission('reports.read'),
  asyncHandler(async (req, res) => {
    const [items, deposits] = await Promise.all([Item.find(), Deposit.find()]);
    const totals = new Map(deposits.map(deposit => [deposit.id, { id: deposit.id, name: deposit.name, total: { boxes: 0, units: 0 } }]));

    items.forEach(item => {
      if (item.stock instanceof Map) {
        for (const [depositId, quantity] of item.stock.entries()) {
          let bucket = totals.get(depositId);
          if (!bucket) {
            const depositInfo = deposits.find(deposit => deposit.id === depositId);
            bucket = { id: depositId, name: depositInfo ? depositInfo.name : '', total: { boxes: 0, units: 0 } };
            totals.set(depositId, bucket);
          }
          const normalized = normalizeStoredQuantity(quantity);
          bucket.total.boxes += normalized.boxes;
          bucket.total.units += normalized.units;
        }
      } else if (item.stock && typeof item.stock === 'object') {
        Object.entries(item.stock).forEach(([depositId, quantity]) => {
          let bucket = totals.get(depositId);
          if (!bucket) {
            const depositInfo = deposits.find(deposit => deposit.id === depositId);
            bucket = { id: depositId, name: depositInfo ? depositInfo.name : '', total: { boxes: 0, units: 0 } };
            totals.set(depositId, bucket);
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
      total: entry.total
    }));

    res.json(response);
  })
);

module.exports = router;
