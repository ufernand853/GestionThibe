const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { HttpError } = require('../utils/errors');
const { requirePermission, requireAuth } = require('../middlewares/auth');
const { Types } = require('mongoose');
const MovementRequest = require('../models/MovementRequest');
const MovementLog = require('../models/MovementLog');
const Location = require('../models/Location');
const Item = require('../models/Item');
const User = require('../models/User');
const Role = require('../models/Role');
const {
  validateMovementPayload,
  executeMovement,
  addMovementLog,
  findItemOrThrow,
  normalizeStoredQuantity
} = require('../services/stockService');
const { recordAuditEvent } = require('../services/auditService');
const { parseDateBoundary } = require('../utils/dateRange');
const { collectGroupAndDescendantIds, buildGroupFilterValues } = require('../services/groupService');

function escapeRegex(value) {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function buildAttributeMatcher(rawValue) {
  if (typeof rawValue !== 'string') {
    return null;
  }
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }
  return new RegExp(`^\\s*${escapeRegex(trimmed)}\\s*$`, 'i');
}

function serializeStock(stock) {
  if (!stock || typeof stock !== 'object') {
    return {};
  }

  const result = {};
  if (stock instanceof Map) {
    for (const [locationId, quantity] of stock.entries()) {
      if (quantity === null || quantity === undefined) {
        continue;
      }
      result[locationId] = normalizeStoredQuantity(quantity);
    }
    return result;
  }

  Object.entries(stock).forEach(([locationId, quantity]) => {
    if (quantity === null || quantity === undefined) {
      return;
    }
    result[locationId] = normalizeStoredQuantity(quantity);
  });

  return result;
}

function ensureStockAccess(req) {
  const permissions = req.user?.permissions || [];
  if (!permissions.includes('stock.request') && !permissions.includes('stock.approve')) {
    throw new HttpError(403, 'Permiso denegado');
  }
}

function serializeUserSummary(user) {
  if (!user) return null;
  const roleId = extractReferenceId(user.role);
  const roleName = user.role && typeof user.role === 'object' ? user.role.name : null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: roleName,
    roleId: roleId || null
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

function determineMovementType(fromLocation, toLocation) {
  if (fromLocation && fromLocation.type === 'externalOrigin') {
    return 'ingress';
  }
  if (toLocation && toLocation.type === 'external') {
    return 'egress';
  }
  return 'transfer';
}

function extractReferenceId(value) {
  if (!value) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Types.ObjectId) {
    return value.toString();
  }
  if (typeof value === 'object') {
    if (typeof value.id === 'string') {
      return value.id;
    }
    if (value._id) {
      return extractReferenceId(value._id);
    }
  }
  return null;
}

function isValuePopulated(value) {
  if (!value) {
    return false;
  }
  if (typeof value === 'string') {
    return false;
  }
  if (value instanceof Types.ObjectId) {
    return false;
  }
  if (typeof value === 'object') {
    return true;
  }
  return false;
}

function serializeMovementRequest(doc) {
  const fromLocationValue = doc.fromLocation;
  const toLocationValue = doc.toLocation;
  const populatedFrom = isValuePopulated(fromLocationValue) ? fromLocationValue : null;
  const populatedTo = isValuePopulated(toLocationValue) ? toLocationValue : null;
  const computedType = determineMovementType(populatedFrom, populatedTo);
  const type =
    doc.type && ['ingress', 'egress'].includes(doc.type) ? doc.type : computedType;

  return {
    id: doc.id || extractReferenceId(doc._id),
    itemId: extractReferenceId(doc.item),
    item: isValuePopulated(doc.item)
      ? {
          id: extractReferenceId(doc.item),
          code: doc.item.code,
          description: doc.item.description
        }
      : null,
    type,
    fromLocationId: extractReferenceId(fromLocationValue),
    fromLocation: populatedFrom ? serializeLocationSummary(populatedFrom) : null,
    toLocationId: extractReferenceId(toLocationValue),
    toLocation: populatedTo ? serializeLocationSummary(populatedTo) : null,
    quantity: normalizeStoredQuantity(doc.quantity),
    reason: doc.reason,
    requestedBy: isValuePopulated(doc.requestedBy)
      ? serializeUserSummary(doc.requestedBy)
      : extractReferenceId(doc.requestedBy),
    requestedAt: doc.requestedAt,
    status: doc.status,
    approvedBy: isValuePopulated(doc.approvedBy)
      ? serializeUserSummary(doc.approvedBy)
      : extractReferenceId(doc.approvedBy),
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

async function resolveItemIdentifier(rawValue) {
  if (typeof rawValue !== 'string') {
    return null;
  }
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }
  if (Types.ObjectId.isValid(trimmed)) {
    return trimmed;
  }
  const item = await Item.findOne({ code: new RegExp(`^${escapeRegex(trimmed)}$`, 'i') })
    .select('_id')
    .lean();
  return item ? item._id : null;
}

const router = express.Router();

router.get(
  '/items',
  requireAuth,
  asyncHandler(async (req, res) => {
    ensureStockAccess(req);
    const {
      search,
      groupId,
      gender,
      size,
      color,
      limit: rawLimit
    } = req.query || {};

    const filter = {};
    const normalizedGroupId = typeof groupId === 'string' ? groupId.trim() : '';
    if (normalizedGroupId) {
      const groupIds = await collectGroupAndDescendantIds(normalizedGroupId);
      const groupFilterValues = buildGroupFilterValues(groupIds);
      if (groupFilterValues.length === 0) {
        return res.json([]);
      }
      filter.group = { $in: groupFilterValues };
    }

    const attributeFilters = {};
    const genderMatcher = buildAttributeMatcher(gender);
    if (genderMatcher) {
      attributeFilters['attributes.gender'] = genderMatcher;
    }
    const sizeMatcher = buildAttributeMatcher(size);
    if (sizeMatcher) {
      attributeFilters['attributes.size'] = sizeMatcher;
    }
    const colorMatcher = buildAttributeMatcher(color);
    if (colorMatcher) {
      attributeFilters['attributes.color'] = colorMatcher;
    }
    Object.assign(filter, attributeFilters);

    const normalizedSearch = typeof search === 'string' ? search.trim() : '';
    if (normalizedSearch) {
      const regex = new RegExp(escapeRegex(normalizedSearch), 'i');
      filter.$or = [{ code: regex }, { description: regex }];
    }

    // El tope anterior de 500 artículos impedía buscar códigos que quedaban
    // fuera del lote inicial. Aumentamos el límite máximo para permitir
    // listar artículos con stock que hoy no aparecían en los combos.
    const limit = Math.min(Math.max(parseInt(rawLimit, 10) || 200, 1), 2000);

    const items = await Item.find(filter)
      .sort({ code: 1 })
      .limit(limit)
      .select({ code: 1, description: 1, attributes: 1, group: 1, stock: 1 });

    const serialized = items.map(item => ({
      id: item.id,
      code: item.code,
      description: item.description,
      groupId: item.group ? String(item.group) : null,
      attributes:
        item.attributes instanceof Map
          ? Object.fromEntries(item.attributes)
          : item.attributes || {},
      stock: serializeStock(item.stock)
    }));

    res.json(serialized);
  })
);

router.delete(
  '/request/:id',
  requirePermission('stock.approve'),
  asyncHandler(async (req, res) => {
    if (req.user?.role !== 'Administrador') {
      throw new HttpError(403, 'Solo un administrador puede eliminar solicitudes');
    }

    const { id } = req.params;
    const request = await MovementRequest.findById(id);
    if (!request) {
      throw new HttpError(404, 'Solicitud no encontrada');
    }

    await Promise.all([
      MovementLog.deleteMany({ movementRequest: request.id }),
      request.deleteOne()
    ]);

    await recordAuditEvent({
      action: 'Solicitud de movimiento',
      request: 'Eliminación de solicitud',
      user: req.user?.username || 'Desconocido'
    });

    res.status(204).send();
  })
);

router.post(
  '/request',
  requirePermission('stock.request'),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const { quantity, fromLocation, toLocation } = await validateMovementPayload(body);
    await findItemOrThrow(body.itemId);

    const movementType = determineMovementType(fromLocation, toLocation);

    const movementRequest = new MovementRequest({
      item: body.itemId,
      type: movementType,
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
    await recordAuditEvent({
      action: 'Solicitud de movimiento',
      request: 'Nueva solicitud',
      user: req.user?.username || 'Desconocido'
    });

    const populated = await movementRequest.populate([
      'item',
      { path: 'requestedBy', populate: 'role' },
      { path: 'approvedBy', populate: 'role' },
      'fromLocation',
      'toLocation'
    ]);
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
    await recordAuditEvent({
      action: 'Solicitud de movimiento',
      request: 'Aprobación de solicitud',
      user: req.user?.username || 'Desconocido'
    });
    const populated = await request.populate([
      'item',
      { path: 'requestedBy', populate: 'role' },
      { path: 'approvedBy', populate: 'role' },
      'fromLocation',
      'toLocation'
    ]);
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
    await recordAuditEvent({
      action: 'Solicitud de movimiento',
      request: 'Rechazo de solicitud',
      user: req.user?.username || 'Desconocido'
    });
    const populated = await request.populate([
      'item',
      { path: 'requestedBy', populate: 'role' },
      { path: 'approvedBy', populate: 'role' },
      'fromLocation',
      'toLocation'
    ]);
    res.json(serializeMovementRequest(populated));
  })
);

router.get(
  '/requests',
  requireAuth,
  asyncHandler(async (req, res) => {
    ensureStockAccess(req);
    const { status, type, from, to, itemId, itemCode, requestedBy, profile } = req.query || {};
    const filter = {};
    const normalizedType = typeof type === 'string' ? type.trim() : '';
    if (status) {
      filter.status = status;
    }
    const normalizedItemId = typeof itemId === 'string' ? itemId.trim() : '';
    const normalizedItemCode = typeof itemCode === 'string' ? itemCode.trim() : '';
    if (normalizedItemId || normalizedItemCode) {
      const resolvedFromId = normalizedItemId ? await resolveItemIdentifier(normalizedItemId) : null;
      const resolvedFromCode = normalizedItemCode ? await resolveItemIdentifier(normalizedItemCode) : null;

      if (normalizedItemId && !resolvedFromId) {
        return res.json([]);
      }

      if (normalizedItemCode && !resolvedFromCode) {
        return res.json([]);
      }

      let effectiveItem = resolvedFromId || resolvedFromCode;
      if (resolvedFromId && resolvedFromCode && String(resolvedFromId) !== String(resolvedFromCode)) {
        return res.json([]);
      }

      if (effectiveItem) {
        filter.item = effectiveItem;
      }
    }
    if (normalizedType) {
      if (['ingress', 'egress'].includes(normalizedType)) {
        filter.type = { $in: [normalizedType, 'transfer'] };
      } else if (['transfer'].includes(normalizedType)) {
        filter.type = normalizedType;
      }
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
      filter.requestedAt = range;
    }
    const normalizedRequester = typeof requestedBy === 'string' ? requestedBy.trim() : '';
    const normalizedProfile = typeof profile === 'string' ? profile.trim() : '';

    let requesterFilter = null;
    if (normalizedRequester) {
      if (Types.ObjectId.isValid(normalizedRequester)) {
        requesterFilter = normalizedRequester;
      } else {
        const requesterDoc = await User.findOne({
          $or: [
            { username: new RegExp(`^${escapeRegex(normalizedRequester)}$`, 'i') },
            { email: new RegExp(`^${escapeRegex(normalizedRequester)}$`, 'i') }
          ]
        })
          .select('_id')
          .lean();
        if (!requesterDoc) {
          return res.json([]);
        }
        requesterFilter = requesterDoc._id;
      }
    }

    if (normalizedProfile) {
      let roleId = null;
      if (Types.ObjectId.isValid(normalizedProfile)) {
        roleId = normalizedProfile;
      } else {
        const roleDoc = await Role.findOne({ name: new RegExp(`^${escapeRegex(normalizedProfile)}$`, 'i') })
          .select('_id')
          .lean();
        roleId = roleDoc?._id || null;
      }

      if (!roleId) {
        return res.json([]);
      }

      const roleUserIds = await User.find({ role: roleId })
        .select('_id')
        .lean();
      const allowedIds = new Set(roleUserIds.map(doc => String(doc._id)));

      if (requesterFilter) {
        if (!allowedIds.has(String(requesterFilter))) {
          return res.json([]);
        }
        filter.requestedBy = requesterFilter;
      } else {
        if (allowedIds.size === 0) {
          return res.json([]);
        }
        filter.requestedBy = { $in: Array.from(allowedIds) };
      }
    } else if (requesterFilter) {
      filter.requestedBy = requesterFilter;
    }

    const requests = await MovementRequest.find(filter)
      .populate([
        'item',
        { path: 'requestedBy', populate: 'role' },
        { path: 'approvedBy', populate: 'role' },
        'fromLocation',
        'toLocation'
      ])
      .sort({ requestedAt: -1 });
    const serialized = requests.map(serializeMovementRequest);
    const filteredByType =
      normalizedType && ['transfer', 'ingress', 'egress'].includes(normalizedType)
        ? serialized.filter(request => request.type === normalizedType)
        : serialized;
    res.json(filteredByType);
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
    await recordAuditEvent({
      action: 'Solicitud de movimiento',
      request: 'Reenvío de solicitud',
      user: req.user?.username || 'Desconocido'
    });
    const populated = await request.populate([
      'item',
      { path: 'requestedBy', populate: 'role' },
      { path: 'approvedBy', populate: 'role' },
      'fromLocation',
      'toLocation'
    ]);
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
