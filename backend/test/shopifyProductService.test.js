const test = require('node:test');
const assert = require('node:assert/strict');
const { buildVariantInput, getMappedInventoryQuantities } = require('../src/services/shopifyProductService');

test('enables Shopify inventory tracking when synchronizing the product variant', () => {
  assert.deepEqual(buildVariantInput('gid://shopify/ProductVariant/1', {
    sku: 'ART-001',
    price: 1500
  }), {
    id: 'gid://shopify/ProductVariant/1',
    price: '1500',
    inventoryItem: {
      tracked: true,
      sku: 'ART-001'
    }
  });
});

test('maps inventory from stores and non-local warehouses to Shopify locations', () => {
  const quantities = getMappedInventoryQuantities('123', {
    stockByLocation: [
      { locationName: 'Local', shopifyLocationId: '10', boxes: 1, units: 2 },
      { locationName: 'Depósito', shopifyLocationId: '20', boxes: 3, units: 4 }
    ]
  });

  assert.deepEqual(quantities, [
    {
      inventoryItemId: 'gid://shopify/InventoryItem/123',
      locationId: 'gid://shopify/Location/10',
      quantity: 3
    },
    {
      inventoryItemId: 'gid://shopify/InventoryItem/123',
      locationId: 'gid://shopify/Location/20',
      quantity: 7
    }
  ]);
});

test('skips stock whose warehouse has no Shopify mapping', () => {
  const quantities = getMappedInventoryQuantities('gid://shopify/InventoryItem/123', {
    stockByLocation: [
      { shopifyLocationId: '', boxes: 5, units: 1 },
      { shopifyLocationId: null, boxes: 2, units: 3 }
    ]
  });

  assert.deepEqual(quantities, []);
});
