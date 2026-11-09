const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildProductInput,
  buildVariantInput,
  getShopifyCollectionTag,
  getMappedInventoryQuantities,
  isShopifyProductNotFoundError,
  normalizeOptions
} = require('../src/services/shopifyProductService');

test('maps internal categories to Shopify collection tags', () => {
  const cases = {
    'ROPA DAMA': 'MUJER',
    'CAMISETA HOMBRE': 'HOMBRE',
    'JEAN NIÑO/A': 'NIÑOS',
    CALZADO: 'CALZADO',
    BAZAR: 'BAZAR',
    ELECTRONICOS: 'ELECTRONICA',
    SABANAS: 'HOGAR'
  };

  Object.entries(cases).forEach(([category, collection]) => {
    assert.equal(getShopifyCollectionTag(category), collection);
  });
});

test('normalizes category casing and leaves unmapped categories without a collection tag', () => {
  assert.equal(getShopifyCollectionTag('  ropa dama  '), 'MUJER');
  assert.equal(getShopifyCollectionTag('ACCESORIOS'), null);
  assert.equal(getShopifyCollectionTag('NOVEDADES'), null);
  assert.equal(getShopifyCollectionTag(null), null);
});

test('adds the mapped collection tag without replacing product type or existing tags', () => {
  const input = buildProductInput({
    title: 'Remera',
    sku: 'REM-002',
    productType: 'CAMISETA DAMA',
    tags: ['Negro', 'MUJER']
  }, 'active');

  assert.equal(input.productType, 'CAMISETA DAMA');
  assert.deepEqual(input.tags, ['REM-002', 'CAMISETA DAMA', 'MUJER', 'Negro']);
});

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
      quantity: 2
    },
    {
      inventoryItemId: 'gid://shopify/InventoryItem/123',
      locationId: 'gid://shopify/Location/20',
      quantity: 4
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

test('updates the linked variant and clears a mapped Shopify location with no loose units', async t => {
  const config = require('../src/config');
  const { syncShopifyProduct } = require('../src/services/shopifyProductService');
  const originalConfig = { ...config.shopify };
  const originalFetch = global.fetch;
  t.after(() => {
    Object.assign(config.shopify, originalConfig);
    global.fetch = originalFetch;
  });
  Object.assign(config.shopify, { shopDomain: 'test.myshopify.com', adminAccessToken: 'mock-token' });
  const productId = 'gid://shopify/Product/1';
  const variantId = 'gid://shopify/ProductVariant/2';
  const inventoryItemId = 'gid://shopify/InventoryItem/3';
  const variant = { id: variantId, sku: 'SKU-1', inventoryItem: { id: inventoryItemId }, selectedOptions: [{ name: 'Size', value: 'M' }] };
  const requests = [];
  global.fetch = async (_url, request) => {
    const { query, variables } = JSON.parse(request.body);
    const operation = query.match(/(?:query|mutation) (\w+)/)[1];
    requests.push(operation);
    const responses = {
      ProductForSync: () => ({ product: { id: productId, status: 'ACTIVE', options: [{ id: 'gid://shopify/ProductOption/4', name: 'Size', values: ['M'] }], variants: { nodes: [variant] } }, node: { ...variant, product: { id: productId } } }),
      AddProductOptionValue: () => {
        assert.deepEqual(variables.values, [{ name: 'L' }]);
        return { productOptionUpdate: { userErrors: [] } };
      },
      productUpdate: () => {
        assert.equal(variables.product.status, 'ACTIVE');
        assert.equal(variables.product.descriptionHtml, undefined);
        return { productUpdate: { product: { id: productId, status: 'ACTIVE' }, userErrors: [] } };
      },
      productVariantsBulkUpdate: () => {
        assert.equal(variables.variants[0].id, variantId);
        assert.deepEqual(variables.variants[0].optionValues, [{ optionName: 'Size', name: 'L' }]);
        return { productVariantsBulkUpdate: { productVariants: [variant], userErrors: [] } };
      },
      InventoryLevelAvailable: () => ({ inventoryItem: { inventoryLevel: { quantities: [{ name: 'available', quantity: 4 }] } } }),
      InventorySet: () => {
        assert.deepEqual(variables.input.quantities, [{ inventoryItemId, locationId: 'gid://shopify/Location/10', quantity: 0, changeFromQuantity: 4 }]);
        return { inventorySetQuantities: { userErrors: [] } };
      }
    };
    assert.ok(responses[operation], operation);
    return { ok: true, json: async () => ({ data: responses[operation]() }) };
  };
  const result = await syncShopifyProduct({
    existingProductId: productId,
    existingVariantId: variantId,
    payload: { sku: 'SKU-1', title: 'Artículo', options: [{ name: 'Talle', value: 'L' }], stockByLocation: [{ shopifyLocationId: '10', boxes: 2, units: 0 }] }
  });
  assert.equal(result.status, 'active');
  assert.equal(result.inventorySync.updated, 1);
  assert.deepEqual(requests, ['ProductForSync', 'AddProductOptionValue', 'productUpdate', 'productVariantsBulkUpdate', 'InventoryLevelAvailable', 'InventorySet']);
});

test('recognizes a stale Shopify product id from mutation user errors', () => {
  const error = new Error('Shopify rechazó la actualización del producto');
  error.details = [{ field: ['product', 'id'], message: 'Product does not exist' }];

  assert.equal(isShopifyProductNotFoundError(error), true);
});

test('does not treat unrelated Shopify failures as a missing product', () => {
  const error = new Error('Shopify respondió con error HTTP 401');

  assert.equal(isShopifyProductNotFoundError(error), false);
});
