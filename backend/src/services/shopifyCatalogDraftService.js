const config = require('../config');
const Location = require('../models/Location');
const { HttpError } = require('../utils/errors');
const { shopifyGraphql } = require('./shopifyProductService');
const { getOrCreateImage, getProductImages } = require('./shopifyMediaService');
const { getLinkedProductId } = require('./shopifyCatalogLinkService');
const { syncExistingCatalogVariants, variantFields } = require('./shopifyCatalogVariantService');
const { getCatalogAvailability, MAX_VARIANTS, resolveCatalogPhotoUrl, normalizeLabel, splitColors, getVariantSku } = require('./shopifyCatalogService');

function normalizeLocationId(value) {
  const location = typeof value === 'string' ? value.trim() : '';
  if (/^\d+$/.test(location)) return `gid://shopify/Location/${location}`;
  return /^gid:\/\/shopify\/Location\/\d+$/.test(location) ? location : null;
}

async function listDraftLocations() {
  const locations = await Location.find({
    type: 'warehouse',
    status: 'active',
    shopifyLocationId: { $exists: true, $nin: [null, ''] }
  }).select('name shopifyLocationId').sort({ name: 1 }).lean();
  return locations.flatMap(location => {
    const shopifyId = normalizeLocationId(location.shopifyLocationId);
    return shopifyId ? [{ id: String(location._id), name: location.name, shopifyId }] : [];
  });
}

async function resolveDraftLocationId(model, locationId) {
  if (locationId !== undefined) {
    const locations = await listDraftLocations();
    const selected = locations.find(location => location.id === locationId);
    if (!selected) throw new HttpError(400, 'Elegí una ubicación activa vinculada a Shopify.');
    if (model.draftShopifyLocationId && selected.shopifyId !== model.draftShopifyLocationId) {
      throw new HttpError(409, 'Este borrador ya tiene una ubicación de inventario asignada en Shopify.');
    }
    return selected.shopifyId;
  }
  if (model.draftShopifyLocationId) return model.draftShopifyLocationId;
  const configured = config.shopify.defaultLocationId.trim();
  let location = configured;
  if (!location) {
    const matches = await Location.find({
      name: /^(?:Thibe|Depósito Thibe|Sobrestock Thibe)$/i,
      type: 'warehouse',
      status: 'active',
      shopifyLocationId: { $exists: true, $nin: [null, ''] }
    }).select('shopifyLocationId').limit(2).lean();
    if (matches.length !== 1) {
      throw new HttpError(400, 'Vinculá un único depósito activo de Thibe con Shopify o configurá SHOPIFY_DEFAULT_LOCATION_ID.');
    }
    location = matches[0].shopifyLocationId.trim();
  }
  const shopifyId = normalizeLocationId(location);
  if (!shopifyId) {
    const source = configured ? 'SHOPIFY_DEFAULT_LOCATION_ID' : 'la ubicación Thibe';
    throw new HttpError(400, `El ID de Shopify en ${source} debe ser un número o un GID de ubicación.`);
  }
  return shopifyId;
}

async function syncCatalogDraft(model, items, graphql = shopifyGraphql, {
  beforeAdopt, beforeSend, selectedLocationId, confirmedVariantIds, saveLinks
} = {}) {
  const locationId = await resolveDraftLocationId(model, selectedLocationId);
  const available = getCatalogAvailability(model);
  const handle = `gestionthibe-modelo-${model._id}`;
  const principal = items.get(String(model.principalItemId));
  const linkedProductId = getLinkedProductId(principal);
  const adopting = !model.productId && Boolean(linkedProductId);
  const adopted = adopting || Boolean(model.adoptedProductId);
  const productId = model.productId || linkedProductId;
  const identifier = productId ? { id: productId } : { handle };
  const found = await graphql(`
    query ThibeCatalogDraft($identifier: ProductIdentifierInput!, $limit: Int!, $after: String) {
      productByIdentifier(identifier: $identifier) {
        id status hasOnlyDefaultVariant
        options { name values }
        variants(first: $limit, after: $after) {
          nodes { ${variantFields} }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `, { identifier, limit: MAX_VARIANTS });
  const product = found.productByIdentifier;
  const active = product?.status === 'ACTIVE';
  if (product && !active && product.status !== 'DRAFT') {
    throw new HttpError(409, 'La ficha de Shopify debe estar activa o en borrador para sincronizar.');
  }
  if (productId && !product) {
    throw new HttpError(409, 'Shopify no encontró la ficha vinculada. El modelo quedó guardado en GestionThibe.');
  }

  async function prepare() {
    if (beforeSend) await beforeSend(locationId);
    if (adopting) {
      if (!beforeAdopt) throw new HttpError(409, 'No se pudo vincular la ficha al catálogo online.');
      await beforeAdopt(product.id);
    }
  }

  const simple = model.variants.length === 1 && !model.variants[0].color && !model.variants[0].size;
  if (active || (adopted && (simple || product.options?.some(option => normalizeLabel(option.name) !== 'title')))) {
    let pageInfo = product.variants.pageInfo;
    while (pageInfo.hasNextPage) {
      const page = await graphql(`
        query ThibeCatalogVariantPage($id: ID!, $after: String!) {
          product(id: $id) {
            variants(first: 100, after: $after) {
              nodes { ${variantFields} }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      `, { id: product.id, after: pageInfo.endCursor });
      if (!page.product) throw new HttpError(409, 'Shopify ya no encuentra la ficha vinculada.');
      product.variants.nodes.push(...page.product.variants.nodes);
      pageInfo = page.product.variants.pageInfo;
    }
    return syncExistingCatalogVariants({
      model, product, items, available, locationId, graphql, confirmedVariantIds, prepare, saveLinks
    });
  }
  if (product?.variants.pageInfo.hasNextPage) {
    throw new HttpError(409, 'El borrador tiene más variantes de las que admite el piloto.');
  }
  if (adopting && (product.variants.nodes.length !== 1 ||
      product.variants.nodes[0].sku !== (principal.sku || principal.code))) {
    throw new HttpError(409, 'La ficha vinculada contiene variantes que requieren revisión en Shopify.');
  }

  const axes = [['Color', 'color'], ['Talle', 'size']].filter(([, key]) => model.variants.some(row => row[key]));
  const productOptions = axes.length ? axes.map(([name, key]) => ({
    name,
    values: [...new Set(model.variants.map(row => row[key]))].map(value => ({ name: value }))
  })) : [{ name: 'Title', values: [{ name: 'Default Title' }] }];
  const variants = model.variants.map(row => {
    const id = String(row.itemId);
    const item = items.get(String(row.sourceItemId || id));
    const sku = getVariantSku(row, item);
    if (!Number.isFinite(item.pDecimal) || item.pDecimal < 0) {
      throw new HttpError(400, `Cargá un precio para el SKU ${sku} antes de sincronizar.`);
    }
    const existing = simple && product?.hasOnlyDefaultVariant
      ? product.variants.nodes[0]
      : product?.variants.nodes.find(variant => variant.sku === sku);
    return {
      ...(existing ? { id: existing.id } : {}),
      sku,
      price: item.pDecimal,
      inventoryItem: { tracked: true },
      inventoryPolicy: 'DENY',
      inventoryQuantities: [{ locationId, name: 'available', quantity: available.get(id) }],
      optionValues: axes.length ? axes.map(([optionName, key]) => ({ optionName, name: row[key] }))
        : [{ optionName: 'Title', name: 'Default Title' }]
    };
  });
  const keepExistingMedia = adopted;
  const filesBySource = new Map();
  const filesByColor = new Map();
  for (const gallery of model.galleries) {
    const ids = [];
    for (const photo of gallery.images) {
      const source = resolveCatalogPhotoUrl(photo, config.shopify.publicBackendUrl);
      if (!filesBySource.has(source)) {
        const file = await getOrCreateImage(graphql, handle, {
          originalSource: source,
          alt: `${model.title} · ${gallery.color}`
        });
        if (file.fileStatus !== 'READY') {
          const message = file.fileStatus === 'FAILED'
            ? 'Shopify no pudo procesar una foto. Revisá la URL y el formato.'
            : 'Shopify está procesando las fotos. Volvé a sincronizar en unos segundos.';
          throw new HttpError(409, message);
        }
        filesBySource.set(source, file.id);
      }
      ids.push(filesBySource.get(source));
    }
    filesByColor.set(normalizeLabel(gallery.color), ids);
  }

  const variantPhotos = model.variants.map(({ color }) => {
    const ids = splitColors(color).flatMap(part => filesByColor.get(normalizeLabel(part)) || []);
    return ids.length ? [...new Set(ids)] : filesByColor.get(normalizeLabel(color)) || [];
  });

  const input = {
    title: model.title,
    ...(keepExistingMedia ? {} : { vendor: 'GestionThibe' }),
    ...(product ? {} : { status: 'DRAFT' }),
    ...(product ? {} : { handle }),
    productOptions,
    ...(keepExistingMedia ? {} : { files: [...filesBySource.values()].map(id => ({ id })) }),
    variants: variants.map((variant, index) => {
      const photo = variantPhotos[index][0];
      return photo && !keepExistingMedia ? { ...variant, file: { id: photo } } : variant;
    })
  };
  await prepare();
  const result = await graphql(`
    mutation ThibeSetCatalogDraft($identifier: ProductSetIdentifiers, $input: ProductSetInput!, $limit: Int!) {
      productSet(identifier: $identifier, input: $input, synchronous: true) {
        product {
          id
          variants(first: $limit) { nodes { id sku } }
        }
        userErrors { message }
      }
    }
  `, { identifier: product ? { id: product.id } : { handle }, input, limit: MAX_VARIANTS });
  const synced = result.productSet?.product;
  const errors = result.productSet?.userErrors || [];
  if (!synced?.id || errors.length) {
    throw new HttpError(502, errors.map(error => error.message).join(' · ') || 'Shopify no devolvió el borrador.');
  }

  if (keepExistingMedia && filesBySource.size) {
    const existing = new Set((await getProductImages(graphql, synced.id)).map(image => image.id));
    const files = [...filesBySource.values()].filter(id => !existing.has(id))
      .map(id => ({ id, referencesToAdd: [synced.id] }));
    if (files.length) {
      const updated = await graphql(`
        mutation ThibeCatalogKeepExistingMedia($files: [FileUpdateInput!]!) {
          fileUpdate(files: $files) { files { id } userErrors { message } }
        }
      `, { files });
      if (updated.fileUpdate?.files?.length !== files.length || updated.fileUpdate.userErrors?.length) {
        throw new HttpError(502, 'No se pudieron agregar las fotos al borrador existente.');
      }
    }
  }

  const append = [];
  const detach = [];
  const variantsWithMedia = [];
  if (filesBySource.size) {
    const ids = synced.variants.nodes.map(variant => variant.id);
    for (let start = 0; start < ids.length; start += 10) {
      const data = await graphql(`
        query ThibeCatalogVariantMedia($ids: [ID!]!) {
          nodes(ids: $ids) { ... on ProductVariant { id sku media(first: 50) { nodes { id } } } }
        }
      `, { ids: ids.slice(start, start + 10) });
      variantsWithMedia.push(...data.nodes.filter(Boolean));
    }
  }
  for (const variant of variantsWithMedia) {
    const index = variants.findIndex(candidate => candidate.sku === variant.sku);
    if (index === -1) continue;
    const desired = variantPhotos[index];
    const current = variant.media.nodes.map(node => node.id);
    const added = desired.filter(id => !current.includes(id));
    const removed = adopted && !desired.length ? [] : current.filter(id => !desired.includes(id));
    if (added.length) append.push({ variantId: variant.id, mediaIds: added });
    if (removed.length) detach.push({ variantId: variant.id, mediaIds: removed });
  }
  for (const [operation, inputType, links] of [
    ['productVariantDetachMedia', 'ProductVariantDetachMediaInput', detach],
    ['productVariantAppendMedia', 'ProductVariantAppendMediaInput', append]
  ]) {
    if (!links.length) continue;
    const updated = await graphql(`
      mutation ThibeCatalogVariantMedia($productId: ID!, $links: [${inputType}!]!) {
        ${operation}(productId: $productId, variantMedia: $links) { userErrors { message } }
      }
    `, { productId: synced.id, links });
    const errors = updated[operation]?.userErrors;
    if (!errors || errors.length) {
      throw new HttpError(502, errors?.map(error => error.message).join(' · ') || 'No se pudieron vincular las fotos por color.');
    }
  }
  return synced.id;
}

module.exports = { listDraftLocations, syncCatalogDraft };
