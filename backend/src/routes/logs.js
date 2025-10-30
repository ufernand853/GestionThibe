const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middlewares/auth');
const MovementLog = require('../models/MovementLog');
const AuditLog = require('../models/AuditLog');
const { parseDateBoundary } = require('../utils/dateRange');

const router = express.Router();

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.get(
  '/movements',
  requirePermission('stock.logs.read'),
  asyncHandler(async (req, res) => {
    const { requestId, limit = '100', action, from, to } = req.query || {};
    const query = {};
    if (requestId) {
      query.movementRequest = requestId;
    }
    if (action) {
      query.action = action;
    }
    const range = {};
    const fromDate = parseDateBoundary(from);
    const toDate = parseDateBoundary(to, { endOfDay: true });
    if (fromDate) {
      range.$gte = fromDate;
    }
    if (toDate) {
      range.$lte = toDate;
    }
    if (Object.keys(range).length > 0) {
      query.timestamp = range;
    }
    const results = await MovementLog.find(query)
      .sort({ timestamp: -1 })
      .limit(Math.min(parseInt(limit, 10) || 100, 500))
      .populate(['movementRequest', 'actor']);
    res.json(
      results.map(log => ({
        id: log.id,
        movementRequestId: log.movementRequest ? log.movementRequest.id : log.movementRequest,
        action: log.action,
        actor: log.populated('actor')
          ? {
              id: log.actor.id,
              username: log.actor.username,
              email: log.actor.email
            }
          : log.actor,
        timestamp: log.timestamp,
        metadata: log.metadata ? Object.fromEntries(log.metadata.entries ? log.metadata.entries() : Object.entries(log.metadata)) : {}
      }))
    );
  })
);

router.get(
  '/audit',
  requirePermission('stock.logs.read'),
  asyncHandler(async (req, res) => {
    const { action, request, user, limit = '100', from, to } = req.query || {};
    const query = {};
    const normalizedAction = typeof action === 'string' ? action.trim() : '';
    const normalizedRequest = typeof request === 'string' ? request.trim() : '';
    const normalizedUser = typeof user === 'string' ? user.trim() : '';
    if (normalizedAction) {
      query.action = normalizedAction;
    }
    if (normalizedRequest) {
      query.request = { $regex: new RegExp(escapeRegExp(normalizedRequest), 'i') };
    }
    if (normalizedUser) {
      query.user = { $regex: new RegExp(escapeRegExp(normalizedUser), 'i') };
    }
    const range = {};
    const fromDate = parseDateBoundary(from);
    const toDate = parseDateBoundary(to, { endOfDay: true });
    if (fromDate) {
      range.$gte = fromDate;
    }
    if (toDate) {
      range.$lte = toDate;
    }
    if (Object.keys(range).length > 0) {
      query.timestamp = range;
    }
    const results = await AuditLog.find(query)
      .sort({ timestamp: -1 })
      .limit(Math.min(parseInt(limit, 10) || 100, 500));
    res.json(
      results.map(log => ({
        id: log.id,
        action: log.action,
        request: log.request,
        user: log.user,
        timestamp: log.timestamp
      }))
    );
  })
);

module.exports = router;
