const test = require('node:test');
const assert = require('node:assert/strict');

const { syncLocalSaleInventory } = require('../src/services/shopifyProductService');

test('omite Shopify cuando el artículo no está vinculado', async () => {
  const result = await syncLocalSaleInventory({ shopify: {} }, { shopifyLocationId: '123' });
  assert.deepEqual(result, { status: 'not_linked' });
});

test('omite Shopify cuando el local no tiene ubicación mapeada', async () => {
  const result = await syncLocalSaleInventory(
    { shopify: { inventoryItemId: 'gid://shopify/InventoryItem/1' } },
    { shopifyLocationId: null }
  );
  assert.deepEqual(result, { status: 'location_not_mapped' });
});
