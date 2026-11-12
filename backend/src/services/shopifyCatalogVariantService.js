const { HttpError } = require('../utils/errors');
const { getVariantSku, normalizeLabel } = require('./shopifyCatalogService');
const { syncAvailableQuantities } = require('./shopifyProductService');

const variantFields = 'id sku selectedOptions { name value } inventoryItem { id tracked }';

function optionKey(name) {
  const key = normalizeLabel(name);
  if (['color', 'colour'].includes(key)) return 'color';
  if (['talle', 'talla', 'size'].includes(key)) return 'size';
  return null;
}

function matchesOptions(variant, row) {
  const options = variant.selectedOptions || [];
  return ['color', 'size'].every(key => {
    const matching = options.filter(option => optionKey(option.name) === key);
    return matching.length === 1 && normalizeLabel(matching[0].value) === normalizeLabel(row[key]);
  });
}

async function syncExistingCatalogVariants({
  model, product, items, available, locationId, graphql, confirmedVariantIds, prepare, saveLinks
}) {
  const variants = product.variants.nodes;
  const links = new Map((model.shopifyVariantLinks || []).map(link => [String(link.itemId), link]));
  const rows = model.variants.map(row => {
    const itemId = String(row.itemId);
    const label = `${row.color} · ${row.size}`;
    const link = links.get(itemId);
    const saved = link?.color === row.color && link.size === row.size
      ? variants.find(variant => variant.id === link.variantId)
      : null;
    const matches = saved ? [saved] : variants.filter(variant => matchesOptions(variant, row));
    if (matches.length > 1) {
      throw new HttpError(409, `Hay varias variantes de Shopify para ${label}. Revisá las opciones de esa ficha.`);
    }
    return { row, itemId, label, variant: matches[0] };
  });

  const matched = rows.filter(entry => entry.variant).map(entry => entry.variant);
  if (new Set(matched.map(variant => variant.id)).size !== matched.length) {
    throw new HttpError(409, 'Dos filas del catálogo apuntan a la misma variante de Shopify.');
  }
  if (matched.some(variant => !variant.inventoryItem?.id || !variant.inventoryItem.tracked)) {
    throw new HttpError(409, 'Activá el seguimiento de inventario en las variantes vinculadas de Shopify.');
  }

  const missing = rows.filter(entry => !entry.variant);
  let newVariants = [];
  if (missing.length) {
    const options = product.options || [];
    if (options.length !== 2 || new Set(options.map(option => optionKey(option.name))).size !== 2 ||
        options.some(option => !optionKey(option.name))) {
      throw new HttpError(409, 'Para agregar variantes, la ficha de Shopify debe tener opciones de color y talle.');
    }
    if (!Array.isArray(confirmedVariantIds) || confirmedVariantIds.length !== missing.length ||
        !missing.every(entry => confirmedVariantIds.includes(entry.itemId))) {
      throw new HttpError(409, 'Confirmá las combinaciones nuevas antes de crearlas en Shopify.', {
        missingVariants: missing.map(({ itemId, label }) => ({ itemId, label }))
      });
    }
    newVariants = missing.map(({ row, itemId }) => {
      const item = items.get(String(row.sourceItemId || itemId));
      const sku = getVariantSku(row, item);
      if (variants.some(variant => variant.sku === sku)) {
        throw new HttpError(409, `El SKU ${sku} ya existe en otra combinación de esta ficha.`);
      }
      if (!Number.isFinite(item.pDecimal) || item.pDecimal < 0) {
        throw new HttpError(400, `Cargá un precio para el SKU ${sku} antes de sincronizar.`);
      }
      return {
        price: item.pDecimal,
        inventoryItem: { sku, tracked: true },
        inventoryPolicy: 'DENY',
        optionValues: options.map(option => ({
          optionName: option.name,
          name: option.values.find(value => normalizeLabel(value) === normalizeLabel(row[optionKey(option.name)])) ||
            row[optionKey(option.name)]
        }))
      };
    });
  }

  await prepare();
  if (newVariants.length) {
    const result = await graphql(`
      mutation ThibeCreateCatalogVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: PRESERVE_STANDALONE_VARIANT) {
          productVariants { ${variantFields} }
          userErrors { message }
        }
      }
    `, { productId: product.id, variants: newVariants });
    const created = result.productVariantsBulkCreate;
    const errors = created?.userErrors || [];
    if (errors.length || created?.productVariants?.length !== missing.length) {
      throw new HttpError(502, errors.map(error => error.message).join(' · ') || 'Shopify no devolvió todas las variantes nuevas.');
    }
    for (const entry of missing) {
      entry.variant = created.productVariants.find(variant => matchesOptions(variant, entry.row));
      if (!entry.variant?.inventoryItem?.id || !entry.variant.inventoryItem.tracked) {
        throw new HttpError(502, `Shopify no devolvió el inventario de ${entry.label}.`);
      }
    }
  }

  await saveLinks?.(rows.map(({ itemId, row, variant }) => ({
    itemId, color: row.color, size: row.size, variantId: variant.id, sku: variant.sku
  })));
  await syncAvailableQuantities(rows.map(({ itemId, variant }) => ({
    inventoryItemId: variant.inventoryItem.id,
    locationId,
    quantity: available.get(itemId)
  })), `gestionthibe://shopify/catalog/${model._id}`, graphql);
  return product.id;
}

module.exports = { syncExistingCatalogVariants, variantFields };
