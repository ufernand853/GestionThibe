const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { HttpError } = require('../utils/errors');
const { requirePermission } = require('../middlewares/auth');
const Group = require('../models/Group');

const router = express.Router();

router.get(
  '/',
  requirePermission('items.read'),
  asyncHandler(async (req, res) => {
    const groups = await Group.find().sort({ name: 1 });
    res.json(groups);
  })
);

router.post(
  '/',
  requirePermission('items.write'),
  asyncHandler(async (req, res) => {
    const { name, parentId } = req.body || {};
    if (!name) {
      throw new HttpError(400, 'El nombre es obligatorio');
    }
    let parent = null;
    if (parentId) {
      parent = await Group.findById(parentId);
      if (!parent) {
        throw new HttpError(400, 'Grupo padre inválido');
      }
    }
    const group = await Group.create({ name, parent: parent ? parent.id : null });
    res.status(201).json(group);
  })
);

module.exports = router;
