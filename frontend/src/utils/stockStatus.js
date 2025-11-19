import { ensureQuantity, sumQuantities } from './quantity.js';

export const STOCK_STATUS = Object.freeze({
  UPDATED: 'updated',
  PENDING: 'pending',
  EMPTY: 'empty'
});

export const STOCK_STATUS_LABELS = Object.freeze({
  [STOCK_STATUS.UPDATED]: 'Actualizado',
  [STOCK_STATUS.PENDING]: 'Pendiente',
  [STOCK_STATUS.EMPTY]: 'Agotado'
});

function extractQuantityByField(quantity, preferredField) {
  if (!quantity || typeof quantity !== 'object') {
    return quantity;
  }

  if (preferredField && Object.prototype.hasOwnProperty.call(quantity, preferredField)) {
    return quantity[preferredField];
  }

  if (quantity.quantity && typeof quantity.quantity === 'object') {
    if (preferredField && Object.prototype.hasOwnProperty.call(quantity.quantity, preferredField)) {
      return quantity.quantity[preferredField];
    }
    return quantity.quantity;
  }

  return quantity;
}

export function computeTotalStockFromMap(
  stock,
  { preferredField = 'available', filterLocation } = {}
) {
  if (!stock || typeof stock !== 'object') {
    return { boxes: 0, units: 0 };
  }
  const entries = stock instanceof Map ? Array.from(stock.entries()) : Object.entries(stock);
  return entries.reduce((acc, [locationId, quantity]) => {
    if (filterLocation && !filterLocation(locationId, quantity)) {
      return acc;
    }
    return sumQuantities(acc, ensureQuantity(extractQuantityByField(quantity, preferredField)));
  }, { boxes: 0, units: 0 });
}

export function aggregatePendingByItem(requests = [], { filter } = {}) {
  const map = new Map();
  requests.forEach(request => {
    if (!request || request.status !== 'pending') {
      return;
    }
    if (typeof filter === 'function' && !filter(request)) {
      return;
    }
    const itemId = request.item?.id || request.itemId;
    if (!itemId) {
      return;
    }
    const quantity = ensureQuantity(request.quantity);
    const existing = map.get(itemId);
    if (existing) {
      map.set(itemId, {
        quantity: sumQuantities(existing.quantity, quantity),
        count: existing.count + 1
      });
    } else {
      map.set(itemId, { quantity, count: 1 });
    }
  });
  return map;
}

export function deriveStockStatus(totalQuantity, pendingInfo) {
  const total = ensureQuantity(totalQuantity);
  const pendingQuantity = ensureQuantity(pendingInfo?.quantity);
  const subtractPending = pendingInfo?.subtractFromTotal ?? true;
  const pendingCount = pendingInfo?.count ?? 0;
  const hasStock = total.boxes > 0 || total.units > 0;
  const hasPending = pendingQuantity.boxes > 0 || pendingQuantity.units > 0;
  const pendingBoxes = subtractPending ? pendingQuantity.boxes : 0;
  const pendingUnits = subtractPending ? pendingQuantity.units : 0;
  const remainingBoxes = total.boxes - pendingBoxes;
  const remainingUnits = total.units - pendingUnits;
  const remaining = {
    boxes: Math.max(0, remainingBoxes),
    units: Math.max(0, remainingUnits)
  };

  if (!hasStock) {
    return {
      code: STOCK_STATUS.EMPTY,
      label: STOCK_STATUS_LABELS[STOCK_STATUS.EMPTY],
      detail: 'Sin stock disponible',
      pendingCount,
      remaining,
      pendingQuantity
    };
  }

  if (!hasPending) {
    return {
      code: STOCK_STATUS.UPDATED,
      label: STOCK_STATUS_LABELS[STOCK_STATUS.UPDATED],
      detail: 'Stock disponible',
      pendingCount,
      remaining,
      pendingQuantity
    };
  }

  if (remainingBoxes <= 0 && remainingUnits <= 0) {
    return {
      code: STOCK_STATUS.EMPTY,
      label: STOCK_STATUS_LABELS[STOCK_STATUS.EMPTY],
      detail:
        pendingCount === 0
          ? 'Sin stock disponible'
          : pendingCount === 1
            ? 'Reservado en 1 solicitud pendiente'
            : `Reservado en ${pendingCount} solicitudes pendientes`,
      pendingCount,
      remaining,
      pendingQuantity
    };
  }

  return {
    code: STOCK_STATUS.UPDATED,
    label: STOCK_STATUS_LABELS[STOCK_STATUS.UPDATED],
    detail:
      pendingCount === 0
        ? 'Stock disponible'
        : pendingCount === 1
          ? 'Stock disponible con 1 solicitud pendiente'
          : `Stock disponible con ${pendingCount} solicitudes pendientes`,
    pendingCount,
    remaining,
    pendingQuantity
  };
}

export function stockStatusClassName(code) {
  const suffix =
    code && typeof code === 'string' ? code.toLowerCase() : STOCK_STATUS.UPDATED;
  return `stock-indicator stock-indicator--${suffix}`;
}
