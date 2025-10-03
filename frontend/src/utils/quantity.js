export function ensureQuantity(quantity) {
  if (quantity === undefined || quantity === null) {
    return { boxes: 0, units: 0 };
  }
  if (typeof quantity === 'number') {
    return { boxes: 0, units: Math.max(0, Math.trunc(quantity)) };
  }
  const boxes = Number(quantity.boxes ?? 0);
  const units = Number(quantity.units ?? 0);
  return {
    boxes: Number.isFinite(boxes) ? Math.max(0, Math.trunc(boxes)) : 0,
    units: Number.isFinite(units) ? Math.max(0, Math.trunc(units)) : 0
  };
}

export function sumQuantities(...quantities) {
  return quantities.reduce(
    (acc, current) => {
      const normalized = ensureQuantity(current);
      return {
        boxes: acc.boxes + normalized.boxes,
        units: acc.units + normalized.units
      };
    },
    { boxes: 0, units: 0 }
  );
}

export function subtractQuantities(base, amount) {
  const minuend = ensureQuantity(base);
  const subtrahend = ensureQuantity(amount);
  return {
    boxes: Math.max(0, minuend.boxes - subtrahend.boxes),
    units: Math.max(0, minuend.units - subtrahend.units)
  };
}

export function isQuantityZero(quantity) {
  const normalized = ensureQuantity(quantity);
  return normalized.boxes === 0 && normalized.units === 0;
}

export function formatQuantity(quantity, { compact = false } = {}) {
  const { boxes, units } = ensureQuantity(quantity);
  if (compact) {
    return `${boxes}c / ${units}u`;
  }
  return `${boxes} cajas · ${units} unidades`;
}
