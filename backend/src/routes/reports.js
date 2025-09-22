const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middlewares/auth');
const Item = require('../models/Item');

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

module.exports = router;
