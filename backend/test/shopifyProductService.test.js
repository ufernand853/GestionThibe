const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildProductInput,
  buildVariantInput,
  getMappedInventoryQuantities,
  normalizeOptions
} = require('../src/services/shopifyProductService');

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

test('creates named Shopify product options for size, color and gender', () => {
  const input = buildProductInput({
    title: 'Remera', sku: 'REM-001', productType: 'Remeras',
    options: [
      { name: 'Talle', value: 'M' },
      { name: 'Color', value: 'Negro' },
      { name: 'Género', value: 'Dama' }
    ]
  }, 'draft');

  assert.deepEqual(input.productOptions, [
    { name: 'Talle', values: [{ name: 'M' }] },
    { name: 'Color', values: [{ name: 'Negro' }] },
    { name: 'Género', values: [{ name: 'Dama' }] }
  ]);
  assert.equal(input.productType, 'Remeras');
});

test('selects size, color and gender on the Shopify variant', () => {
  const input = buildVariantInput('gid://shopify/ProductVariant/1', {
    options: [
      { name: 'Talle', value: 'L' },
      { name: 'Color', value: 'Azul' },
      { name: 'Género', value: 'Caballero' }
    ]
  });

  assert.deepEqual(input.optionValues, [
    { optionName: 'Talle', name: 'L' },
    { optionName: 'Color', name: 'Azul' },
    { optionName: 'Género', name: 'Caballero' }
  ]);
});

test('normalizes Shopify options and removes duplicate names', () => {
  assert.deepEqual(normalizeOptions([
    { name: ' Talle ', value: ' M ' },
    { name: 'talle', value: 'L' },
    { name: 'Color', value: '' }
  ]), [{ name: 'Talle', value: 'M' }]);
});

test('keeps the previous product payload when option attributes are absent', () => {
  const input = buildProductInput({
    title: 'Producto sin atributos',
    sku: 'GEN-001',
    productType: 'General'
  }, 'draft');

  assert.equal(Object.hasOwn(input, 'productOptions'), false);
  assert.equal(input.title, 'Producto sin atributos');
  assert.equal(input.productType, 'General');
  assert.deepEqual(input.tags, ['GEN-001', 'General']);
});

test('keeps the previous variant payload when option attributes are absent', () => {
  const input = buildVariantInput('gid://shopify/ProductVariant/2', {
    sku: 'GEN-002',
    price: 2500,
    options: null
  });

  assert.equal(Object.hasOwn(input, 'optionValues'), false);
  assert.deepEqual(input, {
    id: 'gid://shopify/ProductVariant/2',
    price: '2500',
    inventoryItem: { tracked: true, sku: 'GEN-002' }
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
