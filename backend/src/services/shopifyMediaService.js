const { createHash } = require('node:crypto');
const { setTimeout: wait } = require('node:timers/promises');
const { HttpError } = require('../utils/errors');

function getImageFilename(productId, source) {
  const extension = new URL(source).pathname.match(/\.(jpe?g|png|webp|gif|avif)$/i)?.[1]?.toLowerCase() || 'jpg';
  const hash = createHash('sha256').update(`${productId}\n${source}`).digest('hex').slice(0, 32);
  return `gestionthibe-${hash}.${extension}`;
}

async function findImage(graphql, filename) {
  const data = await graphql(`
    query FindThibeImage($query: String!) {
      files(first: 2, query: $query) { nodes { id fileStatus } }
    }
  `, { query: `filename:"${filename}"` });
  const files = data.files?.nodes || [];
  if (files.length > 1) throw new HttpError(409, `Shopify devolvió más de un archivo para ${filename}.`);
  return files[0];
}

async function getOrCreateImage(graphql, productId, image) {
  const filename = getImageFilename(productId, image.originalSource);
  const existing = await findImage(graphql, filename);
  if (existing) return existing;
  const data = await graphql(`
    mutation CreateThibeImage($files: [FileCreateInput!]!) {
      fileCreate(files: $files) { files { id fileStatus } userErrors { field message } }
    }
  `, { files: [{ filename, duplicateResolutionMode: 'RAISE_ERROR', contentType: 'IMAGE', originalSource: image.originalSource, alt: image.alt }] });
  const created = data.fileCreate?.files?.[0];
  if (created) return created;
  // A concurrent sync may already have created the same file.
  const concurrent = await findImage(graphql, filename);
  if (concurrent) return concurrent;
  const message = data.fileCreate?.userErrors?.map(error => error.message).join(', ');
  throw new HttpError(502, message || 'Shopify no devolvió la imagen creada.');
}

async function getProductImages(graphql, productId) {
  const images = [];
  let cursor = null;
  do {
    const data = await graphql(`
      query ThibeProductImages($id: ID!, $cursor: String) {
        product(id: $id) {
          media(first: 50, after: $cursor) {
            nodes { id ... on MediaImage { originalSource { url } image { url } } }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    `, { id: productId, cursor });
    const connection = data.product?.media;
    if (!connection) throw new HttpError(502, 'Shopify no devolvió la galería del producto.');
    images.push(...connection.nodes);
    cursor = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
  } while (cursor);
  return images;
}

async function syncProductImages(graphql, productId, media = []) {
  const result = { attached: 0, pending: 0, errors: [] };
  if (!media.length) return result;
  const existing = await getProductImages(graphql, productId);
  const attachedIds = new Set(existing.map(image => image.id));
  const existingUrls = new Set(existing.flatMap(image => [image.originalSource?.url, image.image?.url]));
  const existingUploadNames = new Set([...existingUrls].filter(Boolean).map(url => new URL(url).pathname.split('/').pop()));
  const processed = new Set();
  for (const image of media) {
    if (processed.has(image.originalSource) || existingUrls.has(image.originalSource)) continue;
    const localName = new URL(image.originalSource).pathname.match(/\/uploads\/items\/(\d+-[\da-f]{16}\.[a-z]+)$/i)?.[1];
    if (localName && existingUploadNames.has(localName)) continue;
    processed.add(image.originalSource);
    try {
      let file = await getOrCreateImage(graphql, productId, image);
      if (attachedIds.has(file.id)) continue;
      if (file.fileStatus !== 'READY' && file.fileStatus !== 'FAILED') {
        await wait(500);
        const data = await graphql('query ThibeImageStatus($id: ID!) { node(id: $id) { ... on MediaImage { id fileStatus } } }', { id: file.id });
        file = data.node || file;
      }
      if (file.fileStatus === 'FAILED') throw new HttpError(502, 'Shopify no pudo procesar la imagen. Revisá la URL pública y el formato.');
      if (file.fileStatus !== 'READY') {
        result.pending++;
        continue;
      }
      const data = await graphql(`
        mutation AttachThibeImage($files: [FileUpdateInput!]!) {
          fileUpdate(files: $files) { files { id } userErrors { field message } }
        }
      `, { files: [{ id: file.id, referencesToAdd: [productId] }] });
      if (!data.fileUpdate?.files?.some(attachment => attachment.id === file.id)) {
        throw new HttpError(502, data.fileUpdate?.userErrors?.[0]?.message || 'Shopify no confirmó la asociación de la imagen.');
      }
      attachedIds.add(file.id);
      result.attached++;
    } catch (error) {
      result.errors.push(error.message);
    }
  }
  return result;
}

module.exports = { getOrCreateImage, getProductImages, syncProductImages };
