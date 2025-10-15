const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { HttpError } = require('../utils/errors');
const { requirePermission, requireAuth } = require('../middlewares/auth');
const MovementRequest = require('../models/MovementRequest');
const Location = require('../models/Location');
const {
  validateMovementPayload,
  executeMovement,
  addMovementLog,
  findItemOrThrow,
  normalizeStoredQuantity
} = require('../services/stockService');

function serializeUserSummary(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email
  };
}

function serializeLocationSummary(location) {
  if (!location) return null;
  return {
    id: location.id,
    name: location.name,
    description: location.description || '',
    type: location.type,
    contactInfo: location.contactInfo || ''
  };
}

function serializeMovementRequest(doc) {
  return {
    id: doc.id,
    itemId: doc.item?.id || doc.item,
    item: doc.populated('item')
      ? {
          id: doc.item.id,
          code: doc.item.code,
          description: doc.item.description
        }
      : null,
    type: doc.type,
    fromLocationId: doc.fromLocation?.id || doc.fromLocation,
    fromLocation: doc.populated('fromLocation') ? serializeLocationSummary(doc.fromLocation) : null,
    toLocationId: doc.toLocation?.id || doc.toLocation,
    toLocation: doc.populated('toLocation') ? serializeLocationSummary(doc.toLocation) : null,
    quantity: normalizeStoredQuantity(doc.quantity),
    reason: doc.reason,
    requestedBy: doc.populated('requestedBy') ? serializeUserSummary(doc.requestedBy) : doc.requestedBy,
    requestedAt: doc.requestedAt,
    status: doc.status,
    approvedBy: doc.populated('approvedBy') ? serializeUserSummary(doc.approvedBy) : doc.approvedBy,
    approvedAt: doc.approvedAt,
    executedAt: doc.executedAt,
    rejectedReason: doc.rejectedReason
  };
}

function requestMetadata(req) {
  return {
    ip: req.ip,
    userAgent: req.headers['user-agent'] || ''
  };
}

const router = express.Router();

router.post(
  '/request',
  requirePermission('stock.request'),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const { quantity, fromLocation, toLocation } = await validateMovementPayload(body);
    await findItemOrThrow(body.itemId);

    const movementRequest = new MovementRequest({
      item: body.itemId,
      type: 'transfer',
      fromLocation: fromLocation._id,
      toLocation: toLocation._id,
      quantity,
      reason: body.reason || '',
      requestedBy: req.user.id,
      requestedAt: new Date(),
      status: 'pending'
    });

    await movementRequest.save();
    await addMovementLog(movementRequest.id, 'requested', req.user.id, requestMetadata(req));

    const populated = await movementRequest.populate(['item', 'requestedBy', 'approvedBy', 'fromLocation', 'toLocation']);
    res.status(201).json(serializeMovementRequest(populated));
  })
);

router.post(
  '/approve/:id',
  requirePermission('stock.approve'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const request = await MovementRequest.findById(id);
    if (!request) {
      throw new HttpError(404, 'Solicitud no encontrada');
    }
    if (request.status !== 'pending') {
      throw new HttpError(400, 'La solicitud no está pendiente');
    }
    request.status = 'approved';
    request.approvedBy = req.user.id;
    request.approvedAt = new Date();
    await addMovementLog(request.id, 'approved', req.user.id, requestMetadata(req));
    await executeMovement(request, req.user.id, requestMetadata(req));
    const populated = await request.populate(['item', 'requestedBy', 'approvedBy', 'fromLocation', 'toLocation']);
    res.json(serializeMovementRequest(populated));
  })
);

router.post(
  '/reject/:id',
  requirePermission('stock.approve'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { reason } = req.body || {};
    const request = await MovementRequest.findById(id);
    if (!request) {
      throw new HttpError(404, 'Solicitud no encontrada');
    }
    if (request.status !== 'pending') {
      throw new HttpError(400, 'La solicitud no está pendiente');
    }
    request.status = 'rejected';
    request.rejectedReason = reason || null;
    request.approvedBy = req.user.id;
    request.approvedAt = new Date();
    await request.save();
    await addMovementLog(request.id, 'rejected', req.user.id, requestMetadata(req));
    const populated = await request.populate(['item', 'requestedBy', 'approvedBy', 'fromLocation', 'toLocation']);
    res.json(serializeMovementRequest(populated));
  })
);

router.get(
  '/requests',
  requireAuth,
  asyncHandler(async (req, res) => {
    const permissions = req.user?.permissions || [];
    if (!permissions.includes('stock.request') && !permissions.includes('stock.approve')) {
      throw new HttpError(403, 'Permiso denegado');
    }
    const { status } = req.query || {};
    const filter = {};
    if (status) {
      filter.status = status;
    }
    const requests = await MovementRequest.find(filter)
      .populate(['item', 'requestedBy', 'approvedBy', 'fromLocation', 'toLocation'])
      .sort({ requestedAt: -1 });
    res.json(requests.map(serializeMovementRequest));
  })
);

router.post(
  '/request/:id/resubmit',
  requirePermission('stock.request'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const request = await MovementRequest.findById(id);
    if (!request) {
      throw new HttpError(404, 'Solicitud no encontrada');
    }
    if (request.status !== 'rejected') {
      throw new HttpError(400, 'Solo se pueden reenviar solicitudes rechazadas');
    }
    request.status = 'pending';
    request.requestedAt = new Date();
    request.approvedAt = null;
    request.approvedBy = null;
    request.rejectedReason = null;
    await request.save();
    await addMovementLog(request.id, 'resubmitted', req.user.id, requestMetadata(req));
    const populated = await request.populate(['item', 'requestedBy', 'approvedBy', 'fromLocation', 'toLocation']);
    res.json(serializeMovementRequest(populated));
  })
);

router.get(
  '/locations',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { type } = req.query || {};
    const filters = {};
    if (type) {
      filters.type = type;
    }
    const locations = await Location.find(filters).sort({ name: 1 });
    res.json(locations.map(serializeLocationSummary));
  })
);

module.exports = router;
