function toNonNegativeInteger(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.trunc(numeric));
}

function coerceQuantity(value) {
  if (value === undefined || value === null) {
    return { boxes: 0, units: 0 };
  }

  if (typeof value === 'number') {
    return { boxes: 0, units: toNonNegativeInteger(value) };
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return { boxes: 0, units: 0 };
    }
    return { boxes: 0, units: toNonNegativeInteger(trimmed) };
  }

  if (typeof value === 'object') {
    const boxes = toNonNegativeInteger(value.boxes);
    const units = toNonNegativeInteger(value.units);
    return { boxes, units };
  }

  return { boxes: 0, units: 0 };
}

module.exports = { coerceQuantity };
