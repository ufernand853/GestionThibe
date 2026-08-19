function sumStock(stock) {
  const total = { boxes: 0, units: 0 };
  const entries = stock instanceof Map ? Array.from(stock.values()) : Object.values(stock || {});
  entries.forEach(quantity => {
    total.boxes += Number(quantity?.boxes) || 0;
    total.units += Number(quantity?.units) || 0;
  });
  return total;
}

module.exports = { sumStock };
