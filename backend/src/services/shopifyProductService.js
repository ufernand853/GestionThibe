const config = require('../config');
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
          inventoryItem { sku }
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
    mutation productCreate($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id
          handle
          status
          variants(first: 1) {
            nodes { id }
          }
        }
        userErrors { field message }
      }
    }
  `;
  const data = await shopifyGraphql(query, { product: buildProductInput(payload, status) });
  const result = data.productCreate;
  assertNoUserErrors('la creación del producto', result?.userErrors);
  const product = result?.product;
  if (!product?.id) {
    throw new HttpError(502, 'Shopify no devolvió el producto creado.');
  }
  const variantId = product.variants?.nodes?.[0]?.id || null;
  const updatedVariant = await updateDefaultVariant(product.id, variantId, payload);
  return {
    productId: product.id,
    variantId: updatedVariant?.id || variantId,
    handle: product.handle || null,
    status: String(product.status || status || 'draft').toLowerCase()
  };
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
            nodes { id }
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
  const variantId = product.variants?.nodes?.[0]?.id || null;
  const updatedVariant = await updateDefaultVariant(product.id, variantId, payload);
  return {
    productId: product.id,
    variantId: updatedVariant?.id || variantId,
    handle: product.handle || null,
    status: String(product.status || status || 'draft').toLowerCase()
  };
}

async function syncShopifyProduct({ existingProductId, payload, status }) {
  if (existingProductId) {
    return updateShopifyProduct(existingProductId, payload, status);
  }
  return createShopifyProduct(payload, status);
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
