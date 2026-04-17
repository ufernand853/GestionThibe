function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

function computeCheckDigit(base12) {
  if (!/^\d{12}$/.test(base12)) {
    return null;
  }

  let sum = 0;
  for (let index = 0; index < base12.length; index += 1) {
    const digit = Number(base12[index]);
    const position = index + 1;
    sum += position % 2 === 0 ? digit * 3 : digit;
  }

  return String((10 - (sum % 10)) % 10);
}

export function buildItemEan13(sku, _unitsPerBox) {
  const skuDigits = onlyDigits(sku);
  if (!skuDigits) {
    return '';
  }

  const skuSegment = skuDigits.padStart(6, '0').slice(-6);
  const unitsSegment = '0000';
  const base12 = `04${skuSegment}${unitsSegment}`;
  const checkDigit = computeCheckDigit(base12);

  if (checkDigit === null) {
    return '';
  }

  return `${base12}${checkDigit}`;
}
