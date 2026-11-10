const ShopifyCatalogModel = require('../models/ShopifyCatalogModel');

function getLinkedProductId(item) {
  const value = String(item?.shopify?.productId || '').trim();
  if (/^gid:\/\/shopify\/Product\/\d+$/.test(value)) return value;
  return /^\d+$/.test(value) ? 'gid://shopify/Product/' + value : null;
}

async function isCatalogManagedProduct(productId) {
  return Boolean(productId && await ShopifyCatalogModel.exists({ adoptedProductId: productId }));
}

module.exports = { getLinkedProductId, isCatalogManagedProduct };
