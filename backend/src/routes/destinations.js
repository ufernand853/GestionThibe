const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { HttpError } = require('../utils/errors');
const { requirePermission } = require('../middlewares/auth');
const Destination = require('../models/Destination');

const router = express.Router();

const serializeDestination = destination => ({
  id: destination.id || (destination._id ? destination._id.toString() : undefined),
  name: destination.name,
  contactInfo: destination.contactInfo || '',
  status: destination.status || 'active'
});

router.get(
  '/',
  requirePermission('items.read'),
  asyncHandler(async (req, res) => {
    const destinations = await Destination.find().sort({ name: 1 });
    res.json(destinations.map(serializeDestination));
  })
);

router.post(
  '/',
  requirePermission('items.write'),
  asyncHandler(async (req, res) => {
    const { name, contactInfo, status } = req.body || {};
    if (!name || !name.trim()) {
      throw new HttpError(400, 'El nombre es obligatorio');
    }
    const destination = await Destination.create({
      name: name.trim(),
      contactInfo: contactInfo || '',
      status: status === 'inactive' ? 'inactive' : 'active'
    });
    res.status(201).json(serializeDestination(destination));
  })
);

router.put(
  '/:id',
  requirePermission('items.write'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const destination = await Destination.findById(id);
    if (!destination) {
      throw new HttpError(404, 'Destino no encontrado');
    }
    const { name, contactInfo, status } = req.body || {};
    if (name !== undefined) {
      if (!name || !name.trim()) {
        throw new HttpError(400, 'El nombre es obligatorio');
      }
      destination.name = name.trim();
    }
    if (contactInfo !== undefined) {
      destination.contactInfo = contactInfo || '';
    }
    if (status !== undefined) {
      if (!['active', 'inactive'].includes(status)) {
        throw new HttpError(400, 'Estado inválido');
      }
      destination.status = status;
    }
    await destination.save();
    res.json(serializeDestination(destination));
  })
);

router.delete(
  '/:id',
  requirePermission('items.write'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const destination = await Destination.findById(id);
    if (!destination) {
      throw new HttpError(404, 'Destino no encontrado');
    }
    await destination.deleteOne();
    res.json({ success: true });
  })
);

module.exports = router;
