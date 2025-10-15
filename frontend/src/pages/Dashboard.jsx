import { useEffect, useMemo, useState } from 'react';
import useApi from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import LoadingIndicator from '../components/LoadingIndicator.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import { formatQuantity, ensureQuantity, sumQuantities } from '../utils/quantity.js';
import { computeTotalStockFromMap } from '../utils/stockStatus.js';

const RECOUNT_THRESHOLD_DAYS = 30;

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
      updatedAt: item.updatedAt
    }));
  }, [itemsSnapshot]);

  const inventoryAlerts = useMemo(() => {
    const now = Date.now();
    const thresholdMs = RECOUNT_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
    const stale = [];
    const outOfStock = [];
    itemSummaries.forEach(item => {
      if (item.total.boxes === 0 && item.total.units === 0) {
        outOfStock.push(item);
      }
      const updatedAtMs = item.updatedAt ? new Date(item.updatedAt).getTime() : 0;
      if (!updatedAtMs || now - updatedAtMs >= thresholdMs) {
        stale.push(item);
      }
    });
    return { stale, outOfStock };
  }, [itemSummaries]);

  const lastWithdrawalByItem = useMemo(() => {
    const map = new Map();
    (Array.isArray(requests) ? requests : []).forEach(request => {
      if (request.status !== 'executed') {
        return;
      }
      const itemId = request.item?.id || request.itemId;
      if (!itemId) {
        return;
      }
      const executedAt = request.executedAt || request.approvedAt || request.requestedAt;
      if (!executedAt) {
        return;
      }
      const current = map.get(itemId);
      if (!current || new Date(executedAt) > new Date(current)) {
        map.set(itemId, executedAt);
      }
    });
    return map;
  }, [requests]);

  const topItems = useMemo(() => {
    const ranked = itemSummaries
      .filter(item => item.total.boxes > 0 || item.total.units > 0)
      .map(item => ({
        ...item,
        lastWithdrawal: lastWithdrawalByItem.get(item.id) || null
      }))
      .sort((a, b) => {
        if (a.total.boxes !== b.total.boxes) {
          return b.total.boxes - a.total.boxes;
        }
        return b.total.units - a.total.units;
      });
    return ranked.slice(0, 5);
  }, [itemSummaries, lastWithdrawalByItem]);

  if (loading) {
    return <LoadingIndicator message="Calculando métricas..." />;
  }

  const { stale: staleItems, outOfStock: outOfStockItems } = inventoryAlerts;
  const now = Date.now();

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
              {staleItems.length === 0
                ? 'Todos los artículos registran recuentos recientes.'
                : `${staleItems.length} artículos superan ${RECOUNT_THRESHOLD_DAYS} días sin recuento.`}
            </p>
            {staleItems.length > 0 && (
              <ul>
                {staleItems.slice(0, 5).map(item => {
                  const updatedAt = item.updatedAt ? new Date(item.updatedAt) : null;
                  const daysWithoutUpdate = updatedAt
                    ? Math.max(0, Math.floor((now - updatedAt.getTime()) / (24 * 60 * 60 * 1000)))
                    : null;
                  const label =
                    daysWithoutUpdate === null
                      ? 'sin registro'
                      : daysWithoutUpdate === 1
                        ? '1 día'
                        : `${daysWithoutUpdate} días`;
                  return (
                    <li key={item.id}>
                      {item.code} · {label} sin actualización
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

      {topItems.length > 0 && (
        <div className="section-card">
          <div className="flex-between">
            <h2>Top 5 artículos por stock</h2>
            <span style={{ color: '#64748b', fontSize: '0.85rem' }}>Ordenado por cantidad consolidada</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th>Stock total</th>
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
        </div>
      )}

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
