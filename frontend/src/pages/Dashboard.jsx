import { useEffect, useMemo, useState } from 'react';
import useApi from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import LoadingIndicator from '../components/LoadingIndicator.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import { formatQuantity, ensureQuantity, sumQuantities } from '../utils/quantity.js';

export default function DashboardPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const canViewReports = permissions.includes('reports.read');
  const canManageRequests = permissions.includes('stock.request') || permissions.includes('stock.approve');
  const canViewCatalog = permissions.includes('items.read');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stockByDeposit, setStockByDeposit] = useState([]);
  const [stockByGroup, setStockByGroup] = useState([]);
  const [pendingRequests, setPendingRequests] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [deposits, setDeposits] = useState([]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [depositTotals, groupDetails, pending, destinationsResponse, depositsResponse] = await Promise.all([
          canViewReports ? api.get('/reports/stock/by-deposit') : [],
          canViewReports ? api.get('/reports/stock/by-group') : [],
          canManageRequests
            ? api.get('/stock/requests', { query: { status: 'pending' } })
            : [],
          canViewCatalog ? api.get('/destinations') : [],
          canViewCatalog ? api.get('/deposits') : []
        ]);
        if (!active) return;
        setStockByDeposit(Array.isArray(depositTotals) ? depositTotals : []);
        setStockByGroup(Array.isArray(groupDetails) ? groupDetails : []);
        setPendingRequests(Array.isArray(pending) ? pending : []);
        setDestinations(Array.isArray(destinationsResponse) ? destinationsResponse : []);
        setDeposits(Array.isArray(depositsResponse) ? depositsResponse : []);
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

  const metrics = useMemo(() => {
    const totalItems = stockByGroup.reduce((acc, group) => acc + (Array.isArray(group.items) ? group.items.length : 0), 0);
    const totalStock = stockByDeposit.reduce((acc, entry) => sumQuantities(acc, ensureQuantity(entry.total)), {
      boxes: 0,
      units: 0
    });
    return {
      items: totalItems,
      totalStock,
      deposits: deposits.length,
      destinations: destinations.length,
      pending: pendingRequests.length
    };
  }, [destinations.length, deposits.length, pendingRequests.length, stockByDeposit, stockByGroup]);

  const topGroups = useMemo(() => {
    const ranking = stockByGroup
      .map(group => {
        const groupTotal = (group.items || []).reduce((acc, item) => {
          return (item.stockByDeposit || []).reduce(
            (innerAcc, depositEntry) => sumQuantities(innerAcc, ensureQuantity(depositEntry.quantity)),
            acc
          );
        }, { boxes: 0, units: 0 });
        return { id: group.id, name: group.name || 'Sin grupo', total: groupTotal };
      })
      .filter(entry => entry.total.boxes > 0 || entry.total.units > 0)
      .sort((a, b) => {
        if (a.total.boxes !== b.total.boxes) {
          return b.total.boxes - a.total.boxes;
        }
        return b.total.units - a.total.units;
      });
    return ranking.slice(0, 5);
  }, [stockByGroup]);

  if (loading) {
    return <LoadingIndicator message="Calculando métricas..." />;
  }

  return (
    <div className="dashboard-page">
      <h2>Resumen operativo</h2>
      <p style={{ color: '#475569', marginTop: '-0.5rem' }}>
        Visualice los indicadores clave del inventario, depósitos y destinos en un solo lugar.
      </p>

      {error && <ErrorMessage error={error} />}

      <div className="metrics-grid">
        <div className="metric-card">
          <h3>Artículos activos</h3>
          <p>{metrics.items}</p>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Registros totales disponibles</span>
        </div>
        <div className="metric-card">
          <h3>Stock total</h3>
          <p>{formatQuantity(metrics.totalStock)}</p>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Suma en todos los depósitos</span>
        </div>
        <div className="metric-card">
          <h3>Depósitos activos</h3>
          <p>{metrics.deposits}</p>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Configurados para transferencias</span>
        </div>
        <div className="metric-card">
          <h3>Destinos</h3>
          <p>{metrics.destinations}</p>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Contactos logísticos registrados</span>
        </div>
        <div className="metric-card">
          <h3>Solicitudes pendientes</h3>
          <p>{metrics.pending}</p>
          <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Transferencias por aprobar</span>
        </div>
      </div>

      {stockByDeposit.length > 0 && (
        <div className="section-card">
          <div className="flex-between">
            <h2>Stock por depósito</h2>
            <span style={{ color: '#64748b', fontSize: '0.85rem' }}>Detalle consolidado por ubicación</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Depósito</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {stockByDeposit.map(entry => (
                  <tr key={entry.id}>
                    <td>{entry.name || 'Depósito'}</td>
                    <td>{formatQuantity(entry.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {topGroups.length > 0 && (
        <div className="section-card">
          <div className="flex-between">
            <h2>Top 5 grupos por stock</h2>
            <span style={{ color: '#64748b', fontSize: '0.85rem' }}>Agrupado por cantidad total</span>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Grupo</th>
                  <th>Stock total</th>
                </tr>
              </thead>
              <tbody>
                {topGroups.map(group => (
                  <tr key={group.id || group.name}>
                    <td>{group.name}</td>
                    <td>{formatQuantity(group.total)}</td>
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
                    <td>{request.fromDeposit?.name || '-'}</td>
                    <td>{request.toDeposit?.name || '-'}</td>
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
