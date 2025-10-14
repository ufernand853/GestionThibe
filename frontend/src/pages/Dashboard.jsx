import { useEffect, useMemo, useState } from 'react';
import useApi from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import LoadingIndicator from '../components/LoadingIndicator.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import Sparkline from '../components/Sparkline.jsx';
import { formatQuantity, sumQuantities, ensureQuantity } from '../utils/quantity.js';
import { formatStockListLabel } from '../utils/stockLists.js';

export default function DashboardPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stockData, setStockData] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [stockTrends, setStockTrends] = useState(null);

  const canViewReports = permissions.includes('reports.read');
  const canManageRequests = permissions.includes('stock.request') || permissions.includes('stock.approve');
  const canViewCustomers = permissions.includes('items.read');

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        let stockResponse = [];
        if (canViewReports) {
          stockResponse = await api.get('/reports/stock');
        }
        let pendingResponse = [];
        if (canManageRequests) {
          pendingResponse = await api.get('/stock/requests', {
            query: permissions.includes('stock.approve') ? { status: 'pending' } : undefined
          });
        }
        let customersResponse = [];
        if (canViewCustomers) {
          customersResponse = await api.get('/customers');
        }
        let trendsResponse = null;
        if (canViewReports) {
          trendsResponse = await api.get('/reports/stock/trends', { query: { days: 30 } });
        }
        if (!isMounted) return;
        setStockData(Array.isArray(stockResponse) ? stockResponse : []);
        setPendingRequests(Array.isArray(pendingResponse) ? pendingResponse : []);
        setCustomers(Array.isArray(customersResponse) ? customersResponse : []);
        setStockTrends(trendsResponse && Array.isArray(trendsResponse.points) ? trendsResponse : null);
      } catch (err) {
        if (!isMounted) return;
        setError(err);
        setStockTrends(null);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      isMounted = false;
    };
  }, [api, canManageRequests, canViewCustomers, canViewReports, permissions]);

  const pendingApprovalRequests = useMemo(() => {
    return pendingRequests
      .filter(request => request.status === 'pending')
      .sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));
  }, [pendingRequests]);

  const metrics = useMemo(() => {
    const totals = {
      items: stockData.length,
      general: { boxes: 0, units: 0 },
      overstock: { boxes: 0, units: 0 },
      customers: customers.length,
      pending: pendingApprovalRequests.length
    };
    stockData.forEach(item => {
      const stock = item.stock || {};
      totals.general = sumQuantities(totals.general, stock.general);
      totals.overstock = sumQuantities(
        totals.overstock,
        stock.overstockGeneral,
        stock.overstockThibe,
        stock.overstockArenal
      );
    });
    return totals;
  }, [customers.length, pendingApprovalRequests, stockData]);

  const trendSummary = useMemo(() => {
    if (!stockTrends || !Array.isArray(stockTrends.points) || stockTrends.points.length === 0) {
      return null;
    }

    const quantityToValue = quantity => {
      const normalized = ensureQuantity(quantity);
      return normalized.boxes + normalized.units / 100;
    };

    const trendQuantityToValue = quantity => {
      if (!quantity) {
        return 0;
      }
      const boxes = Number(quantity.boxes ?? 0);
      const units = Number(quantity.units ?? 0);
      const safeBoxes = Number.isFinite(boxes) ? boxes : 0;
      const safeUnits = Number.isFinite(units) ? units : 0;
      return safeBoxes + safeUnits / 100;
    };

    const buildSeries = (currentQuantity, deltas) => {
      if (!deltas.length) {
        return [];
      }
      const currentValue = quantityToValue(currentQuantity);
      const totalDelta = deltas.reduce((acc, value) => acc + value, 0);
      let running = Math.max(0, currentValue - totalDelta);
      return deltas.map(delta => {
        running = Math.max(0, running + delta);
        return running;
      });
    };

    const computeChange = series => {
      if (!series.length) {
        return { change: 0, first: 0, last: 0 };
      }
      const first = series[0];
      const last = series[series.length - 1];
      const change = first === 0 ? 0 : ((last - first) / Math.abs(first)) * 100;
      return { change, first, last };
    };

    const generalDeltas = stockTrends.points.map(point => trendQuantityToValue(point.deltas?.general));
    const overstockDeltas = stockTrends.points.map(point => trendQuantityToValue(point.deltas?.overstock));

    const generalSeries = buildSeries(metrics.general, generalDeltas);
    const overstockSeries = buildSeries(metrics.overstock, overstockDeltas);

    return {
      window: stockTrends.points.length,
      general: { series: generalSeries, ...computeChange(generalSeries) },
      overstock: { series: overstockSeries, ...computeChange(overstockSeries) }
    };
  }, [metrics, stockTrends]);

  const getTrendIndicator = change => {
    if (change > 0) {
      return { arrow: '▲', className: 'positive' };
    }
    if (change < 0) {
      return { arrow: '▼', className: 'negative' };
    }
    return { arrow: '■', className: 'neutral' };
  };

  const generalIndicator = trendSummary?.general ? getTrendIndicator(trendSummary.general.change) : null;
  const overstockIndicator = trendSummary?.overstock
    ? getTrendIndicator(trendSummary.overstock.change)
    : null;

  const topGroups = useMemo(() => {
    const accumulator = new Map();
    stockData.forEach(item => {
      const groupName = item.group?.name || 'Sin grupo asignado';
      const previous = accumulator.get(groupName) || { boxes: 0, units: 0 };
      accumulator.set(groupName, sumQuantities(previous, item.stock?.general));
    });
    return Array.from(accumulator.entries())
      .sort((a, b) => {
        const qa = ensureQuantity(a[1]);
        const qb = ensureQuantity(b[1]);
        if (qa.boxes !== qb.boxes) {
          return qb.boxes - qa.boxes;
        }
        return qb.units - qa.units;
      })
      .slice(0, 5);
  }, [stockData]);

  if (loading) {
    return <LoadingIndicator message="Calculando métricas..." />;
  }

  return (
    <div className="dashboard-page">
      <h2>Resumen operativo</h2>
      <p style={{ color: '#475569', marginTop: '-0.5rem' }}>
        Visualice los indicadores clave del inventario, solicitudes y clientes en un solo lugar.
      </p>

      {error && <ErrorMessage error={error} />}

      <div className="metrics-grid">
        <div className="metric-card">
          <h3>Artículos activos</h3>
          <p>{metrics.items}</p>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Registros totales disponibles</span>
        </div>
        <div className="metric-card">
          <h3>Stock general</h3>
          <p>{formatQuantity(metrics.general)}</p>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Cajas y unidades en depósito principal</span>
          {trendSummary?.general?.series?.length > 0 && generalIndicator && (
            <div className="metric-trend">
              <Sparkline
                data={trendSummary.general.series}
                color="#2563eb"
                ariaLabel={`Evolución del stock general en los últimos ${trendSummary.window} días`}
              />
              <span
                className={`trend-indicator ${generalIndicator.className}`}
              >
                {generalIndicator.arrow}
                {` ${Math.abs(trendSummary.general.change).toFixed(1)}%`}
                <span>últimos {trendSummary.window} días</span>
              </span>
            </div>
          )}
        </div>
        <div className="metric-card">
          <h3>Sobrestock</h3>
          <p>{formatQuantity(metrics.overstock)}</p>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>General + Thibe + Arenal Import</span>
          {trendSummary?.overstock?.series?.length > 0 && overstockIndicator && (
            <div className="metric-trend">
              <Sparkline
                data={trendSummary.overstock.series}
                color="#0f766e"
                ariaLabel={`Evolución del sobrestock en los últimos ${trendSummary.window} días`}
              />
              <span
                className={`trend-indicator ${overstockIndicator.className}`}
              >
                {overstockIndicator.arrow}
                {` ${Math.abs(trendSummary.overstock.change).toFixed(1)}%`}
                <span>últimos {trendSummary.window} días</span>
              </span>
            </div>
          )}
        </div>
        <div className="metric-card">
          <h3>Clientes con stock reservado</h3>
          <p>{metrics.customers}</p>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Clientes activos registrados</span>
        </div>
        <div className="metric-card">
          <h3>Solicitudes pendientes</h3>
          <p>{metrics.pending}</p>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Movimientos a aprobar</span>
        </div>
      </div>

      {topGroups.length > 0 && (
        <div className="section-card">
          <div className="flex-between">
            <h2>Top 5 grupos por stock general</h2>
            <span style={{ color: '#64748b', fontSize: '0.85rem' }}>Basado en cajas y unidades disponibles</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Stock General</th>
                </tr>
              </thead>
              <tbody>
                {topGroups.map(([group, quantity]) => (
                  <tr key={group}>
                    <td>{group}</td>
                    <td>{formatQuantity(quantity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {pendingApprovalRequests.length > 0 && (
        <div className="section-card">
          <div className="flex-between">
            <h2>Solicitudes pendientes de aprobación</h2>
            <span style={{ color: '#64748b', fontSize: '0.85rem' }}>
              {pendingApprovalRequests.length > 5
                ? 'Mostrando 5 más recientes'
                : `${pendingApprovalRequests.length} solicitudes`}
            </span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Tipo</th>
                  <th>De</th>
                  <th>A</th>
                  <th>Cantidad</th>
                  <th>Estado</th>
                  <th>Solicitado por</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {pendingApprovalRequests.slice(0, 5).map(request => (
                  <tr key={request.id}>
                    <td>{request.item?.code || request.itemId}</td>
                    <td className="badge pending">{request.type}</td>
                    <td>{request.fromListLabel || formatStockListLabel(request.fromList) || '-'}</td>
                    <td>{request.toListLabel || formatStockListLabel(request.toList) || '-'}</td>
                    <td>{formatQuantity(request.quantity)}</td>
                    <td>
                      <span className={`badge ${request.status}`}>{request.status}</span>
                    </td>
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
