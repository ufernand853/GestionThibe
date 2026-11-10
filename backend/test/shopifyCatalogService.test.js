const assert = require('node:assert/strict');
const { test } = require('node:test');
const config = require('../src/config');
const { getCatalogAvailability, normalizeCatalogInput } = require('../src/services/shopifyCatalogService');
const { syncCatalogDraft } = require('../src/services/shopifyCatalogDraftService');

const mediumId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const largeId = 'bbbbbbbbbbbbbbbbbbbbbbbb';

function modelInput() {
  return {
    code: ' fy01 ',
    title: 'Jean recto',
    variants: [
      { itemId: mediumId, color: 'Negro', size: 'M' },
      { itemId: largeId, color: 'negro', size: 'L' }
    ],
    galleries: [{ color: 'NEGRO', images: ['/uploads/items/negro.jpg'] }],
    boxes: [
      { label: 'Caja A', opened: false, quantities: [{ itemId: mediumId, units: 2 }] },
      { label: 'Caja B', opened: true, quantities: [{ itemId: mediumId, units: 1 }] }
    ]
  };
}

test('calcula cada variante con cajas y reservas sin crear combinaciones ni usar stock de locales', () => {
  const model = normalizeCatalogInput(modelInput(), 'https://example.com');
  assert.equal(model.code, 'FY01');
  assert.equal(model.variants[1].color, 'Negro');
  assert.deepEqual(model.galleries, [{ color: 'Negro', images: ['https://example.com/uploads/items/negro.jpg'] }]);
  const order = { itemId: mediumId, units: 3, status: 'reserved' };
  assert.deepEqual([...getCatalogAvailability({ ...model, testOrders: [order] })], [[mediumId, 0], [largeId, 0]]);
  order.status = 'cancelled';
  assert.equal(getCatalogAvailability({ ...model, testOrders: [order] }).get(mediumId), 3);
});

test('rechaza combinaciones, cajas y conteos duplicados', () => {
  const input = modelInput();
  input.variants[1].size = 'm';
  assert.throws(() => normalizeCatalogInput(input, 'https://example.com'), /combinación/);
  input.variants[1].size = 'L';
  input.boxes[1].label = 'caja a';
  assert.throws(() => normalizeCatalogInput(input, 'https://example.com'), /caja .* repetida/i);
  input.boxes[1].label = 'Caja B';
  input.boxes[1].quantities.push({ itemId: mediumId, units: 1 });
  assert.throws(() => normalizeCatalogInput(input, 'https://example.com'), /variantes de la caja/);
});

test('sincroniza un borrador con SKU intactos, cero explícito y fotos compartidas por color', async t => {
  const previousLocation = config.shopify.defaultLocationId;
  config.shopify.defaultLocationId = '1234';
  t.after(() => { config.shopify.defaultLocationId = previousLocation; });
  const model = { ...normalizeCatalogInput(modelInput(), 'https://example.com'), _id: 'catalogo' };
  const items = new Map([
    [mediumId, { sku: '00042', pDecimal: 12 }],
    [largeId, { sku: '00043', pDecimal: 12 }]
  ]);
  const variants = [{ id: 'v1', sku: '00042' }, { id: 'v2', sku: '00043' }];
  const mediaId = 'gid://shopify/MediaImage/1';
  const productId = 'gid://shopify/Product/1';
  const graphql = t.mock.fn(async (query, vars) => {
    if (query.includes('productByIdentifier')) {
      assert.deepEqual(vars.identifier, { handle: 'gestionthibe-modelo-catalogo' });
      return { productByIdentifier: { id: productId, status: 'DRAFT', variants: { nodes: variants, pageInfo: { hasNextPage: false } } } };
    }
    if (query.includes('FindThibeImage')) return { files: { nodes: [{ id: mediaId, fileStatus: 'READY' }] } };
    if (query.includes('productSet')) {
      assert.deepEqual(vars.identifier, { id: productId });
      assert.equal(vars.input.status, 'DRAFT');
      assert.deepEqual(vars.input.files, [{ id: mediaId }]);
      assert.deepEqual(vars.input.variants.map(variant => ({
        id: variant.id,
        sku: variant.sku,
        quantity: variant.inventoryQuantities[0].quantity,
        photo: variant.file.id,
        policy: variant.inventoryPolicy
      })), [
        { id: 'v1', sku: '00042', quantity: 3, photo: mediaId, policy: 'DENY' },
        { id: 'v2', sku: '00043', quantity: 0, photo: mediaId, policy: 'DENY' }
      ]);
      return { productSet: { product: { id: productId, variants: { nodes: variants } }, userErrors: [] } };
    }
    if (query.includes('nodes(ids:')) {
      return { nodes: variants.map(variant => ({ ...variant, media: { nodes: [{ id: mediaId }] } })) };
    }
    assert.fail('La consulta a Shopify no era esperada');
  });
  assert.equal(await syncCatalogDraft(model, items, graphql), productId);
  assert.equal(graphql.mock.callCount(), 4);

  const active = t.mock.fn(async () => ({ productByIdentifier: { id: productId, status: 'ACTIVE' } }));
  await assert.rejects(syncCatalogDraft(model, items, active), /solo sincroniza borradores/);
  assert.equal(active.mock.callCount(), 1);
});
