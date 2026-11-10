const config = require('../config');
const { HttpError } = require('../utils/errors');
const { shopifyGraphql } = require('./shopifyProductService');
const { getOrCreateImage, getProductImages } = require('./shopifyMediaService');
const { getLinkedProductId } = require('./shopifyCatalogLinkService');
const { getCatalogAvailability, MAX_VARIANTS, resolveCatalogPhotoUrl, normalizeLabel, splitColors, getVariantSku } = require('./shopifyCatalogService');

async function syncCatalogDraft(model, items, graphql = shopifyGraphql, { beforeAdopt } = {}) {
  const location = config.shopify.defaultLocationId.trim();
  const locationId = /^\d+$/.test(location) ? `gid://shopify/Location/${location}` : location;
  if (!/^gid:\/\/shopify\/Location\/\d+$/.test(locationId)) {
    throw new HttpError(400, 'Configurá SHOPIFY_DEFAULT_LOCATION_ID para el stock del borrador.');
  }
  const available = getCatalogAvailability(model);
  const handle = `gestionthibe-modelo-${model._id}`;
  const principal = items.get(String(model.principalItemId));
  const linkedProductId = getLinkedProductId(principal);
  const adopting = !model.productId && Boolean(linkedProductId);
  const adopted = adopting || Boolean(model.adoptedProductId);
  const productId = model.productId || linkedProductId;
  const identifier = productId ? { id: productId } : { handle };
  const found = await graphql(`
    query ThibeCatalogDraft($identifier: ProductIdentifierInput!, $limit: Int!) {
      productByIdentifier(identifier: $identifier) {
        id status
        variants(first: $limit) { nodes { id sku } pageInfo { hasNextPage } }
      }
    }
  `, { identifier, limit: MAX_VARIANTS });
  const product = found.productByIdentifier;
  if (product && product.status !== 'DRAFT') {
    throw new HttpError(409, 'El piloto solo sincroniza borradores. Podés seguir editando en GestionThibe. Para enviar los cambios, la ficha de Shopify tiene que estar en borrador.');
  }
  if (product?.variants.pageInfo.hasNextPage) {
    throw new HttpError(409, 'El borrador tiene más variantes de las que admite el piloto.');
  }

  if (adopted && !product) {
    throw new HttpError(409, 'Shopify no encontró la ficha vinculada. El modelo quedó guardado en GestionThibe.');
  }
  if (adopting && (product.variants.nodes.length !== 1 ||
      product.variants.nodes[0].sku !== (principal.sku || principal.code))) {
    throw new HttpError(409, 'La ficha vinculada contiene variantes que requieren revisión en Shopify.');
  }

  const variants = model.variants.map(row => {
    const id = String(row.itemId);
    const item = items.get(String(row.sourceItemId || id));
    const sku = getVariantSku(row, item);
    if (!Number.isFinite(item.pDecimal) || item.pDecimal < 0) {
      throw new HttpError(400, `Cargá un precio para el SKU ${sku} antes de sincronizar.`);
    }
    const existing = product?.variants.nodes.find(variant => variant.sku === sku);
    return {
      ...(existing ? { id: existing.id } : {}),
      sku,
      price: item.pDecimal,
      inventoryItem: { tracked: true },
      inventoryPolicy: 'DENY',
      inventoryQuantities: [{ locationId, name: 'available', quantity: available.get(id) }],
      optionValues: [
        { optionName: 'Color', name: row.color },
        { optionName: 'Talle', name: row.size }
      ]
    };
  });

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

  const productOptions = [['Color', 'color'], ['Talle', 'size']].map(([name, key]) => ({
    name,
    values: [...new Set(model.variants.map(row => row[key]))].map(value => ({ name: value }))
  }));
  const input = {
    title: model.title,
    ...(adopted ? {} : { vendor: 'GestionThibe' }),
    status: 'DRAFT',
    ...(product ? {} : { handle }),
    productOptions,
    ...(adopted ? {} : { files: [...filesBySource.values()].map(id => ({ id })) }),
    variants: variants.map((variant, index) => {
      const photo = variantPhotos[index][0];
      return photo && !adopted ? { ...variant, file: { id: photo } } : variant;
    })
  };
  if (adopting) {
    if (!beforeAdopt) throw new HttpError(409, 'No se pudo vincular el borrador al catálogo online.');
    await beforeAdopt(product.id);
  }
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

  if (adopted && filesBySource.size) {
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

module.exports = { syncCatalogDraft };
