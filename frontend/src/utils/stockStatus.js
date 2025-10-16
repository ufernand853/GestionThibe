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

export function computeTotalStockFromMap(stock) {
  if (!stock || typeof stock !== 'object') {
    return { boxes: 0, units: 0 };
  }
  return Object.values(stock).reduce(
    (acc, quantity) => sumQuantities(acc, ensureQuantity(quantity)),
    { boxes: 0, units: 0 }
  );
}

export function aggregatePendingByItem(requests = []) {
  const map = new Map();
  requests.forEach(request => {
    if (!request || request.status !== 'pending') {
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
  const pendingCount = pendingInfo?.count ?? 0;
  const hasStock = total.boxes > 0 || total.units > 0;
  const hasPending = pendingQuantity.boxes > 0 || pendingQuantity.units > 0;
  const remainingBoxes = total.boxes - pendingQuantity.boxes;
  const remainingUnits = total.units - pendingQuantity.units;
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
        pendingCount === 1
          ? 'Reservado en 1 solicitud pendiente'
          : `Reservado en ${pendingCount} solicitudes pendientes`,
      pendingCount,
      remaining,
      pendingQuantity
    };
  }

  return {
    code: STOCK_STATUS.PENDING,
    label: STOCK_STATUS_LABELS[STOCK_STATUS.PENDING],
    detail:
      pendingCount === 1
        ? 'Existe 1 solicitud pendiente para este artículo'
        : `Existen ${pendingCount} solicitudes pendientes`,
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
