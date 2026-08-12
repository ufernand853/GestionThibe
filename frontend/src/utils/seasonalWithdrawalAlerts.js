export const WITHDRAWAL_ALERT_DAYS = 30;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export function getCurrentSeason(date = new Date()) {
  const month = date.getMonth();
  return month >= 2 && month <= 7 ? 'Otoño/Invierno' : 'Primavera/Verano';
}

export function normalizeSeason(season) {
  const value = String(season || '').trim();
  if (value === 'Otoño' || value === 'Invierno') return 'Otoño/Invierno';
  if (value === 'Primavera' || value === 'Verano') return 'Primavera/Verano';
  return value;
}

export function computeSeasonalWithdrawalAlerts(
  items,
  requests,
  { now = new Date(), thresholdDays = WITHDRAWAL_ALERT_DAYS } = {}
) {
  const nowMs = now.getTime();
  const cutoffMs = nowMs - thresholdDays * DAY_IN_MS;
  const activeSeason = getCurrentSeason(now);
  const lastWithdrawalByItem = new Map();

  (Array.isArray(requests) ? requests : []).forEach(request => {
    if (request?.status !== 'executed') return;
    const type = String(request.type || request.movementType || 'transfer').toLowerCase();
    if (type !== 'egress') return;
    const itemId = request.item?.id || request.itemId;
    const withdrawalAt = request.executedAt || request.approvedAt || request.requestedAt;
    const withdrawalMs = withdrawalAt ? new Date(withdrawalAt).getTime() : NaN;
    if (!itemId || Number.isNaN(withdrawalMs)) return;
    if (withdrawalMs > (lastWithdrawalByItem.get(itemId)?.time ?? -Infinity)) {
      lastWithdrawalByItem.set(itemId, { time: withdrawalMs, value: withdrawalAt });
    }
  });

  const alerts = (Array.isArray(items) ? items : [])
    .filter(item => {
      const season = normalizeSeason(item.season || item.attributes?.season);
      return season === activeSeason || season === 'Sin temporada';
    })
    .map(item => {
      const lastWithdrawal = lastWithdrawalByItem.get(item.id);
      const referenceMs = lastWithdrawal?.time ?? new Date(item.createdAt).getTime();
      if (Number.isNaN(referenceMs) || referenceMs > cutoffMs) return null;
      return {
        ...item,
        season: normalizeSeason(item.season || item.attributes?.season),
        lastWithdrawalAt: lastWithdrawal?.value || null,
        daysWithoutWithdrawal: Math.max(0, Math.floor((nowMs - referenceMs) / DAY_IN_MS))
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.daysWithoutWithdrawal - a.daysWithoutWithdrawal || a.code.localeCompare(b.code));

  return { activeSeason, alerts };
}
