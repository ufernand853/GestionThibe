const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middlewares/auth');
const MovementLog = require('../models/MovementLog');

const router = express.Router();

router.get(
  '/movements',
  requirePermission('stock.logs.read'),
  asyncHandler(async (req, res) => {
    const { requestId, limit = '100' } = req.query || {};
    const query = {};
    if (requestId) {
      query.movementRequest = requestId;
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

module.exports = router;
