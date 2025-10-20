import { useEffect, useMemo, useState } from 'react';
import useApi from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import LoadingIndicator from '../components/LoadingIndicator.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import { formatQuantity, ensureQuantity, sumQuantities } from '../utils/quantity.js';
import { computeTotalStockFromMap } from '../utils/stockStatus.js';

const RECOUNT_THRESHOLD_DAYS = 30;
const ATTENTION_PAGE_SIZE = 10;

const formatDateForInput = date => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const canViewReports = permissions.includes('reports.read');
  const canManageRequests = permissions.includes('stock.request') || permissions.includes('stock.approve');
  const canViewCatalog = permissions.includes('items.read');

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
  const [attentionPage, setAttentionPage] = useState(1);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [locationTotals, locationsResponse, requestsResponse, itemsResponse] = await Promise.all([
          canViewReports ? api.get('/reports/stock/by-location') : Promise.resolve([]),
          canViewCatalog ? api.get('/locations') : Promise.resolve([]),
          canManageRequests ? api.get('/stock/requests') : Promise.resolve([]),
          canViewCatalog
            ? api.get('/items', { query: { page: 1, pageSize: 500 } })
            : Promise.resolve(null)
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
  }, [api, canManageRequests, canViewCatalog, canViewReports]);

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

  const inventoryAlerts = useMemo(() => {
    const now = Date.now();
    const thresholdMs = RECOUNT_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
    const recount = [];
    const outOfStock = [];
    itemSummaries.forEach(item => {
      if (item.total.boxes === 0 && item.total.units === 0) {
        outOfStock.push(item);
      }
      const updatedAtMs = item.updatedAt ? new Date(item.updatedAt).getTime() : 0;
      const reasons = [];
      let staleDays = null;
      if (!updatedAtMs || now - updatedAtMs >= thresholdMs) {
        staleDays = updatedAtMs
          ? Math.max(0, Math.floor((now - updatedAtMs) / (24 * 60 * 60 * 1000)))
          : null;
        reasons.push('stale');
      }
      if (item.needsRecount) {
        reasons.push('manual');
      }
      if (reasons.length > 0) {
        recount.push({ ...item, reasons, staleDays });
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
  }, [itemSummaries]);

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
        lastWithdrawal: null
      };
      existing.total = sumQuantities(existing.total, ensureQuantity(request.quantity));
      if (!existing.lastWithdrawal || executedTime > new Date(existing.lastWithdrawal).getTime()) {
        existing.lastWithdrawal = executedAt;
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

  const topItems = useMemo(() => rankedWithdrawals.slice(0, 5), [rankedWithdrawals]);

  useEffect(() => {
    setAttentionPage(1);
  }, [rankedWithdrawals.length]);

  const totalAttentionPages = useMemo(() => {
    if (rankedWithdrawals.length === 0) {
      return 1;
    }
    return Math.ceil(rankedWithdrawals.length / ATTENTION_PAGE_SIZE);
  }, [rankedWithdrawals.length]);

  useEffect(() => {
    if (attentionPage > totalAttentionPages) {
      setAttentionPage(totalAttentionPages);
    }
  }, [attentionPage, totalAttentionPages]);

  const attentionItems = useMemo(() => {
    const startIndex = (attentionPage - 1) * ATTENTION_PAGE_SIZE;
    const endIndex = startIndex + ATTENTION_PAGE_SIZE;
    return rankedWithdrawals.slice(startIndex, endIndex);
  }, [attentionPage, rankedWithdrawals]);

  if (loading) {
    return <LoadingIndicator message="Calculando métricas..." />;
  }

  const { recount: recountItems, outOfStock: outOfStockItems } = inventoryAlerts;

  return (
    <div className="dashboard-page">
      <h2>Resumen operativo</h2>
      <p style={{ color: '#475569', marginTop: '-0.5rem' }}>
        Visualice los indicadores clave del inventario, los recordatorios de conteo y las ubicaciones involucradas en las
        transferencias.
      </p>

      {error && <ErrorMessage error={error} />}

      <div className="metrics-grid">
        <div className="metric-card">
          <h3>Stock total</h3>
          <p>{formatQuantity(metrics.totalStock)}</p>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Suma en todas las ubicaciones</span>
        </div>
        <div className="metric-card">
          <h3>Depósitos internos</h3>
          <p>{metrics.warehouses}</p>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Ubicaciones habilitadas como origen</span>
        </div>
        <div className="metric-card">
          <h3>Destinos externos</h3>
          <p>{metrics.externals}</p>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Contactos logísticos registrados</span>
        </div>
        <div className="metric-card">
          <h3>Solicitudes pendientes</h3>
          <p>{metrics.pending}</p>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Transferencias por aprobar</span>
        </div>
      </div>

      {canViewCatalog && (
        <div className="alert-grid">
          <div className="alert-card">
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
          </div>
          <div className="alert-card alert-card--danger">
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
          </div>
        </div>
      )}

      {stockByLocation.length > 0 && (
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
                  <th>Último retiro</th>
                </tr>
              </thead>
              <tbody>
                {topItems.map(item => (
                  <tr key={item.id}>
                    <td>{item.code}</td>
                    <td>{item.description}</td>
                    <td>{formatQuantity(item.total)}</td>
                    <td>{item.lastWithdrawal ? new Date(item.lastWithdrawal).toLocaleString('es-AR') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="section-card">
        <div className="flex-between" style={{ alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <h2>Atención</h2>
            <span style={{ color: '#64748b', fontSize: '0.85rem' }}>
              Enfoque por artículo para el mismo rango seleccionado
            </span>
          </div>
        </div>
        {rankedWithdrawals.length === 0 ? (
          <p style={{ color: '#64748b', marginTop: '1rem' }}>
            No se encontraron retiros ejecutados en el rango seleccionado.
          </p>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th>Total retirado</th>
                  <th>Último retiro</th>
                </tr>
              </thead>
              <tbody>
                {attentionItems.map(item => (
                  <tr key={item.id}>
                    <td>{item.code}</td>
                    <td>{item.description}</td>
                    <td>{formatQuantity(item.total)}</td>
                    <td>{item.lastWithdrawal ? new Date(item.lastWithdrawal).toLocaleString('es-AR') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalAttentionPages > 1 && (
              <div
                className="inline-actions"
                style={{
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: '1rem',
                  flexWrap: 'wrap',
                  gap: '0.75rem'
                }}
              >
                <span style={{ color: '#475569', fontSize: '0.85rem' }}>
                  Página {attentionPage} de {totalAttentionPages}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => setAttentionPage(page => Math.max(1, page - 1))}
                    disabled={attentionPage === 1}
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    onClick={() => setAttentionPage(page => Math.min(totalAttentionPages, page + 1))}
                    disabled={attentionPage === totalAttentionPages}
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {pendingRequests.length > 0 && (
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
