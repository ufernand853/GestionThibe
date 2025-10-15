const mongoose = require('mongoose');
const Item = require('../models/Item');
const Deposit = require('../models/Deposit');
const MovementLog = require('../models/MovementLog');
const { HttpError } = require('../utils/errors');

const ZERO_QUANTITY = Object.freeze({ boxes: 0, units: 0 });

function parseQuantityComponent(value, label) {
  if (value === undefined || value === null || value === '') {
    return 0;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || !Number.isInteger(numeric)) {
    throw new HttpError(400, `${label} debe ser un número entero mayor o igual a 0`);
  }
  return numeric;
}

function normalizeQuantityInput(value, { allowZero = false, fieldName = 'Cantidad' } = {}) {
  if (value === undefined || value === null || value === '') {
    if (allowZero) {
      return { ...ZERO_QUANTITY };
    }
    throw new HttpError(400, `${fieldName} es obligatoria`);
  }

  if (typeof value === 'number' || typeof value === 'string') {
    const units = parseQuantityComponent(value, `${fieldName} (unidades)`);
    if (!allowZero && units === 0) {
      throw new HttpError(400, 'La cantidad debe ser mayor a 0');
    }
    return { boxes: 0, units };
  }

  if (typeof value !== 'object') {
    throw new HttpError(400, `${fieldName} inválida`);
  }

  const boxes = parseQuantityComponent(value.boxes, `${fieldName}: cajas`);
  const units = parseQuantityComponent(value.units, `${fieldName}: unidades`);

  if (!allowZero && boxes === 0 && units === 0) {
    throw new HttpError(400, 'La cantidad debe ser mayor a 0');
  }

  return { boxes, units };
}

function normalizeStoredQuantity(value) {
  if (value === undefined || value === null) {
    return { ...ZERO_QUANTITY };
  }
  try {
    return normalizeQuantityInput(value, { allowZero: true });
  } catch (error) {
    return { ...ZERO_QUANTITY };
  }
}

function negateQuantity(quantity) {
  return { boxes: -quantity.boxes, units: -quantity.units };
}

function combineQuantities(base, delta, errorMessage = 'Stock insuficiente') {
  const boxes = base.boxes + delta.boxes;
  const units = base.units + delta.units;
  if (boxes < 0 || units < 0) {
    throw new HttpError(400, errorMessage);
  }
  return { boxes, units };
}

function isZeroQuantity(quantity) {
  return quantity.boxes === 0 && quantity.units === 0;
}

async function findItemOrThrow(itemId) {
  if (!mongoose.Types.ObjectId.isValid(itemId)) {
    throw new HttpError(404, 'Artículo no encontrado');
  }
  const item = await Item.findById(itemId);
  if (!item) {
    throw new HttpError(404, 'Artículo no encontrado');
  }
  return item;
}

async function ensureDepositExists(depositId) {
  if (!mongoose.Types.ObjectId.isValid(depositId)) {
    throw new HttpError(404, 'Depósito no encontrado');
  }
  const deposit = await Deposit.findById(depositId);
  if (!deposit) {
    throw new HttpError(404, 'Depósito no encontrado');
  }
  if (deposit.status === 'inactive') {
    throw new HttpError(400, 'El depósito está inactivo');
  }
  return deposit;
}

function adjustItemStock(item, depositId, delta) {
  if (!item.stock) {
    item.stock = {};
  }
  let stockMap;
  if (item.stock instanceof Map) {
    stockMap = item.stock;
  } else {
    stockMap = new Map(Object.entries(item.stock || {}));
    item.stock = stockMap;
  }
  const current = normalizeStoredQuantity(stockMap.get(depositId));
  const updated = combineQuantities(current, delta, 'Stock insuficiente en el depósito seleccionado');
  if (isZeroQuantity(updated)) {
    stockMap.delete(depositId);
  } else {
    stockMap.set(depositId, updated);
  }
  item.markModified('stock');
}

function sanitizeMetadata(metadata = {}) {
  return Object.entries(metadata).reduce((acc, [key, value]) => {
    if (value === undefined || value === null) {
      return acc;
    }
    acc[key] = String(value);
    return acc;
  }, {});
}

async function addMovementLog(movementRequestId, action, actorUserId, metadata = {}) {
  await MovementLog.create({
    movementRequest: movementRequestId,
    action,
    actor: actorUserId,
    timestamp: new Date(),
    metadata: sanitizeMetadata(metadata)
  });
}

async function executeMovement(request, actorUserId, metadata = {}) {
  const item = await findItemOrThrow(request.item);
  const quantity = normalizeStoredQuantity(request.quantity);

  const fromDepositId = request.fromDeposit?.toString();
  const toDepositId = request.toDeposit?.toString();
  if (!fromDepositId || !toDepositId) {
    throw new HttpError(400, 'Los movimientos requieren depósitos de origen y destino válidos');
  }

  adjustItemStock(item, fromDepositId, negateQuantity(quantity));
  adjustItemStock(item, toDepositId, quantity);
  await item.save();

  request.status = 'executed';
  if (!request.approvedBy) {
    request.approvedBy = actorUserId;
  }
  if (!request.approvedAt) {
    request.approvedAt = new Date();
  }
  request.executedAt = new Date();
  await request.save();
  await addMovementLog(request.id, 'executed', actorUserId, metadata);
}

async function validateMovementPayload(payload) {
  if (!payload.itemId) {
    throw new HttpError(400, 'Debe indicarse itemId');
  }

  if (payload.type && payload.type !== 'transfer') {
    throw new HttpError(400, 'Solo se admiten transferencias entre depósitos');
  }

  const quantity = normalizeQuantityInput(payload.quantity, { fieldName: 'Cantidad' });

  if (!payload.fromDeposit) {
    throw new HttpError(400, 'Debe indicarse el depósito de origen');
  }
  if (!payload.toDeposit) {
    throw new HttpError(400, 'Debe indicarse el depósito de destino');
  }
  if (payload.fromDeposit === payload.toDeposit) {
    throw new HttpError(400, 'El depósito de origen y destino no pueden ser el mismo');
  }

  const [fromDeposit, toDeposit] = await Promise.all([
    ensureDepositExists(payload.fromDeposit),
    ensureDepositExists(payload.toDeposit)
  ]);

  return { quantity, fromDeposit, toDeposit };
}

module.exports = {
  validateMovementPayload,
  executeMovement,
  addMovementLog,
  findItemOrThrow,
  ensureDepositExists,
  normalizeQuantityInput,
  normalizeStoredQuantity
};
