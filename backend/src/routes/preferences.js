const express = require('express');
const { Types } = require('mongoose');
const asyncHandler = require('../utils/asyncHandler');
const { HttpError } = require('../utils/errors');
const { requireAuth } = require('../middlewares/auth');
const User = require('../models/User');
const Item = require('../models/Item');
const DashboardConfig = require('../models/DashboardConfig');

const ATTENTION_MANUAL_LIMIT = 5;

const router = express.Router();

function normalizeManualAttentionIds(ids) {
  if (!Array.isArray(ids)) {
    return [];
  }
  return ids
    .map(value => String(value))
    .filter((value, index, array) => array.indexOf(value) === index)
    .slice(0, ATTENTION_MANUAL_LIMIT);
}

function serializeDashboardConfig(configDoc) {
  if (!configDoc) {
    return { manualAttentionIds: [], recountThresholdDays: 0 };
  }
  return {
    manualAttentionIds: normalizeManualAttentionIds(configDoc.manualAttentionIds),
    recountThresholdDays:
      typeof configDoc.recountThresholdDays === 'number' && Number.isFinite(configDoc.recountThresholdDays)
        ? Math.max(0, Math.round(configDoc.recountThresholdDays))
        : 0,
    updatedAt: configDoc.updatedAt || null,
    updatedBy: configDoc.updatedBy
      ? {
          id: String(configDoc.updatedBy.id || configDoc.updatedBy._id || ''),
          username: configDoc.updatedBy.username || null
        }
      : null
  };
}

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) {
      throw new HttpError(404, 'Usuario no encontrado');
    }
    res.json(user.preferences || {});
  })
);

router.put(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.user.id);
    if (!user) {
      throw new HttpError(404, 'Usuario no encontrado');
    }

    const { dashboard } = req.body || {};
    if (dashboard && dashboard.manualAttentionIds !== undefined) {
      const incomingIds = normalizeManualAttentionIds(dashboard.manualAttentionIds);
      if (incomingIds.length > ATTENTION_MANUAL_LIMIT) {
        throw new HttpError(400, `Solo se permiten ${ATTENTION_MANUAL_LIMIT} artículos.`);
      }

      for (const id of incomingIds) {
        if (!Types.ObjectId.isValid(id)) {
          throw new HttpError(400, 'Identificador de artículo inválido.');
        }
      }

      const existingCount = await Item.countDocuments({ _id: { $in: incomingIds } });
      if (existingCount !== incomingIds.length) {
        throw new HttpError(400, 'Algunos artículos seleccionados no existen.');
      }

      user.preferences = user.preferences || {};
      user.preferences.dashboard = user.preferences.dashboard || {};
      user.preferences.dashboard.manualAttentionIds = incomingIds;
    }

    await user.save();
    res.json(user.preferences || {});
  })
);

router.get(
  '/dashboard/attention',
  requireAuth,
  asyncHandler(async (req, res) => {
    const config = await DashboardConfig.getSingleton();
    await config.populate('updatedBy');
    res.json(serializeDashboardConfig(config));
  })
);

router.put(
  '/dashboard/attention',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { manualAttentionIds, recountThresholdDays } = req.body || {};
    const manualAttentionProvided = manualAttentionIds !== undefined;
    const incomingIds = manualAttentionProvided ? normalizeManualAttentionIds(manualAttentionIds) : [];

    if (manualAttentionProvided) {
      if (incomingIds.length > ATTENTION_MANUAL_LIMIT) {
        throw new HttpError(400, `Solo se permiten ${ATTENTION_MANUAL_LIMIT} artículos.`);
      }

      for (const id of incomingIds) {
        if (!Types.ObjectId.isValid(id)) {
          throw new HttpError(400, 'Identificador de artículo inválido.');
        }
      }

      const existingCount = await Item.countDocuments({ _id: { $in: incomingIds } });
      if (existingCount !== incomingIds.length) {
        throw new HttpError(400, 'Algunos artículos seleccionados no existen.');
      }
    }

    const config = await DashboardConfig.getSingleton();
    if (recountThresholdDays !== undefined) {
      const numericThreshold = Number(recountThresholdDays);
      if (!Number.isFinite(numericThreshold) || numericThreshold < 0) {
        throw new HttpError(400, 'El umbral debe ser un número mayor o igual a 0.');
      }
      config.recountThresholdDays = Math.round(numericThreshold);
    }
    if (manualAttentionProvided) {
      config.manualAttentionIds = incomingIds;
    }
    config.updatedBy = req.user.id;
    await config.save();
    await config.populate('updatedBy');

    res.json(serializeDashboardConfig(config));
  })
);

module.exports = router;
