const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildNonLocalCatalogStockCondition,
  buildPositiveStockFilters
} = require('../src/services/itemCatalogService');

test('crea filtros positivos para los campos de stock indicados', () => {
  assert.deepEqual(buildPositiveStockFilters(['deposito'], ['boxes', 'units']), [
    { 'stock.deposito.boxes': { $gt: 0 } },
    { 'stock.deposito.units': { $gt: 0 } }
  ]);
});

test('el catálogo general incluye stock no local y artículos agotados', () => {
  assert.deepEqual(
    buildNonLocalCatalogStockCondition({
      nonLocalLocationIds: ['general'],
      allWarehouseLocationIds: ['general', 'local']
    }),
    {
      $or: [
        { 'stock.general.boxes': { $gt: 0 } },
        { 'stock.general.units': { $gt: 0 } },
        {
          $nor: [
            { 'stock.general.boxes': { $gt: 0 } },
            { 'stock.general.units': { $gt: 0 } },
            { 'stock.local.boxes': { $gt: 0 } },
            { 'stock.local.units': { $gt: 0 } }
          ]
        }
      ]
    }
  );
});
