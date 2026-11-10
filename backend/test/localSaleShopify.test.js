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


test('el inventario de un borrador adoptado queda separado de las ventas locales y sus webhooks', async t => {
  const config = require('../src/config');
  const Item = require('../src/models/Item');
  const Location = require('../src/models/Location');
  const ShopifyCatalogModel = require('../src/models/ShopifyCatalogModel');
  const { applyInventoryLevelUpdate } = require('../src/services/shopifyWebhookService');
  const { dryRun, inventoryWebhookSyncEnabled } = config.shopify;
  Object.assign(config.shopify, { dryRun: false, inventoryWebhookSyncEnabled: true });
  t.after(() => Object.assign(config.shopify, { dryRun, inventoryWebhookSyncEnabled }));

  const stock = new Map([['local', { boxes: 2, units: 4 }]]);
  const item = { stock, shopify: { productId: '1234', inventoryItemId: '5678' } };
  const location = { id: 'local', shopifyLocationId: '7890' };
  const lookup = t.mock.method(ShopifyCatalogModel, 'exists', async () => ({ _id: 'modelo' }));
  t.mock.method(Item, 'findOne', async () => item);
  t.mock.method(Location, 'findOne', async () => location);

  assert.deepEqual(await syncLocalSaleInventory(item, location), { status: 'catalog_managed' });
  assert.equal((await applyInventoryLevelUpdate({ inventory_item_id: 5678, location_id: 7890, available: 0 })).status, 'ignored');
  assert.deepEqual(stock.get('local'), { boxes: 2, units: 4 });
  assert.deepEqual(lookup.mock.calls.map(call => call.arguments[0]), [
    { adoptedProductId: 'gid://shopify/Product/1234' },
    { adoptedProductId: 'gid://shopify/Product/1234' }
  ]);
});
