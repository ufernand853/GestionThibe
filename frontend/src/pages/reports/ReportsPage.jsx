import { useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';
import { exportToCsv } from '../../utils/export.js';

export default function ReportsPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const canViewReports = permissions.includes('reports.read');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stockData, setStockData] = useState([]);
  const [groups, setGroups] = useState([]);
  const [filters, setFilters] = useState({ groupId: '', search: '' });

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [stockResponse, groupsResponse] = await Promise.all([
          api.get('/reports/stock'),
          api.get('/groups').catch(() => [])
        ]);
        if (!active) return;
        setStockData(Array.isArray(stockResponse) ? stockResponse : []);
        setGroups(Array.isArray(groupsResponse) ? groupsResponse : []);
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

  const filteredData = useMemo(() => {
    return stockData.filter(item => {
      const matchesGroup = !filters.groupId || item.groupId === filters.groupId;
      const matchesSearch =
        !filters.search ||
        item.code.toLowerCase().includes(filters.search.toLowerCase()) ||
        item.description.toLowerCase().includes(filters.search.toLowerCase());
      return matchesGroup && matchesSearch;
    });
  }, [filters.groupId, filters.search, stockData]);

  const totals = useMemo(() => {
    return filteredData.reduce(
      (accumulator, item) => {
        const stock = item.stock || {};
        accumulator.general += Number(stock.general || 0);
        accumulator.overstockGeneral += Number(stock.overstockGeneral || 0);
        accumulator.overstockThibe += Number(stock.overstockThibe || 0);
        accumulator.overstockArenal += Number(stock.overstockArenal || 0);
        return accumulator;
      },
      { general: 0, overstockGeneral: 0, overstockThibe: 0, overstockArenal: 0 }
    );
  }, [filteredData]);

  const handleExport = () => {
    const rows = filteredData.map(item => ({
      codigo: item.code,
      descripcion: item.description,
      grupo: item.group?.name || 'Sin grupo',
      stock_general: item.stock?.general || 0,
      sobrestock_general: item.stock?.overstockGeneral || 0,
      sobrestock_thibe: item.stock?.overstockThibe || 0,
      sobrestock_arenal: item.stock?.overstockArenal || 0
    }));
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
        Analice el inventario consolidado por grupo y exporte la información para uso externo.
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
            <select
              id="group"
              value={filters.groupId}
              onChange={event => setFilters(prev => ({ ...prev, groupId: event.target.value }))}
            >
              <option value="">Todos</option>
              {groups.map(group => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button type="button" onClick={handleExport} disabled={filteredData.length === 0}>
              Exportar CSV
            </button>
          </div>
        </div>
      </div>

      <div className="section-card">
        <h3>Resumen</h3>
        <div className="metrics-grid">
          <div className="metric-card">
            <h3>Stock general</h3>
            <p>{totals.general.toLocaleString('es-AR')}</p>
          </div>
          <div className="metric-card">
            <h3>Sobrestock general</h3>
            <p>{totals.overstockGeneral.toLocaleString('es-AR')}</p>
          </div>
          <div className="metric-card">
            <h3>Sobrestock Thibe</h3>
            <p>{totals.overstockThibe.toLocaleString('es-AR')}</p>
          </div>
          <div className="metric-card">
            <h3>Sobrestock Arenal</h3>
            <p>{totals.overstockArenal.toLocaleString('es-AR')}</p>
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
                <th>Stock General</th>
                <th>Sobrestock General</th>
                <th>Sobrestock Thibe</th>
                <th>Sobrestock Arenal</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.map(item => (
                <tr key={item.id}>
                  <td>{item.code}</td>
                  <td>{item.description}</td>
                  <td>{item.group?.name || 'Sin grupo'}</td>
                  <td>{item.stock?.general || 0}</td>
                  <td>{item.stock?.overstockGeneral || 0}</td>
                  <td>{item.stock?.overstockThibe || 0}</td>
                  <td>{item.stock?.overstockArenal || 0}</td>
                </tr>
              ))}
              {filteredData.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                    No hay datos para los filtros seleccionados.
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
