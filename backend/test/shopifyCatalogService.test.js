const assert = require('node:assert/strict');
const { test } = require('node:test');
const config = require('../src/config');
const Location = require('../src/models/Location');
const { getCatalogAvailability, normalizeCatalogInput, getExistingBoxStock, resolveCatalogPhotoUrl, suggestOpening, validateOpeningStock, getVariantSku, validateSingleProduct } = require('../src/services/shopifyCatalogService');
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
  const model = normalizeCatalogInput(modelInput());
  assert.equal(model.code, 'FY01');
  assert.equal(model.variants[1].color, 'Negro');
  assert.deepEqual(model.galleries, [{ color: 'Negro', images: ['uploads/items/negro.jpg'] }]);
  const order = { itemId: mediumId, units: 3, status: 'reserved' };
  assert.deepEqual([...getCatalogAvailability({ ...model, testOrders: [order] })], [[mediumId, 0], [largeId, 0]]);
  order.status = 'cancelled';
  assert.equal(getCatalogAvailability({ ...model, testOrders: [order] }).get(mediumId), 3);
});

test('rechaza combinaciones, cajas y conteos duplicados', () => {
  const input = modelInput();
  input.variants[1].size = 'm';
  assert.throws(() => normalizeCatalogInput(input), /combinación/);
  input.variants[1].size = 'L';
  input.boxes[1].label = 'caja a';
  assert.throws(() => normalizeCatalogInput(input), /caja .* repetida/i);
  input.boxes[1].label = 'Caja B';
  input.boxes[1].quantities.push({ itemId: mediumId, units: 1 });
  assert.throws(() => normalizeCatalogInput(input), /variantes de la caja/);
});

test('sincroniza un borrador con SKU intactos, cero explícito y fotos compartidas por color', async t => {
  const previousLocation = config.shopify.defaultLocationId;
  const previousBackend = config.shopify.publicBackendUrl;
  config.shopify.defaultLocationId = '1234';
  config.shopify.publicBackendUrl = 'https://example.com';
  t.after(() => {
    config.shopify.defaultLocationId = previousLocation;
    config.shopify.publicBackendUrl = previousBackend;
  });
  const model = { ...normalizeCatalogInput(modelInput()), _id: 'catalogo' };
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

  config.shopify.defaultLocationId = '';
  let locations = [{ shopifyLocationId: '1234' }];
  const find = t.mock.method(Location, 'find', () => ({
    select: () => ({ limit: () => ({ lean: async () => locations }) })
  }));
  assert.equal(await syncCatalogDraft(model, items, graphql), productId);
  assert.match('Sobrestock Thibe', find.mock.calls[0].arguments[0].name);
  const [, variables] = graphql.mock.calls.findLast(call => call.arguments[0].includes('productSet')).arguments;
  assert.equal(variables.input.variants[0].inventoryQuantities[0].locationId, 'gid://shopify/Location/1234');

  locations = [{ shopifyLocationId: '1234' }, { shopifyLocationId: '5678' }];
  const callsBefore = graphql.mock.callCount();
  await assert.rejects(syncCatalogDraft(model, items, graphql), /único depósito activo/);
  assert.equal(graphql.mock.callCount(), callsBefore);

  const chosenId = 'cccccccccccccccccccccccc';
  const otherId = 'dddddddddddddddddddddddd';
  locations = [
    { _id: chosenId, name: 'Casa Azul (Thibe)', shopifyLocationId: '5678' },
    { _id: otherId, name: 'Thibe Kids', shopifyLocationId: '9012' }
  ];
  find.mock.mockImplementation(() => ({
    select: () => ({ sort: () => ({ lean: async () => locations }) })
  }));
  config.shopify.defaultLocationId = '1234';
  const beforeSend = t.mock.fn();
  await syncCatalogDraft(model, items, graphql, { selectedLocationId: chosenId, beforeSend });
  const selectedGid = 'gid://shopify/Location/5678';
  assert.deepEqual(beforeSend.mock.calls[0].arguments, [selectedGid]);
  const [, selectedVariables] = graphql.mock.calls.findLast(call => call.arguments[0].includes('productSet')).arguments;
  assert.equal(selectedVariables.input.variants[0].inventoryQuantities[0].locationId, selectedGid);
  await assert.rejects(
    syncCatalogDraft({ ...model, draftShopifyLocationId: selectedGid }, items, graphql, { selectedLocationId: otherId }),
    /ya tiene una ubicación/
  );
});


test('trae las cajas por ubicación con sus unidades por caja e ignora las unidades sueltas', () => {
  const locationId = 'cccccccccccccccccccccccc';
  const item = { unitsPerBox: 12, stock: { [locationId]: { boxes: 3, units: 4 }, [mediumId]: 10 } };
  assert.deepEqual(getExistingBoxStock(item, new Map([[locationId, 'Depósito']])), [
    { locationId, locationName: 'Depósito', boxes: 3, unitsPerBox: 12 }
  ]);
  item.unitsPerBox = null;
  assert.equal(getExistingBoxStock(item)[0].unitsPerBox, null);
});

test('identifica las cajas importadas aunque su saldo llegue a cero y rechaza importar dos veces el mismo origen', () => {
  const input = modelInput();
  const box = {
    label: '00042 · Depósito',
    sourceKey: mediumId + ':cccccccccccccccccccccccc',
    sourceBoxes: 3,
    quantities: [{ itemId: mediumId, units: 0 }]
  };
  input.boxes = [box];
  assert.deepEqual(normalizeCatalogInput(input).boxes, [{ ...box, opened: false, quantities: [] }]);
  input.boxes.push({ ...box, label: 'Mismo stock de origen' });
  assert.throws(() => normalizeCatalogInput(input), /cajas importadas/);
});

test('permite guardar una foto local y requiere el dominio público al enviarla a Shopify', () => {
  const input = modelInput();
  input.galleries[0].images = ['uploads/shopify-catalog/abc123.webp'];
  const [photo] = normalizeCatalogInput(input).galleries[0].images;
  assert.throws(() => resolveCatalogPhotoUrl(photo, ''), /URL pública/);
  assert.equal(resolveCatalogPhotoUrl(photo, 'https://example.com'), 'https://example.com/' + photo);
});


test('mantiene el texto de talle y color del SKU y admite fotos de cada color separado', () => {
  const input = modelInput();
  input.variants[0] = { itemId: mediumId, color: 'Negro/Blanco-Verde', size: 'M/L-XL' };
  input.galleries = [
    { color: 'negro', images: ['/uploads/items/negro.jpg'] },
    { color: 'blanco', images: ['/uploads/items/blanco.jpg'] },
    { color: 'verde', images: ['/uploads/items/verde.jpg'] }
  ];
  const model = normalizeCatalogInput(input);
  assert.deepEqual(model.variants[0], input.variants[0]);
  assert.deepEqual(model.galleries.map(gallery => gallery.color), ['negro', 'Blanco', 'Verde']);
  assert.equal(getCatalogAvailability(model).get(mediumId), 3);
});


test('abre un SKU mixto en combinaciones estables y reparte el saldo sin tocar el artículo', () => {
  const locationId = 'cccccccccccccccccccccccc';
  const item = {
    _id: mediumId, sku: '000488', attributes: { color: 'Blanco/Negro', size: 'M-L' },
    unitsPerBox: 12, stock: { [locationId]: { boxes: 1, units: 3 } }
  };
  const variants = suggestOpening(item);
  assert.deepEqual(variants.map(({ color, size }) => [color, size]), [
    ['Blanco', 'M'], ['Blanco', 'L'], ['Negro', 'M'], ['Negro', 'L']
  ]);
  assert.deepEqual(suggestOpening(item), variants);
  assert.equal(new Set(variants.map(row => row.sku)).size, 4);
  assert.ok(variants.every(row => row.sku.startsWith('000488-')));

  const input = {
    ...modelInput(),
    principalItemId: mediumId,
    variants: [variants[0], variants[3]],
    galleries: [],
    boxes: [{
      label: 'Caja original',
      sourceKey: mediumId + ':' + locationId,
      sourceBoxes: 1,
      quantities: [{ itemId: variants[0].itemId, units: 5 }, { itemId: variants[3].itemId, units: 7 }]
    }]
  };
  const model = normalizeCatalogInput(input);
  assert.equal(getVariantSku(model.variants[0], item), variants[0].sku);
  assert.deepEqual([...getCatalogAvailability(model).values()], [5, 7]);
  const sources = new Map([[mediumId, item]]);
  validateOpeningStock(model, sources);
  model.boxes[0].quantities[1].units = 8;
  assert.throws(() => validateOpeningStock(model, sources), /suma 13 unidades y hay 12/);
  assert.equal(item.stock[locationId].boxes, 1);
  assert.equal(item.stock[locationId].units, 3);
});

test('una combinación que ya tiene SKU conserva su código', () => {
  const [variant] = suggestOpening({ _id: mediumId, sku: '000488', attributes: { color: 'Blanco', size: 'M' } });
  assert.deepEqual(variant, { itemId: mediumId, sku: '000488', color: 'Blanco', size: 'M' });
});


test('abre las variantes cuando el operador completa el talle faltante en el catálogo', () => {
  const item = { _id: mediumId, sku: '000531', attributes: { color: 'Beige/Negro' } };
  assert.equal(suggestOpening(item).length, 1);
  assert.deepEqual(suggestOpening(item, { color: 'Beige/Negro', size: 'M' }).map(row => [row.color, row.size]), [
    ['Beige', 'M'], ['Negro', 'M']
  ]);
  assert.equal(item.attributes.size, undefined);
  assert.throws(() => suggestOpening(item, { color: 'Beige/Negro', size: '' }), /talle/);
});


test('limita los modelos nuevos a un producto y permite conservar los modelos anteriores', () => {
  const principal = { itemId: mediumId };
  const other = { itemId: largeId };
  const model = { principalItemId: mediumId, variants: [principal] };
  assert.doesNotThrow(() => validateSingleProduct(model));
  assert.throws(() => validateSingleProduct({ ...model, variants: [principal, other] }), /producto elegido/);
  const previous = { ...model, variants: [principal, other] };
  assert.doesNotThrow(() => validateSingleProduct(previous, previous));
  assert.throws(() => validateSingleProduct({ principalItemId: largeId, variants: [other] }, previous), /SKU principal/);
});


test('edita la ficha individual en borrador y registra su gestión antes de enviar inventario', async t => {
  const previousLocation = config.shopify.defaultLocationId;
  config.shopify.defaultLocationId = '1234';
  t.after(() => { config.shopify.defaultLocationId = previousLocation; });

  const productId = 'gid://shopify/Product/310';
  const item = { sku: '000323', pDecimal: 100, shopify: { productId } };
  const model = {
    _id: 'catalogo', title: 'Jean recto', principalItemId: mediumId,
    variants: [{ itemId: mediumId, color: 'Azul', size: 'M' }], boxes: [], galleries: []
  };
  const items = new Map([[mediumId, item]]);
  const beforeAdopt = t.mock.fn();
  const variant = { id: 'gid://shopify/ProductVariant/12', sku: item.sku };
  const graphql = t.mock.fn(async (query, variables) => {
    assert.deepEqual(variables.identifier, { id: productId });
    if (query.includes('productByIdentifier')) {
      return { productByIdentifier: { id: productId, status: 'DRAFT', variants: { nodes: [variant], pageInfo: { hasNextPage: false } } } };
    }
    assert.equal(beforeAdopt.mock.callCount(), 1);
    assert.equal(beforeAdopt.mock.calls[0].arguments[0], productId);
    assert.equal(variables.input.variants[0].id, variant.id);
    assert.equal(variables.input.files, undefined);
    assert.equal(variables.input.vendor, undefined);
    return { productSet: { product: { id: productId, variants: { nodes: [variant] } }, userErrors: [] } };
  });
  assert.equal(await syncCatalogDraft(model, items, graphql, { beforeAdopt }), productId);
  assert.equal(graphql.mock.callCount(), 2);

  const active = t.mock.fn(async () => ({ productByIdentifier: { id: productId, status: 'ACTIVE' } }));
  await assert.rejects(syncCatalogDraft(model, items, active, { beforeAdopt }), /solo sincroniza borradores/);
  assert.equal(beforeAdopt.mock.callCount(), 1);
  assert.equal(active.mock.callCount(), 1);
});
