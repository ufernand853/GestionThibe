import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSeasonalWithdrawalAlerts,
  getCurrentSeason,
  normalizeSeason
} from '../src/utils/seasonalWithdrawalAlerts.js';

test('determina la temporada para el hemisferio sur', () => {
  assert.equal(getCurrentSeason(new Date(2026, 6, 1)), 'Otoño/Invierno');
  assert.equal(getCurrentSeason(new Date(2026, 0, 1)), 'Primavera/Verano');
});

test('mantiene compatibilidad con las temporadas anteriores', () => {
  assert.equal(normalizeSeason('Otoño'), 'Otoño/Invierno');
  assert.equal(normalizeSeason('Verano'), 'Primavera/Verano');
});

test('avisa artículos de temporada activa sin retiros durante 30 días', () => {
  const now = new Date('2026-07-15T12:00:00Z');
  const items = [
    { id: 'old-winter', code: 'A', season: 'Otoño/Invierno', total: { boxes: 2 }, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'recent', code: 'B', season: 'Sin temporada', total: { boxes: 1 }, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'summer', code: 'C', season: 'Primavera/Verano', total: { units: 3 }, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'new', code: 'D', season: 'Sin temporada', total: { units: 1 }, createdAt: '2026-07-01T00:00:00Z' },
    { id: 'depleted', code: 'E', season: 'Otoño/Invierno', total: { boxes: 0, units: 0 }, createdAt: '2026-01-01T00:00:00Z' }
  ];
  const requests = [
    { itemId: 'recent', type: 'egress', status: 'executed', executedAt: '2026-07-01T00:00:00Z' }
  ];
  const result = computeSeasonalWithdrawalAlerts(items, requests, { now });
  assert.equal(result.activeSeason, 'Otoño/Invierno');
  assert.deepEqual(result.alerts.map(item => item.id), ['old-winter']);
  assert.equal(result.alerts[0].lastWithdrawalAt, null);
});

test('incluye únicamente artículos con stock en cajas', () => {
  const result = computeSeasonalWithdrawalAlerts([
    { id: 'with-boxes', code: 'A', season: 'Sin temporada', total: { boxes: 2, units: 0 }, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'with-units', code: 'B', season: 'Sin temporada', total: { boxes: 0, units: 4 }, createdAt: '2026-01-01T00:00:00Z' },
    { id: 'depleted', code: 'C', season: 'Sin temporada', total: { boxes: 0, units: 0 }, createdAt: '2026-01-01T00:00:00Z' }
  ], [], { now: new Date('2026-07-15T12:00:00Z') });

  assert.deepEqual(result.alerts.map(item => item.id), ['with-boxes']);
});
