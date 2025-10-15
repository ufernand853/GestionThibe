import { useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';
import { exportToCsv } from '../../utils/export.js';
import { ensureQuantity, formatQuantity, sumQuantities } from '../../utils/quantity.js';

export default function ReportsPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const canViewReports = permissions.includes('reports.read');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [groupData, setGroupData] = useState([]);
  const [depositData, setDepositData] = useState([]);
  const [filters, setFilters] = useState({ groupId: '', search: '' });

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [groupResponse, depositResponse] = await Promise.all([
          api.get('/reports/stock/by-group'),
          api.get('/reports/stock/by-deposit')
        ]);
        if (!active) return;
        setGroupData(Array.isArray(groupResponse) ? groupResponse : []);
        setDepositData(Array.isArray(depositResponse) ? depositResponse : []);
      } catch (err) {
        if (!active) return;
        setError(err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    if (canViewReports) {
      load();
    } else {
      setLoading(false);
      setError('No tiene permisos para acceder a los reportes.');
    }
    return () => {
      active = false;
    };
  }, [api, canViewReports]);

  const flattenedItems = useMemo(() => {
    const items = [];
    groupData.forEach(group => {
      (group.items || []).forEach(item => {
        items.push({
          ...item,
          groupId: group.id,
          groupName: group.name || 'Sin grupo',
          stockByDeposit: Array.isArray(item.stockByDeposit) ? item.stockByDeposit : [],
          code: item.code ?? '',
          description: item.description ?? ''
        });
      });
    });
    return items;
  }, [groupData]);

  const uniqueGroups = useMemo(() => {
    const options = groupData
      .map(group => ({ id: group.id || '', name: group.name || 'Sin grupo' }))
      .filter((value, index, self) => index === self.findIndex(entry => entry.id === value.id && entry.name === value.name));
    return options;
  }, [groupData]);

  const filteredItems = useMemo(() => {
    return flattenedItems.filter(item => {
      const matchesGroup = !filters.groupId || item.groupId === filters.groupId;
      const matchesSearch =
        !filters.search ||
        item.code.toLowerCase().includes(filters.search.toLowerCase()) ||
        item.description.toLowerCase().includes(filters.search.toLowerCase());
      return matchesGroup && matchesSearch;
    });
  }, [filters.groupId, filters.search, flattenedItems]);

  const handleExport = () => {
    const rows = filteredItems.map(item => {
      const totals = (item.stockByDeposit || []).reduce(
        (acc, entry) => sumQuantities(acc, ensureQuantity(entry.quantity)),
        { boxes: 0, units: 0 }
      );
      return {
        codigo: item.code,
        descripcion: item.description,
        grupo: item.groupName,
        stock_total_cajas: totals.boxes,
        stock_total_unidades: totals.units
      };
    });
    exportToCsv('reporte_stock.csv', rows);
  };

  if (!canViewReports) {
    return <ErrorMessage error="No tiene permisos para acceder a esta sección." />;
  }

  if (loading) {
    return <LoadingIndicator message="Generando reporte de stock..." />;
  }

  return (
    <div>
      <h2>Reportes de stock</h2>
      <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
        Analice el inventario consolidado por grupo y por depósito.
      </p>

      {error && <ErrorMessage error={error} />}

      <div className="section-card">
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div className="input-group">
            <label htmlFor="search">Buscar</label>
            <input
              id="search"
              value={filters.search}
              onChange={event => setFilters(prev => ({ ...prev, search: event.target.value }))}
              placeholder="Código o descripción"
            />
          </div>
          <div className="input-group">
            <label htmlFor="group">Grupo</label>
            <select id="group" value={filters.groupId} onChange={event => setFilters(prev => ({ ...prev, groupId: event.target.value }))}>
              <option value="">Todos</option>
              {uniqueGroups.map(group => (
                <option key={group.id || group.name} value={group.id || ''}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button type="button" onClick={handleExport} disabled={filteredItems.length === 0}>
              Exportar CSV
            </button>
          </div>
        </div>
      </div>

      <div className="section-card">
        <h3>Detalle por artículo</h3>
        <div className="table-wrapper" style={{ marginTop: '1rem' }}>
          <table>
            <thead>
              <tr>
                <th>Código</th>
                <th>Descripción</th>
                <th>Grupo</th>
                <th>Depósitos</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map(item => {
                const deposits = item.stockByDeposit || [];
                const total = deposits.reduce(
                  (acc, entry) => sumQuantities(acc, ensureQuantity(entry.quantity)),
                  { boxes: 0, units: 0 }
                );
                return (
                  <tr key={item.id}>
                    <td>{item.code}</td>
                    <td>{item.description}</td>
                    <td>{item.groupName}</td>
                    <td>
                      <div className="chip-list">
                        {deposits.map(entry => (
                          <span key={entry.depositId || entry.deposit?.id || Math.random()} className="badge">
                            {entry.deposit?.name || 'Depósito'} · {formatQuantity(entry.quantity, { compact: true })}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>{formatQuantity(total)}</td>
                  </tr>
                );
              })}
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                    No hay artículos que coincidan con los filtros seleccionados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="section-card">
        <h3>Stock consolidado por depósito</h3>
        <div className="table-wrapper" style={{ marginTop: '1rem' }}>
          <table>
            <thead>
              <tr>
                <th>Depósito</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {depositData.map(entry => (
                <tr key={entry.id || entry.name}>
                  <td>{entry.name || 'Depósito'}</td>
                  <td>{formatQuantity(entry.total)}</td>
                </tr>
              ))}
              {depositData.length === 0 && (
                <tr>
                  <td colSpan={2} style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                    No hay información consolidada de depósitos disponible.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
