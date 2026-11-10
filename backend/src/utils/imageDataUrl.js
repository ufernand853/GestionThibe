const MAX_FILE_SIZE = 5 * 1024 * 1024;

const ALLOWED_DATA_URL_PREFIXES = [
  { match: 'data:image/jpeg;base64,', normalized: 'data:image/jpeg;base64,', mimeType: 'image/jpeg', extension: 'jpg' },
  { match: 'data:image/jpg;base64,', normalized: 'data:image/jpeg;base64,', mimeType: 'image/jpeg', extension: 'jpg' },
  { match: 'data:image/png;base64,', normalized: 'data:image/png;base64,', mimeType: 'image/png', extension: 'png' },
  { match: 'data:image/webp;base64,', normalized: 'data:image/webp;base64,', mimeType: 'image/webp', extension: 'webp' },
  { match: 'data:image/gif;base64,', normalized: 'data:image/gif;base64,', mimeType: 'image/gif', extension: 'gif' }
];

function sanitizeDataUrl(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  const prefixEntry = ALLOWED_DATA_URL_PREFIXES.find(entry => lower.startsWith(entry.match));
  if (!prefixEntry) {
    return null;
  }
  const base64Part = trimmed.slice(prefixEntry.match.length).replace(/\s+/g, '');
  if (!base64Part) {
    return null;
  }
  if (!/^[0-9a-z+/]+=*$/i.test(base64Part)) {
    return null;
  }
  const paddingMatch = base64Part.match(/=+$/);
  const padding = paddingMatch ? paddingMatch[0].length : 0;
  if (padding > 2) {
    return null;
  }
  const sizeInBytes = Math.floor((base64Part.length * 3) / 4) - padding;
  if (sizeInBytes > MAX_FILE_SIZE) {
    return null;
  }
  return `${prefixEntry.normalized}${base64Part}`;
}

function getDataUrlMeta(dataUrl) {
  return ALLOWED_DATA_URL_PREFIXES.find(entry => dataUrl.startsWith(entry.normalized)) || null;
}

module.exports = { sanitizeDataUrl, getDataUrlMeta };
