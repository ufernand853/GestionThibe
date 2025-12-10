import { computeTotalStockFromMap } from './stockStatus.js';

export const RECOUNT_THRESHOLD_DAYS = 0;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

const ensureTotalQuantity = item => {
  const total = item?.total || computeTotalStockFromMap(item?.stock);
  const boxes = Number(total?.boxes) || 0;
  const units = Number(total?.units) || 0;
  return { boxes, units };
};

const normalizeItem = (item, totalQuantity) => ({
  id: item?.id,
  code: item?.code,
  description: item?.description,
  group: item?.group || null,
  groupId:
    item?.groupId ||
    item?.group?.id ||
    item?.group?._id ||
    (typeof item?.group === 'object' ? item?.group?.id || item?.group?._id : null) ||
    null,
  needsRecount: Boolean(item?.needsRecount),
  updatedAt: item?.updatedAt || null,
  total: totalQuantity
});

export function computeInventoryAlerts(items, { thresholdDays = RECOUNT_THRESHOLD_DAYS } = {}) {
  const source = Array.isArray(items) ? items : [];
  const now = Date.now();
  const recount = [];
  const outOfStock = [];

  const thresholdMs = Math.max(0, Number.isFinite(thresholdDays) ? thresholdDays * DAY_IN_MS : 0);

  source.forEach(item => {
    const totalQuantity = ensureTotalQuantity(item);
    const normalized = normalizeItem(item, totalQuantity);

    if (totalQuantity.boxes === 0 && totalQuantity.units === 0) {
      outOfStock.push(normalized);
    }

    const updatedAtMs = normalized.updatedAt ? new Date(normalized.updatedAt).getTime() : 0;
    const reasons = [];
    let staleDays = null;

    if (!updatedAtMs || (thresholdMs > 0 && now - updatedAtMs >= thresholdMs)) {
      staleDays = updatedAtMs ? Math.max(0, Math.floor((now - updatedAtMs) / DAY_IN_MS)) : null;
      reasons.push('stale');
    }

    if (normalized.needsRecount) {
      reasons.push('manual');
    }

    if (reasons.length > 0) {
      recount.push({ ...normalized, reasons, staleDays });
    }
  });

  recount.sort((a, b) => {
    const aManual = a.reasons.includes('manual');
    const bManual = b.reasons.includes('manual');
    if (aManual !== bManual) {
      return aManual ? -1 : 1;
    }
    const aDays = a.staleDays ?? -1;
    const bDays = b.staleDays ?? -1;
    return bDays - aDays;
  });

  return { recount, outOfStock };
}
