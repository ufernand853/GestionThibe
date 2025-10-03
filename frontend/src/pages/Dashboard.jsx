import { useEffect, useMemo, useState } from 'react';
import useApi from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import LoadingIndicator from '../components/LoadingIndicator.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
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
        if (!isMounted) return;
        setStockData(Array.isArray(stockResponse) ? stockResponse : []);
        setPendingRequests(Array.isArray(pendingResponse) ? pendingResponse : []);
        setCustomers(Array.isArray(customersResponse) ? customersResponse : []);
      } catch (err) {
        if (!isMounted) return;
        setError(err);
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

  const metrics = useMemo(() => {
    const totals = {
      items: stockData.length,
      general: { boxes: 0, units: 0 },
      overstock: { boxes: 0, units: 0 },
      customers: customers.length,
      pending: pendingRequests.filter(request => request.status === 'pending').length
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
  }, [customers.length, pendingRequests, stockData]);

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
        </div>
        <div className="metric-card">
          <h3>Sobrestock</h3>
          <p>{formatQuantity(metrics.overstock)}</p>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>General + Thibe + Arenal Import</span>
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

      {pendingRequests.length > 0 && (
        <div className="section-card">
          <div className="flex-between">
            <h2>Últimas solicitudes registradas</h2>
            <span style={{ color: '#64748b', fontSize: '0.85rem' }}>
              {pendingRequests.length > 5 ? 'Mostrando 5 más recientes' : `${pendingRequests.length} solicitudes`}
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
                {pendingRequests.slice(0, 5).map(request => (
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
