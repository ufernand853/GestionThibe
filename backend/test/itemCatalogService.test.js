const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPositiveStockFilters } = require('../src/services/itemCatalogService');

test('crea filtros positivos para los campos de stock indicados', () => {
  assert.deepEqual(buildPositiveStockFilters(['deposito'], ['boxes', 'units']), [
    { 'stock.deposito.boxes': { $gt: 0 } },
    { 'stock.deposito.units': { $gt: 0 } }
  ]);
});

test('permite filtrar artículos con unidades disponibles en locales', () => {
  assert.deepEqual(buildPositiveStockFilters(['local-centro', 'local-norte'], ['units']), [
    { 'stock.local-centro.units': { $gt: 0 } },
    { 'stock.local-norte.units': { $gt: 0 } }
  ]);
});
