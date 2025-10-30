import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import useApi from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import LoadingIndicator from '../components/LoadingIndicator.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import { formatQuantity, ensureQuantity, sumQuantities } from '../utils/quantity.js';
import { computeTotalStockFromMap } from '../utils/stockStatus.js';
import { computeInventoryAlerts, RECOUNT_THRESHOLD_DAYS } from '../utils/inventoryAlerts.js';

const ATTENTION_MANUAL_LIMIT = 5;

const formatDateForInput = date => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const normalizeManualAttentionIds = ids => {
  if (!Array.isArray(ids)) {
    return [];
  }
  const seen = new Set();
  const normalized = [];
  ids.forEach(value => {
    const stringValue = String(value);
    if (!seen.has(stringValue) && normalized.length < ATTENTION_MANUAL_LIMIT) {
      seen.add(stringValue);
      normalized.push(stringValue);
    }
  });
  return normalized;
};

const parseDateFromInput = value => {
  if (!value) {
    return null;
  }
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }
  return new Date(year, month - 1, day);
};

export default function DashboardPage() {
  const api = useApi();
  const { user } = useAuth();
  const isOperator = user?.role === 'Operador';
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const canViewReports = permissions.includes('reports.read');
  const canManageRequests = permissions.includes('stock.request') || permissions.includes('stock.approve');
  const canViewCatalog = permissions.includes('items.read');
  const shouldLoadStockSummary = canViewReports && !isOperator;
  const shouldLoadLocations = canViewCatalog && !isOperator;
  const shouldLoadRequests = canManageRequests && !isOperator;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stockByLocation, setStockByLocation] = useState([]);
  const [locations, setLocations] = useState([]);
  const [requests, setRequests] = useState([]);
  const [itemsSnapshot, setItemsSnapshot] = useState([]);
  const [topStartDate, setTopStartDate] = useState(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - 6);
    return formatDateForInput(date);
  });
  const [topEndDate, setTopEndDate] = useState(() => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return formatDateForInput(date);
  });
  const [manualAttentionIds, setManualAttentionIds] = useState([]);
  const [savedManualAttentionIds, setSavedManualAttentionIds] = useState([]);
  const [manualAttentionSaving, setManualAttentionSaving] = useState(false);
  const [manualAttentionFeedback, setManualAttentionFeedback] = useState(null);
  const [manualSelectionValue, setManualSelectionValue] = useState('');
  const [attentionSearch, setAttentionSearch] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const preferencesPromise = api.get('/preferences').catch(error => {
          console.warn('No se pudieron cargar las preferencias del usuario', error);
          return null;
        });
        const [
          locationTotals,
          locationsResponse,
          requestsResponse,
          itemsResponse,
          preferencesResponse
        ] = await Promise.all([
          shouldLoadStockSummary ? api.get('/reports/stock/by-location') : Promise.resolve([]),
          shouldLoadLocations ? api.get('/locations') : Promise.resolve([]),
          shouldLoadRequests ? api.get('/stock/requests') : Promise.resolve([]),
          canViewCatalog
            ? api.get('/items', { query: { page: 1, pageSize: 500 } })
            : Promise.resolve(null),
          preferencesPromise
        ]);
        if (!active) return;
        setStockByLocation(Array.isArray(locationTotals) ? locationTotals : []);
        setLocations(Array.isArray(locationsResponse) ? locationsResponse : []);
        setRequests(Array.isArray(requestsResponse) ? requestsResponse : []);
        if (itemsResponse && Array.isArray(itemsResponse.items)) {
          setItemsSnapshot(itemsResponse.items);
        } else {
          setItemsSnapshot([]);
        }
        const normalizedManualIds = normalizeManualAttentionIds(
          preferencesResponse?.dashboard?.manualAttentionIds
        );
        setManualAttentionIds(normalizedManualIds);
        setSavedManualAttentionIds(normalizedManualIds);
        setManualAttentionFeedback(null);
      } catch (err) {
        if (!active) return;
        setError(err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [
    api,
    canViewCatalog,
    shouldLoadLocations,
    shouldLoadRequests,
    shouldLoadStockSummary
  ]);

  const pendingRequests = useMemo(() => {
    if (!Array.isArray(requests)) {
      return [];
    }
    return requests.filter(request => request.status === 'pending');
  }, [requests]);

  const metrics = useMemo(() => {
    const totalStock = stockByLocation.reduce(
      (acc, entry) => sumQuantities(acc, ensureQuantity(entry.total)),
      { boxes: 0, units: 0 }
    );
    const warehouses = locations.filter(location => location.type === 'warehouse');
    const externals = locations.filter(location => location.type === 'external');
    return {
      totalStock,
      warehouses: warehouses.length,
      externals: externals.length,
      pending: pendingRequests.length
    };
  }, [locations, pendingRequests.length, stockByLocation]);

  const itemSummaries = useMemo(() => {
    if (!Array.isArray(itemsSnapshot)) {
      return [];
    }
    return itemsSnapshot.map(item => ({
      id: item.id,
      code: item.code,
      description: item.description,
      total: computeTotalStockFromMap(item.stock),
      updatedAt: item.updatedAt,
      group: item.group || null,
      needsRecount: Boolean(item.needsRecount)
    }));
  }, [itemsSnapshot]);

  const itemsById = useMemo(() => {
    const map = new Map();
    itemSummaries.forEach(item => {
      map.set(item.id, item);
    });
    return map;
  }, [itemSummaries]);

  useEffect(() => {
    setManualAttentionIds(prev => {
      if (!Array.isArray(prev) || prev.length === 0) {
        return prev;
      }
      const validIds = new Set(itemSummaries.map(item => item.id));
      const filtered = prev.filter(id => validIds.has(id));
      if (filtered.length === prev.length) {
        return prev;
      }
      return filtered;
    });
  }, [itemSummaries]);

  const inventoryAlerts = useMemo(() => computeInventoryAlerts(itemSummaries), [itemSummaries]);

  const rankedWithdrawals = useMemo(() => {
    const startDate = parseDateFromInput(topStartDate);
    const endDate = parseDateFromInput(topEndDate);
    const startMs = startDate ? startDate.setHours(0, 0, 0, 0) : null;
    const endMs = endDate ? endDate.setHours(23, 59, 59, 999) : null;
    const aggregated = new Map();
    (Array.isArray(requests) ? requests : []).forEach(request => {
      if (request.status !== 'executed') {
        return;
      }
      const executedAt = request.executedAt || request.approvedAt || request.requestedAt;
      if (!executedAt) {
        return;
      }
      const executedTime = new Date(executedAt).getTime();
      if (Number.isNaN(executedTime)) {
        return;
      }
      if (startMs !== null && executedTime < startMs) {
        return;
      }
      if (endMs !== null && executedTime > endMs) {
        return;
      }
      const itemId = request.item?.id || request.itemId;
      if (!itemId) {
        return;
      }
      const referenceItem = itemsById.get(itemId);
      const existing = aggregated.get(itemId) || {
        id: itemId,
        code: referenceItem?.code || request.item?.code || itemId,
        description: referenceItem?.description || request.item?.description || 'Artículo',
        group: referenceItem?.group || request.item?.group || null,
        groupId:
          referenceItem?.group?.id ||
          referenceItem?.group?._id ||
          request.item?.groupId ||
          (typeof request.item?.group === 'object'
            ? request.item?.group?.id || request.item?.group?._id
            : null) ||
          null,
        total: { boxes: 0, units: 0 },
        lastWithdrawal: null,
        currentStock: referenceItem?.total || null
      };
      existing.total = sumQuantities(existing.total, ensureQuantity(request.quantity));
      if (!existing.lastWithdrawal || executedTime > new Date(existing.lastWithdrawal).getTime()) {
        existing.lastWithdrawal = executedAt;
      }
      if (!existing.currentStock && referenceItem?.total) {
        existing.currentStock = referenceItem.total;
      }
      if (!existing.group && referenceItem?.group) {
        existing.group = referenceItem.group;
      }
      if (!existing.groupId && (referenceItem?.group?.id || referenceItem?.group?._id)) {
        existing.groupId = referenceItem.group.id || referenceItem.group._id;
      }
      aggregated.set(itemId, existing);
    });
    return Array.from(aggregated.values()).sort((a, b) => {
      if (a.total.boxes !== b.total.boxes) {
        return b.total.boxes - a.total.boxes;
      }
      if (a.total.units !== b.total.units) {
        return b.total.units - a.total.units;
      }
      const aDate = a.lastWithdrawal ? new Date(a.lastWithdrawal).getTime() : 0;
      const bDate = b.lastWithdrawal ? new Date(b.lastWithdrawal).getTime() : 0;
      return bDate - aDate;
    });
  }, [itemsById, requests, topEndDate, topStartDate]);

  const rankedWithdrawalsMap = useMemo(() => {
    const map = new Map();
    rankedWithdrawals.forEach(item => {
      map.set(item.id, item);
    });
    return map;
  }, [rankedWithdrawals]);

  const topItems = useMemo(() => rankedWithdrawals.slice(0, 5), [rankedWithdrawals]);

  const availableAttentionOptions = useMemo(() => {
    const taken = new Set(manualAttentionIds);
    return itemSummaries
      .filter(item => !taken.has(item.id))
      .sort((a, b) => a.code.localeCompare(b.code, 'es', { sensitivity: 'base' }));
  }, [itemSummaries, manualAttentionIds]);

  const filteredAttentionOptions = useMemo(() => {
    const search = attentionSearch.trim().toLowerCase();
    if (!search) {
      return availableAttentionOptions;
    }
    return availableAttentionOptions.filter(option => {
      const haystack = `${option.code || ''} ${option.description || ''}`.toLowerCase();
      return haystack.includes(search);
    });
  }, [attentionSearch, availableAttentionOptions]);

  const manualAttentionItems = useMemo(() => {
    if (manualAttentionIds.length === 0) {
      return [];
    }
    return manualAttentionIds
      .map(id => {
        const ranked = rankedWithdrawalsMap.get(id);
        if (ranked) {
          if (!ranked.currentStock) {
            const reference = itemsById.get(id);
            if (reference?.total) {
              ranked.currentStock = reference.total;
            }
          }
          return ranked;
        }
        const fallback = itemsById.get(id);
        if (fallback) {
          return {
            id,
            code: fallback.code,
            description: fallback.description,
            total: { boxes: 0, units: 0 },
            lastWithdrawal: null,
            currentStock: fallback.total || null
          };
        }
        return null;
      })
      .filter(Boolean);
  }, [itemsById, manualAttentionIds, rankedWithdrawalsMap]);

  const hasManualAttentionChanges = useMemo(() => {
    if (manualAttentionIds.length !== savedManualAttentionIds.length) {
      return true;
    }
    for (let index = 0; index < manualAttentionIds.length; index += 1) {
      if (manualAttentionIds[index] !== savedManualAttentionIds[index]) {
        return true;
      }
    }
    return false;
  }, [manualAttentionIds, savedManualAttentionIds]);

  useEffect(() => {
    if (hasManualAttentionChanges) {
      setManualAttentionFeedback(prev => (prev?.type === 'success' ? null : prev));
    }
  }, [hasManualAttentionChanges]);

  useEffect(() => {
    if (manualAttentionFeedback?.type === 'success') {
      const timeout = setTimeout(() => {
        setManualAttentionFeedback(null);
      }, 4000);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [manualAttentionFeedback]);

  const attentionHelperText = 'Personalizá la lista eligiendo hasta cinco artículos.';

  const manualSelectionDisabled =
    manualAttentionIds.length >= ATTENTION_MANUAL_LIMIT || filteredAttentionOptions.length === 0;

  const handleManualSelectionSubmit = () => {
    if (!manualSelectionValue) {
      return;
    }
    const nextId = String(manualSelectionValue);
    setManualAttentionIds(prev => {
      if (prev.includes(nextId) || prev.length >= ATTENTION_MANUAL_LIMIT) {
        return prev;
      }
      return [...prev, nextId];
    });
    setManualSelectionValue('');
  };

  const handleManualSelectionClear = () => {
    setManualSelectionValue('');
    setAttentionSearch('');
    setManualAttentionIds([]);
  };

  const handleManualAttentionRemove = id => {
    setManualAttentionIds(prev => prev.filter(existingId => existingId !== id));
  };

  const handleManualAttentionApply = async () => {
    setManualAttentionSaving(true);
    setManualAttentionFeedback(null);
    try {
      const response = await api.put('/preferences', {
        dashboard: { manualAttentionIds }
      });
      const normalizedManualIds = normalizeManualAttentionIds(
        response?.dashboard?.manualAttentionIds
      );
      setManualAttentionIds(normalizedManualIds);
      setSavedManualAttentionIds(normalizedManualIds);
      setManualAttentionFeedback({ type: 'success', message: 'Configuración guardada.' });
    } catch (err) {
      setManualAttentionFeedback({
        type: 'error',
        message: err?.message || 'No se pudo guardar la configuración.'
      });
    } finally {
      setManualAttentionSaving(false);
    }
  };

  const shouldShowEmptyAttentionMessage = manualAttentionItems.length === 0;

  const manualAttentionStatusClass = manualAttentionFeedback
    ? `attention-actions__status attention-actions__status--${manualAttentionFeedback.type}`
    : null;
  const manualAttentionStatusRole = manualAttentionFeedback?.type === 'error' ? 'alert' : 'status';

  if (loading) {
    return <LoadingIndicator message="Calculando métricas..." />;
  }

  const { recount: recountItems, outOfStock: outOfStockItems } = inventoryAlerts;

  const summaryCards = [
    {
      key: 'total',
      title: 'Stock total',
      value: formatQuantity(metrics.totalStock),
      helper: 'Suma en todas las ubicaciones',
      hideForOperator: true
    },
    {
      key: 'warehouses',
      title: 'Depósitos internos',
      value: metrics.warehouses,
      helper: 'Ubicaciones habilitadas como origen',
      hideForOperator: true
    },
    {
      key: 'externals',
      title: 'Destinos externos',
      value: metrics.externals,
      helper: 'Contactos logísticos registrados',
      hideForOperator: true
    },
    {
      key: 'pending',
      title: 'Solicitudes pendientes',
      value: metrics.pending,
      helper: 'Transferencias por aprobar',
      hideForOperator: true
    }
  ];

  const visibleSummaryCards = summaryCards.filter(
    card => !(isOperator && card.hideForOperator)
  );

  return (
    <div className="dashboard-page">
      <h2>Resumen operativo</h2>
      <p style={{ color: '#475569', marginTop: '-0.5rem' }}>
        Visualice los indicadores clave del inventario, los recordatorios de conteo y las ubicaciones involucradas en las
        transferencias.
      </p>

      {error && <ErrorMessage error={error} />}

      {visibleSummaryCards.length > 0 && (
        <div className="metrics-grid">
          {visibleSummaryCards.map(card => (
            <div key={card.key} className="metric-card">
              <h3>{card.title}</h3>
              <p>{card.value}</p>
              {card.helper && (
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{card.helper}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {canViewCatalog && (
        <div className="alert-grid">
          <Link to="/inventory/alerts#recount" className="alert-card alert-card--interactive">
            <h3>Recuento pendiente</h3>
            <p>
              {recountItems.length === 0
                ? 'Todos los artículos registran recuentos recientes.'
                : `${recountItems.length} artículos requieren recuento (marcados manualmente o sin actualización en ${RECOUNT_THRESHOLD_DAYS}+ días).`}
            </p>
            {recountItems.length > 0 && (
              <ul>
                {recountItems.slice(0, 5).map(item => {
                  const reasonParts = [];
                  if (item.reasons.includes('manual')) {
                    reasonParts.push('marcado manualmente');
                  }
                  if (item.reasons.includes('stale')) {
                    let label;
                    if (item.staleDays === null) {
                      label = 'sin registro de actualización';
                    } else if (item.staleDays === 1) {
                      label = '1 día sin actualización';
                    } else {
                      label = `${item.staleDays} días sin actualización`;
                    }
                    reasonParts.push(label);
                  }
                  return (
                    <li key={item.id}>
                      {item.code} · {reasonParts.join(' · ')}
                    </li>
                  );
                })}
              </ul>
            )}
          </Link>
          <Link to="/inventory/alerts#out-of-stock" className="alert-card alert-card--danger alert-card--interactive">
            <h3>Artículos agotados</h3>
            <p>
              {outOfStockItems.length === 0
                ? 'No hay artículos agotados.'
                : `${outOfStockItems.length} artículos sin stock disponible.`}
            </p>
            {outOfStockItems.length > 0 && (
              <ul>
                {outOfStockItems.slice(0, 5).map(item => (
                  <li key={item.id}>
                    {item.code} · {item.description}
                  </li>
                ))}
              </ul>
            )}
          </Link>
        </div>
      )}

      {!isOperator && stockByLocation.length > 0 && (
        <div className="section-card">
          <div className="flex-between">
            <h2>Stock por ubicación</h2>
            <span style={{ color: '#64748b', fontSize: '0.85rem' }}>Detalle consolidado por ubicación</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Ubicación</th>
                  <th>Tipo</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {stockByLocation.map(entry => (
                  <tr key={entry.id}>
                    <td>{entry.name || 'Ubicación'}</td>
                    <td>{entry.type === 'external' ? 'Destino externo' : 'Depósito interno'}</td>
                    <td>{formatQuantity(entry.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!isOperator && (
        <div className="section-card">
        <div className="flex-between" style={{ alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h2>Top 5</h2>
            <span style={{ color: '#64748b', fontSize: '0.85rem' }}>
              Retiros ejecutados en el rango seleccionado
            </span>
          </div>
          <div className="inline-actions" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            <label htmlFor="topStartDate" style={{ color: '#475569', fontSize: '0.85rem' }}>
              Desde
            </label>
            <input
              id="topStartDate"
              type="date"
              value={topStartDate}
              max={topEndDate || undefined}
              onChange={event => {
                const value = event.target.value;
                setTopStartDate(value);
                if (topEndDate && value && value > topEndDate) {
                  setTopEndDate(value);
                }
              }}
            />
            <label htmlFor="topEndDate" style={{ color: '#475569', fontSize: '0.85rem' }}>
              Hasta
            </label>
            <input
              id="topEndDate"
              type="date"
              value={topEndDate}
              min={topStartDate || undefined}
              onChange={event => {
                const value = event.target.value;
                setTopEndDate(value);
                if (topStartDate && value && value < topStartDate) {
                  setTopStartDate(value);
                }
              }}
            />
          </div>
        </div>
        {topItems.length === 0 ? (
          <p style={{ color: '#64748b', marginTop: '1rem' }}>
            No se registraron retiros ejecutados en el rango seleccionado.
          </p>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th>Total retirado</th>
                  <th>Stock disponible</th>
                  <th>Último retiro</th>
                </tr>
              </thead>
              <tbody>
                {topItems.map(item => (
                  <tr key={item.id}>
                    <td>{item.code}</td>
                    <td>{item.description}</td>
                    <td>{formatQuantity(item.total)}</td>
                    <td>{item.currentStock ? formatQuantity(item.currentStock) : '-'}</td>
                    <td>{item.lastWithdrawal ? new Date(item.lastWithdrawal).toLocaleString('es-AR') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>
      )}

      {!isOperator && (
        <div className="section-card">
        <div className="flex-between" style={{ alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h2>Atención</h2>
            <span style={{ color: '#64748b', fontSize: '0.85rem' }}>{attentionHelperText}</span>
          </div>
        </div>
        <div className="attention-selection">
          {canViewCatalog ? (
            <>
              <div className="attention-actions">
                <div className="attention-actions__field input-group" style={{ minWidth: '220px' }}>
                  <label htmlFor="attentionSearch">Buscar artículo</label>
                  <input
                    id="attentionSearch"
                    type="text"
                    placeholder="Código o descripción"
                    value={attentionSearch}
                    onChange={event => setAttentionSearch(event.target.value)}
                  />
                </div>
                <div className="attention-actions__field input-group" style={{ minWidth: '240px' }}>
                  <label htmlFor="attentionSelect">Agregar a la lista</label>
                  <select
                    id="attentionSelect"
                    value={manualSelectionValue}
                    onChange={event => setManualSelectionValue(event.target.value)}
                    disabled={manualSelectionDisabled}
                  >
                    <option value="">Seleccionar...</option>
                    {filteredAttentionOptions.map(option => (
                      <option key={option.id} value={option.id}>
                        {option.code} · {option.description}
                      </option>
                    ))}
                  </select>
                  <p className="input-helper">
                    Hasta {ATTENTION_MANUAL_LIMIT} artículos. Los valores muestran retiros en el rango elegido.
                  </p>
                </div>
                <div className="attention-actions__field attention-actions__field--buttons">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleManualSelectionSubmit}
                    disabled={manualSelectionDisabled || !manualSelectionValue}
                  >
                    Agregar
                  </button>
                </div>
                <div className="attention-actions__field attention-actions__field--buttons">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={handleManualSelectionClear}
                    disabled={manualAttentionIds.length === 0}
                  >
                    Limpiar selección
                  </button>
                </div>
                <div className="attention-actions__field attention-actions__field--buttons">
                  <button
                    type="button"
                    onClick={handleManualAttentionApply}
                    disabled={!hasManualAttentionChanges || manualAttentionSaving}
                  >
                    {manualAttentionSaving ? 'Guardando…' : 'Aplicar cambios'}
                  </button>
                  {manualAttentionFeedback && manualAttentionStatusClass && (
                    <p className={manualAttentionStatusClass} role={manualAttentionStatusRole}>
                      {manualAttentionFeedback.message}
                    </p>
                  )}
                </div>
              </div>
              {attentionSearch.trim() && filteredAttentionOptions.length === 0 && (
                <p className="input-helper">No hay resultados para la búsqueda actual.</p>
              )}
              {manualAttentionItems.length > 0 && (
                <ul className="selection-chips">
                  {manualAttentionItems.map(item => (
                    <li key={item.id} className="selection-chip">
                      <span>
                        {item.code} · {item.description}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleManualAttentionRemove(item.id)}
                        aria-label={`Quitar ${item.code}`}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p style={{ color: '#64748b', margin: '1rem 0 0' }}>
              Necesitás permisos de catálogo para configurar esta lista.
            </p>
          )}
        </div>

        {shouldShowEmptyAttentionMessage ? (
          <p style={{ color: '#64748b', marginTop: '1rem' }}>
            Seleccioná artículos para monitorear en la lista personalizada.
          </p>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th>Total retirado</th>
                  <th>Stock disponible</th>
                  <th>Último retiro</th>
                </tr>
              </thead>
              <tbody>
                {manualAttentionItems.map(item => (
                  <tr key={item.id}>
                    <td>{item.code}</td>
                    <td>{item.description}</td>
                    <td>{formatQuantity(item.total)}</td>
                    <td>{item.currentStock ? formatQuantity(item.currentStock) : '-'}</td>
                    <td>{item.lastWithdrawal ? new Date(item.lastWithdrawal).toLocaleString('es-AR') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>
      )}

      {!isOperator && pendingRequests.length > 0 && (
        <div className="section-card">
          <div className="flex-between">
            <h2>Solicitudes pendientes de aprobación</h2>
            <span style={{ color: '#64748b', fontSize: '0.85rem' }}>
              {pendingRequests.length > 5 ? 'Mostrando 5 más recientes' : `${pendingRequests.length} solicitudes`}
            </span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Origen</th>
                  <th>Destino</th>
                  <th>Cantidad</th>
                  <th>Solicitado por</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {pendingRequests.slice(0, 5).map(request => (
                  <tr key={request.id}>
                    <td>{request.item?.code || request.itemId}</td>
                    <td>{request.fromLocation?.name || '-'}</td>
                    <td>{request.toLocation?.name || '-'}</td>
                    <td>{formatQuantity(request.quantity)}</td>
                    <td>{request.requestedBy?.username || 'N/D'}</td>
                    <td>{new Date(request.requestedAt).toLocaleString('es-AR')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
