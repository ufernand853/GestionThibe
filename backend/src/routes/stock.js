const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { HttpError } = require('../utils/errors');
const { requirePermission, requireAuth } = require('../middlewares/auth');
const MovementRequest = require('../models/MovementRequest');
const {
  validateMovementPayload,
  executeMovement,
  addMovementLog,
  ensureCustomerExists,
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

function getId(value) {
  if (!value) return value;
  return value.id || value;
}

function serializeMovementRequest(doc) {
  return {
    id: doc.id,
    itemId: getId(doc.item),
    item: doc.populated('item')
      ? {
          id: doc.item.id,
          code: doc.item.code,
          description: doc.item.description
        }
      : null,
    type: doc.type,
    fromList: doc.fromList,
    toList: doc.toList,
    quantity: normalizeStoredQuantity(doc.quantity),
    reason: doc.reason,
    boxLabel: doc.boxLabel || null,
    requestedBy: doc.populated('requestedBy') ? serializeUserSummary(doc.requestedBy) : doc.requestedBy,
    requestedAt: doc.requestedAt,
    status: doc.status,
    approvedBy: doc.populated('approvedBy') ? serializeUserSummary(doc.approvedBy) : doc.approvedBy,
    approvedAt: doc.approvedAt,
    executedAt: doc.executedAt,
    rejectedReason: doc.rejectedReason,
    customerId: getId(doc.customer),
    customer: doc.populated('customer')
      ? {
          id: doc.customer.id,
          name: doc.customer.name,
          status: doc.customer.status
        }
      : null
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
    const { quantity } = validateMovementPayload(body);
    const normalizedBoxLabel =
      typeof body.boxLabel === 'string' && body.boxLabel.trim().length > 0
        ? body.boxLabel.trim()
        : null;
    await findItemOrThrow(body.itemId);
    if (body.customerId) {
      await ensureCustomerExists(body.customerId);
    }
    const movementRequest = new MovementRequest({
      item: body.itemId,
      type: body.type,
      fromList: body.fromList || null,
      toList: body.toList || null,
      quantity,
      reason: body.reason || '',
      requestedBy: req.user.id,
      requestedAt: new Date(),
      status: 'pending',
      customer: body.customerId || null,
      boxLabel: normalizedBoxLabel
    });
    await movementRequest.save();
    await addMovementLog(movementRequest.id, 'requested', req.user.id, requestMetadata(req));
    if (movementRequest.type === 'in') {
      movementRequest.status = 'executed';
      await executeMovement(movementRequest, req.user.id, requestMetadata(req));
    } else {
      await movementRequest.populate(['item', 'requestedBy', 'customer']);
    }
    const populated = await movementRequest.populate(['item', 'requestedBy', 'approvedBy', 'customer']);
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
    const populated = await request.populate(['item', 'requestedBy', 'approvedBy', 'customer']);
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
    const populated = await request.populate(['item', 'requestedBy', 'approvedBy', 'customer']);
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
      .populate(['item', 'requestedBy', 'approvedBy', 'customer'])
      .sort({ requestedAt: -1 });
    res.json(requests.map(serializeMovementRequest));
  })
);

module.exports = router;
