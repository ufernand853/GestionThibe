const config = require('../config');
const { HttpError } = require('../utils/errors');

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function normalizeShopDomain(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function getShopifyAuthStatus() {
  const shopDomain = normalizeShopDomain(config.shopify.shopDomain);
  const hasAdminAccessToken = Boolean(config.shopify.adminAccessToken.trim());
  const hasClientCredentials = Boolean(config.shopify.clientId.trim() && config.shopify.clientSecret.trim());
  return {
    configured: Boolean(shopDomain && (hasAdminAccessToken || hasClientCredentials) && !config.shopify.dryRun),
    dryRun: Boolean(config.shopify.dryRun),
    shopDomain: shopDomain || null,
    apiVersion: config.shopify.apiVersion,
    hasAdminAccessToken,
    hasClientCredentials,
    authMode: hasAdminAccessToken ? 'admin_access_token' : hasClientCredentials ? 'client_credentials' : 'missing',
    defaultLocationId: config.shopify.defaultLocationId || null,
    hasPublicBackendUrl: Boolean(config.shopify.publicBackendUrl)
  };
}

async function requestClientCredentialsToken() {
  const shopDomain = normalizeShopDomain(config.shopify.shopDomain);
  if (!shopDomain) {
    throw new HttpError(400, 'Falta configurar SHOPIFY_STORE o SHOPIFY_SHOP_DOMAIN.');
  }
  if (!config.shopify.clientId || !config.shopify.clientSecret) {
    throw new HttpError(400, 'Falta configurar SHOPIFY_CLIENT_ID y SHOPIFY_CLIENT_SECRET.');
  }
  if (typeof fetch !== 'function') {
    throw new HttpError(500, 'El runtime de Node no tiene fetch disponible para solicitar tokens Shopify.');
  }

  const response = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      client_id: config.shopify.clientId,
      client_secret: config.shopify.clientSecret,
      grant_type: 'client_credentials'
    })
  });

  let body = null;
  try {
    body = await response.json();
  } catch (error) {
    body = null;
  }

  if (!response.ok || !body?.access_token) {
    const message = body?.error_description || body?.error || 'Shopify rechazó la solicitud de token.';
    throw new HttpError(response.status || 502, `No se pudo obtener token Shopify: ${message}`);
  }

  const expiresIn = Number(body.expires_in) || 3600;
  cachedToken = body.access_token;
  cachedTokenExpiresAt = Date.now() + Math.max(60, expiresIn - 60) * 1000;
  return cachedToken;
}

async function getAdminAccessToken() {
  if (config.shopify.adminAccessToken.trim()) {
    return config.shopify.adminAccessToken.trim();
  }
  if (cachedToken && cachedTokenExpiresAt > Date.now()) {
    return cachedToken;
  }
  return requestClientCredentialsToken();
}

module.exports = {
  getShopifyAuthStatus,
  getAdminAccessToken,
  normalizeShopDomain
};
