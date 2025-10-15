const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { HttpError } = require('../utils/errors');
const { requirePermission } = require('../middlewares/auth');
const Deposit = require('../models/Deposit');
const Item = require('../models/Item');
const MovementRequest = require('../models/MovementRequest');

function serializeDeposit(deposit) {
  return {
    id: deposit.id,
    name: deposit.name,
    description: deposit.description || '',
    status: deposit.status
  };
}

const router = express.Router();

router.get(
  '/',
  requirePermission('items.read'),
  asyncHandler(async (req, res) => {
    const deposits = await Deposit.find().sort({ name: 1 });
    res.json(deposits.map(serializeDeposit));
  })
);

router.post(
  '/',
  requirePermission('items.write'),
  asyncHandler(async (req, res) => {
    const { name, description, status } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new HttpError(400, 'El nombre es obligatorio');
    }
    const deposit = await Deposit.create({
      name: name.trim(),
      description: typeof description === 'string' ? description.trim() : '',
      status: status === 'inactive' ? 'inactive' : 'active'
    });
    res.status(201).json(serializeDeposit(deposit));
  })
);

router.put(
  '/:id',
  requirePermission('items.write'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const deposit = await Deposit.findById(id);
    if (!deposit) {
      throw new HttpError(404, 'Depósito no encontrado');
    }
    const { name, description, status } = req.body || {};
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        throw new HttpError(400, 'El nombre es obligatorio');
      }
      deposit.name = name.trim();
    }
    if (description !== undefined) {
      deposit.description = typeof description === 'string' ? description.trim() : '';
    }
    if (status !== undefined) {
      if (!['active', 'inactive'].includes(status)) {
        throw new HttpError(400, 'Estado inválido');
      }
      deposit.status = status;
    }
    await deposit.save();
    res.json(serializeDeposit(deposit));
  })
);

router.delete(
  '/:id',
  requirePermission('items.write'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const deposit = await Deposit.findById(id);
    if (!deposit) {
      throw new HttpError(404, 'Depósito no encontrado');
    }

    const hasMovements = await MovementRequest.exists({
      $or: [{ fromDeposit: id }, { toDeposit: id }]
    });
    if (hasMovements) {
      throw new HttpError(400, 'No se puede eliminar un depósito con movimientos asociados.');
    }

    const hasStock = await Item.exists({ [`stock.${id}`]: { $exists: true } });
    if (hasStock) {
      throw new HttpError(400, 'No se puede eliminar un depósito con stock asignado.');
    }

    await deposit.deleteOne();
    res.json({ success: true });
  })
);

module.exports = router;
