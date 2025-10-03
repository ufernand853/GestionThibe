const mongoose = require('mongoose');
const Item = require('../models/Item');
const Customer = require('../models/Customer');
const CustomerStock = require('../models/CustomerStock');
const MovementLog = require('../models/MovementLog');
const { HttpError } = require('../utils/errors');

const STOCK_LISTS = new Set(['general', 'overstockGeneral', 'overstockThibe', 'overstockArenal']);
const ZERO_QUANTITY = Object.freeze({ boxes: 0, units: 0 });

function validateListName(list) {
  if (!STOCK_LISTS.has(list)) {
    throw new HttpError(400, `Lista de stock inválida: ${list}`);
  }
}

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
    // Como último recurso, evita que cantidades antiguas en formato inesperado rompan la operación.
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

async function ensureCustomerExists(customerId) {
  if (!mongoose.Types.ObjectId.isValid(customerId)) {
    throw new HttpError(404, 'Cliente no encontrado');
  }
  const customer = await Customer.findById(customerId);
  if (!customer) {
    throw new HttpError(404, 'Cliente no encontrado');
  }
  if (customer.status === 'inactive') {
    throw new HttpError(400, 'El cliente está inactivo');
  }
  return customer;
}

function adjustItemStock(item, list, delta) {
  validateListName(list);
  if (!item.stock || typeof item.stock !== 'object') {
    item.stock = {};
  }
  const current = normalizeStoredQuantity(item.stock[list]);
  const updated = combineQuantities(current, delta, 'Stock insuficiente');
  item.stock[list] = updated;
}

function normalizeBoxLabel(boxLabel) {
  if (boxLabel === undefined || boxLabel === null) {
    return null;
  }
  const normalized = String(boxLabel).trim();
  return normalized.length > 0 ? normalized : null;
}

async function getOrCreateReservation(customerId, itemId, boxLabel) {
  const normalizedBox = normalizeBoxLabel(boxLabel);
  let reservation = await CustomerStock.findOne({
    customer: customerId,
    item: itemId,
    status: 'reserved',
    boxLabel: normalizedBox
  });
  if (!reservation) {
    reservation = new CustomerStock({
      customer: customerId,
      item: itemId,
      quantity: { ...ZERO_QUANTITY },
      status: 'reserved',
      dateCreated: new Date(),
      dateDelivered: null,
      boxLabel: normalizedBox
    });
  } else {
    reservation.quantity = normalizeStoredQuantity(reservation.quantity);
    if (reservation.boxLabel !== normalizedBox) {
      reservation.boxLabel = normalizedBox;
    }
  }
  return reservation;
}

async function findReservationOrThrow(customerId, itemId, boxLabel) {
  const normalizedBox = normalizeBoxLabel(boxLabel);
  const reservation = await CustomerStock.findOne({
    customer: customerId,
    item: itemId,
    status: 'reserved',
    boxLabel: normalizedBox
  });
  if (!reservation) {
    if (normalizedBox) {
      throw new HttpError(400, `No hay stock reservado para la caja ${normalizedBox}.`);
    }
    throw new HttpError(400, 'Stock reservado insuficiente para el cliente');
  }
  reservation.quantity = normalizeStoredQuantity(reservation.quantity);
  return reservation;
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

  if (request.type === 'in') {
    if (request.toList === 'customer') {
      if (!request.customer) {
        throw new HttpError(400, 'Debe indicarse el cliente');
      }
      await ensureCustomerExists(request.customer);
      const reservation = await getOrCreateReservation(request.customer, item.id, request.boxLabel);
      reservation.quantity = combineQuantities(reservation.quantity, quantity);
      reservation.status = 'reserved';
      reservation.dateCreated = new Date();
      reservation.boxLabel = normalizeBoxLabel(request.boxLabel);
      await reservation.save();
    } else {
      if (!request.toList) {
        throw new HttpError(400, 'Los ingresos requieren lista destino');
      }
      adjustItemStock(item, request.toList, quantity);
      await item.save();
    }
  } else if (request.type === 'out') {
    if (!request.fromList) {
      throw new HttpError(400, 'Las salidas requieren lista origen');
    }
    if (request.fromList === 'customer') {
      if (!request.customer) {
        throw new HttpError(400, 'Debe indicarse el cliente');
      }
      await ensureCustomerExists(request.customer);
      const reservation = await findReservationOrThrow(request.customer, item.id, request.boxLabel);
      reservation.quantity = combineQuantities(
        reservation.quantity,
        negateQuantity(quantity),
        'Stock reservado insuficiente para el cliente'
      );
      if (isZeroQuantity(reservation.quantity)) {
        reservation.status = 'delivered';
        reservation.dateDelivered = new Date();
      }
      reservation.boxLabel = normalizeBoxLabel(request.boxLabel);
      await reservation.save();
    } else {
      adjustItemStock(item, request.fromList, negateQuantity(quantity));
      await item.save();
    }
  } else if (request.type === 'transfer') {
    if (!request.fromList || !request.toList) {
      throw new HttpError(400, 'Las transferencias requieren listas origen y destino');
    }
    if (request.fromList === 'customer') {
      if (!request.customer) {
        throw new HttpError(400, 'Debe indicarse el cliente');
      }
      await ensureCustomerExists(request.customer);
      const reservation = await findReservationOrThrow(request.customer, item.id, request.boxLabel);
      reservation.quantity = combineQuantities(
        reservation.quantity,
        negateQuantity(quantity),
        'Stock reservado insuficiente'
      );
      if (request.toList === 'customer') {
        reservation.status = 'delivered';
        reservation.dateDelivered = new Date();
        reservation.boxLabel = normalizeBoxLabel(request.boxLabel);
        await reservation.save();
      } else {
        if (isZeroQuantity(reservation.quantity)) {
          await reservation.deleteOne();
        } else {
          reservation.boxLabel = normalizeBoxLabel(request.boxLabel);
          await reservation.save();
        }
        adjustItemStock(item, request.toList, quantity);
        await item.save();
      }
    } else {
      adjustItemStock(item, request.fromList, negateQuantity(quantity));
      await item.save();
      if (request.toList === 'customer') {
        if (!request.customer) {
          throw new HttpError(400, 'Debe indicarse el cliente');
        }
        await ensureCustomerExists(request.customer);
        const reservation = await getOrCreateReservation(request.customer, item.id, request.boxLabel);
        reservation.quantity = combineQuantities(reservation.quantity, quantity);
        reservation.status = 'reserved';
        reservation.dateCreated = new Date();
        reservation.boxLabel = normalizeBoxLabel(request.boxLabel);
        await reservation.save();
      } else {
        adjustItemStock(item, request.toList, quantity);
        await item.save();
      }
    }
  } else {
    throw new HttpError(400, `Tipo de movimiento no soportado: ${request.type}`);
  }

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

function validateMovementPayload(payload) {
  if (!payload.itemId) {
    throw new HttpError(400, 'Debe indicarse itemId');
  }
  if (!payload.type) {
    throw new HttpError(400, 'Debe indicarse type');
  }
  const quantity = normalizeQuantityInput(payload.quantity, { fieldName: 'Cantidad' });
  if (payload.fromList && payload.fromList !== 'customer') {
    validateListName(payload.fromList);
  }
  if (payload.toList && payload.toList !== 'customer') {
    validateListName(payload.toList);
  }
  if (payload.type === 'in' && !payload.toList) {
    throw new HttpError(400, 'Los ingresos requieren lista destino');
  }
  if (payload.type === 'out' && !payload.fromList) {
    throw new HttpError(400, 'Las salidas requieren lista origen');
  }
  if (payload.type === 'transfer' && (!payload.fromList || !payload.toList)) {
    throw new HttpError(400, 'Las transferencias requieren listas origen y destino');
  }
  const customerInteraction = payload.fromList === 'customer' || payload.toList === 'customer';
  if (customerInteraction && !payload.customerId) {
    throw new HttpError(400, 'Debe indicarse customerId para operar con reservas');
  }
  if (payload.boxLabel !== undefined && payload.boxLabel !== null) {
    if (typeof payload.boxLabel !== 'string') {
      throw new HttpError(400, 'La etiqueta de caja debe ser texto');
    }
    if (payload.boxLabel.trim().length > 100) {
      throw new HttpError(400, 'La etiqueta de caja no puede superar los 100 caracteres');
    }
  }

  return { quantity };
}

module.exports = {
  validateMovementPayload,
  executeMovement,
  addMovementLog,
  ensureCustomerExists,
  findItemOrThrow,
  STOCK_LISTS,
  normalizeQuantityInput,
  normalizeStoredQuantity
};
