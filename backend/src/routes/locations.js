const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { HttpError } = require('../utils/errors');
const { requirePermission } = require('../middlewares/auth');
const Location = require('../models/Location');

const LOCATION_TYPES = Location.LOCATION_TYPES || ['warehouse', 'external', 'externalOrigin'];
const ALLOWED_LOCATION_TYPES = new Set(LOCATION_TYPES);
const Item = require('../models/Item');
const MovementRequest = require('../models/MovementRequest');

const router = express.Router();

function serializeLocation(location) {
  return {
    id: location.id,
    name: location.name,
    type: location.type,
    description: location.description || '',
    contactInfo: location.contactInfo || '',
    status: location.status
  };
}

function sanitizeOptionalString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function ensureValidType(type) {
  const normalized = typeof type === 'string' ? type.trim() : '';
  if (!normalized) {
    return 'warehouse';
  }
  if (!ALLOWED_LOCATION_TYPES.has(normalized)) {
    throw new HttpError(400, 'Tipo de ubicación inválido');
  }
  return normalized;
}

router.get(
  '/',
  requirePermission('items.read'),
  asyncHandler(async (req, res) => {
    const { type, status } = req.query || {};
    const filters = {};
    if (type) {
      filters.type = type;
    }
    if (status) {
      filters.status = status;
    }
    const locations = await Location.find(filters).sort({ name: 1 });
    res.json(locations.map(serializeLocation));
  })
);

router.post(
  '/',
  requirePermission('items.write'),
  asyncHandler(async (req, res) => {
    const { name, description, contactInfo, status, type } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new HttpError(400, 'El nombre es obligatorio');
    }
    const location = await Location.create({
      name: name.trim(),
      type: ensureValidType(type),
      description: sanitizeOptionalString(description),
      contactInfo: sanitizeOptionalString(contactInfo),
      status: status === 'inactive' ? 'inactive' : 'active'
    });
    res.status(201).json(serializeLocation(location));
  })
);

router.put(
  '/:id',
  requirePermission('items.write'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const location = await Location.findById(id);
    if (!location) {
      throw new HttpError(404, 'Ubicación no encontrada');
    }
    const { name, description, contactInfo, status, type } = req.body || {};
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        throw new HttpError(400, 'El nombre es obligatorio');
      }
      location.name = name.trim();
    }
    if (type !== undefined) {
      location.type = ensureValidType(type);
    }
    if (description !== undefined) {
      location.description = sanitizeOptionalString(description);
    }
    if (contactInfo !== undefined) {
      location.contactInfo = sanitizeOptionalString(contactInfo);
    }
    if (status !== undefined) {
      if (!['active', 'inactive'].includes(status)) {
        throw new HttpError(400, 'Estado inválido');
      }
      location.status = status;
    }
    await location.save();
    res.json(serializeLocation(location));
  })
);

router.delete(
  '/:id',
  requirePermission('items.write'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const location = await Location.findById(id);
    if (!location) {
      throw new HttpError(404, 'Ubicación no encontrada');
    }

    const hasMovements = await MovementRequest.exists({
      $or: [{ fromLocation: id }, { toLocation: id }]
    });
    if (hasMovements) {
      throw new HttpError(400, 'No se puede eliminar una ubicación con movimientos asociados.');
    }

    const hasStock = await Item.exists({ [`stock.${id}`]: { $exists: true } });
    if (hasStock) {
      throw new HttpError(400, 'No se puede eliminar una ubicación con stock asignado.');
    }

    await location.deleteOne();
    res.json({ success: true });
  })
);

module.exports = router;
