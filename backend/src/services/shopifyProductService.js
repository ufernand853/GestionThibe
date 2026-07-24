const config = require('../config');
const crypto = require('crypto');
const { HttpError } = require('../utils/errors');
const { getAdminAccessToken, normalizeShopDomain } = require('./shopifyAuthService');

async function shopifyGraphql(query, variables = {}) {
  const shopDomain = normalizeShopDomain(config.shopify.shopDomain);
  if (!shopDomain) {
    throw new HttpError(400, 'Falta configurar SHOPIFY_STORE o SHOPIFY_SHOP_DOMAIN.');
  }
  const token = await getAdminAccessToken();
  const response = await fetch(`https://${shopDomain}/admin/api/${config.shopify.apiVersion}/graphql.json`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token
    },
    body: JSON.stringify({ query, variables })
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new HttpError(response.status || 502, `Shopify respondió con error HTTP ${response.status || 'desconocido'}`, body || undefined);
  }
  if (body?.errors?.length) {
    throw new HttpError(502, `Shopify GraphQL rechazó la operación: ${body.errors.map(error => error.message).join('; ')}`, body.errors);
  }
  return body?.data || {};
}

function normalizeTags(values = []) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
}

function buildProductInput(payload, status = 'active') {
  const productStatus = status === 'archived' ? 'ARCHIVED' : status === 'draft' ? 'DRAFT' : 'ACTIVE';
  return {
    title: payload.title,
    descriptionHtml: payload.title,
    vendor: payload.vendor || 'GestionThibe',
    productType: payload.productType || 'General',
    status: productStatus,
    tags: normalizeTags([payload.sku, payload.productType, ...(payload.tags || [])])
  };
}

function assertNoUserErrors(operation, userErrors = []) {
  if (Array.isArray(userErrors) && userErrors.length > 0) {
    const message = userErrors.map(error => `${(error.field || []).join('.')}: ${error.message}`).join('; ');
    throw new HttpError(400, `Shopify rechazó ${operation}: ${message}`, userErrors);
  }
}

function buildVariantInput(variantId, payload) {
  if (!variantId) return null;
  const variant = { id: variantId };
  if (payload.price !== null && payload.price !== undefined) {
    variant.price = String(payload.price);
  }
  if (payload.sku) {
    variant.inventoryItem = { sku: payload.sku };
  }
  return variant;
}

function shopifyGid(resource, value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (normalized.startsWith('gid://shopify/')) return normalized;
  return /^\d+$/.test(normalized) ? `gid://shopify/${resource}/${normalized}` : normalized;
}

function getLocationAvailableQuantity(location) {
  return (Number(location?.boxes) || 0) + (Number(location?.units) || 0);
}

function getMappedInventoryQuantities(inventoryItemId, payload) {
  const normalizedInventoryItemId = shopifyGid('InventoryItem', inventoryItemId);
  if (!normalizedInventoryItemId) return [];
  const locations = Array.isArray(payload?.stockByLocation) ? payload.stockByLocation : [];
  return locations
    .map(location => {
      const locationId = shopifyGid('Location', location.shopifyLocationId);
      if (!locationId) return null;
      return {
        inventoryItemId: normalizedInventoryItemId,
        locationId,
        quantity: getLocationAvailableQuantity(location)
      };
    })
    .filter(Boolean);
}

async function getCurrentAvailableQuantity(inventoryItemId, locationId) {
  const query = `
    query InventoryLevelAvailable($inventoryItemId: ID!, $locationId: ID!) {
      inventoryItem(id: $inventoryItemId) {
        inventoryLevel(locationId: $locationId, includeInactive: true) {
          quantities(names: ["available"]) {
            name
            quantity
          }
        }
      }
    }
  `;
  const data = await shopifyGraphql(query, { inventoryItemId, locationId });
  const available = data.inventoryItem?.inventoryLevel?.quantities?.find(quantity => quantity.name === 'available');
  return Number(available?.quantity) || 0;
}

async function withCurrentInventoryQuantities(quantities) {
  const resolvedQuantities = [];
  for (const quantity of quantities) {
    const currentQuantity = await getCurrentAvailableQuantity(quantity.inventoryItemId, quantity.locationId);
    resolvedQuantities.push({
      ...quantity,
      changeFromQuantity: currentQuantity
    });
  }
  return resolvedQuantities;
}

function isAlreadyActiveInventoryError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('already') || message.includes('active') || message.includes('activado');
}

async function activateInventoryLocation(quantity) {
  const query = `
    mutation ActivateInventoryItem(
      $inventoryItemId: ID!,
      $locationId: ID!,
      $available: Int,
      $idempotencyKey: String!
    ) {
      inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available)
        @idempotent(key: $idempotencyKey) {
        inventoryLevel { id }
        userErrors { field message }
      }
    }
  `;
  const data = await shopifyGraphql(query, {
    inventoryItemId: quantity.inventoryItemId,
    locationId: quantity.locationId,
    available: quantity.quantity,
    idempotencyKey: crypto.randomUUID()
  });
  const userErrors = data.inventoryActivate?.userErrors || [];
  const blockingErrors = userErrors.filter(error => !isAlreadyActiveInventoryError(error));
  assertNoUserErrors('la activación de inventario por ubicación', blockingErrors);
}

async function setInventoryQuantities(quantities, referenceDocumentUri) {
  const query = `
    mutation InventorySet($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
      inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
        inventoryAdjustmentGroup { id }
        userErrors { field message }
      }
    }
  `;
  const data = await shopifyGraphql(query, {
    input: {
      name: 'available',
      reason: 'correction',
      referenceDocumentUri,
      quantities
    },
    idempotencyKey: crypto.randomUUID()
  });
  assertNoUserErrors('la actualización de inventario por ubicación', data.inventorySetQuantities?.userErrors);
}

async function syncInventoryLevels(inventoryItemId, payload) {
  const quantities = getMappedInventoryQuantities(inventoryItemId, payload);
  if (quantities.length === 0) {
    return { updated: 0, skipped: true };
  }
  for (const quantity of quantities) {
    await activateInventoryLocation(quantity);
  }
  const quantitiesWithCurrentValues = await withCurrentInventoryQuantities(quantities);
  await setInventoryQuantities(
    quantitiesWithCurrentValues,
    `gestionthibe://shopify/inventory-sync/${encodeURIComponent(payload.sku || inventoryItemId)}`
  );
  return { updated: quantities.length, skipped: false };
}

async function updateDefaultVariant(productId, variantId, payload) {
  const variant = buildVariantInput(variantId, payload);
  if (!variant || (!variant.price && !variant.inventoryItem)) {
    return null;
  }
  const query = `
    mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          price
          inventoryItem { id sku }
        }
        userErrors { field message }
      }
    }
  `;
  const data = await shopifyGraphql(query, { productId, variants: [variant] });
  const result = data.productVariantsBulkUpdate;
  assertNoUserErrors('la actualización de precio/SKU de variante', result?.userErrors);
  return result?.productVariants?.[0] || null;
}

async function createShopifyProduct(payload, status) {
  const query = `
    mutation productCreate($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
      productCreate(product: $product, media: $media) {
        product {
          id
          handle
          status
          variants(first: 1) {
            nodes { id inventoryItem { id } }
          }
        }
        userErrors { field message }
      }
    }
  `;
  const media = Array.isArray(payload.media) && payload.media.length > 0 ? payload.media : null;
  const data = await shopifyGraphql(query, { product: buildProductInput(payload, status), media });
  const result = data.productCreate;
  assertNoUserErrors('la creación del producto', result?.userErrors);
  const product = result?.product;
  if (!product?.id) {
    throw new HttpError(502, 'Shopify no devolvió el producto creado.');
  }
  const variantNode = product.variants?.nodes?.[0] || null;
  const variantId = variantNode?.id || null;
  const updatedVariant = await updateDefaultVariant(product.id, variantId, payload);
  return {
    productId: product.id,
    variantId: updatedVariant?.id || variantId,
    inventoryItemId: updatedVariant?.inventoryItem?.id || variantNode?.inventoryItem?.id || null,
    handle: product.handle || null,
    status: String(product.status || status || 'draft').toLowerCase()
  };
}


async function productHasMedia(productId) {
  const query = `
    query productMediaExists($id: ID!) {
      product(id: $id) {
        media(first: 1) { nodes { id } }
      }
    }
  `;
  const data = await shopifyGraphql(query, { id: productId });
  return Boolean(data.product?.media?.nodes?.length);
}

async function appendProductMediaIfEmpty(productId, media = []) {
  if (!Array.isArray(media) || media.length === 0) return false;
  if (await productHasMedia(productId)) return false;
  const query = `
    mutation productUpdateMedia($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
      productUpdate(product: $product, media: $media) {
        product { id }
        media { id status mediaContentType }
        userErrors { field message }
      }
    }
  `;
  const data = await shopifyGraphql(query, { product: { id: productId }, media });
  const result = data.productUpdate;
  assertNoUserErrors('la carga de imágenes del producto', result?.userErrors);
  return true;
}

async function updateShopifyProduct(productId, payload, status) {
  const query = `
    mutation productUpdate($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product {
          id
          handle
          status
          variants(first: 1) {
            nodes { id inventoryItem { id } }
          }
        }
        userErrors { field message }
      }
    }
  `;
  const data = await shopifyGraphql(query, { product: { id: productId, ...buildProductInput(payload, status) } });
  const result = data.productUpdate;
  assertNoUserErrors('la actualización del producto', result?.userErrors);
  const product = result?.product;
  if (!product?.id) {
    throw new HttpError(502, 'Shopify no devolvió el producto actualizado.');
  }
  const variantNode = product.variants?.nodes?.[0] || null;
  const variantId = variantNode?.id || null;
  const updatedVariant = await updateDefaultVariant(product.id, variantId, payload);
  await appendProductMediaIfEmpty(product.id, payload.media);
  return {
    productId: product.id,
    variantId: updatedVariant?.id || variantId,
    inventoryItemId: updatedVariant?.inventoryItem?.id || variantNode?.inventoryItem?.id || null,
    handle: product.handle || null,
    status: String(product.status || status || 'draft').toLowerCase()
  };
}

async function syncShopifyProduct({ existingProductId, payload, status }) {
  const product = existingProductId
    ? await updateShopifyProduct(existingProductId, payload, status)
    : await createShopifyProduct(payload, status);
  return {
    ...product,
    inventorySync: await syncInventoryLevels(product.inventoryItemId, payload)
  };
}

async function archiveShopifyProduct(productId, payload = {}) {
  if (!productId) {
    return null;
  }
  return updateShopifyProduct(productId, payload, 'archived');
}

module.exports = {
  syncShopifyProduct,
  archiveShopifyProduct
};
