const { coerceQuantity } = require('../utils/quantity');

function sumStock(stock) {
  const total = { boxes: 0, units: 0 };
  const entries = stock instanceof Map ? stock.values() : Object.values(stock || {});
  for (const quantity of entries) {
    const { boxes, units } = coerceQuantity(quantity);
    total.boxes += boxes;
    total.units += units;
  }
  return total;
}

function getShopifyStockByLocation(stock, locations) {
  const quantities = stock instanceof Map ? stock : new Map(Object.entries(stock || {}));
  const byId = new Map(locations.map(location => [String(location.id), location]));
  const ids = new Set([...quantities.keys(), ...locations.filter(location => location.shopifyLocationId).map(location => String(location.id))]);
  return [...ids].map(locationId => {
    const location = byId.get(locationId);
    return {
      locationId,
      locationName: location?.name || 'Ubicación',
      shopifyLocationId: location?.shopifyLocationId || null,
      ...coerceQuantity(quantities.get(locationId))
    };
  });
}

module.exports = { sumStock, getShopifyStockByLocation };
