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
        accumulator.general = sumQuantities(accumulator.general, stock.general);
        accumulator.overstockGeneral = sumQuantities(accumulator.overstockGeneral, stock.overstockGeneral);
        accumulator.overstockThibe = sumQuantities(accumulator.overstockThibe, stock.overstockThibe);
        accumulator.overstockArenal = sumQuantities(accumulator.overstockArenal, stock.overstockArenal);
        return accumulator;
      },
      {
        general: { boxes: 0, units: 0 },
        overstockGeneral: { boxes: 0, units: 0 },
        overstockThibe: { boxes: 0, units: 0 },
        overstockArenal: { boxes: 0, units: 0 }
      }
    );
  }, [filteredData]);

  const handleExport = () => {
    const rows = filteredData.map(item => {
      const general = ensureQuantity(item.stock?.general);
      const overstockGeneral = ensureQuantity(item.stock?.overstockGeneral);
      const overstockThibe = ensureQuantity(item.stock?.overstockThibe);
      const overstockArenal = ensureQuantity(item.stock?.overstockArenal);
      return {
        codigo: item.code,
        descripcion: item.description,
        grupo: item.group?.name || 'Sin grupo',
        stock_general_cajas: general.boxes,
        stock_general_unidades: general.units,
        sobrestock_general_cajas: overstockGeneral.boxes,
        sobrestock_general_unidades: overstockGeneral.units,
        sobrestock_thibe_cajas: overstockThibe.boxes,
        sobrestock_thibe_unidades: overstockThibe.units,
        sobrestock_arenal_cajas: overstockArenal.boxes,
        sobrestock_arenal_unidades: overstockArenal.units
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
            <p>{formatQuantity(totals.general)}</p>
          </div>
          <div className="metric-card">
            <h3>Sobrestock general</h3>
            <p>{formatQuantity(totals.overstockGeneral)}</p>
          </div>
          <div className="metric-card">
            <h3>Sobrestock Thibe</h3>
            <p>{formatQuantity(totals.overstockThibe)}</p>
          </div>
          <div className="metric-card">
            <h3>Sobrestock Arenal</h3>
            <p>{formatQuantity(totals.overstockArenal)}</p>
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
                  <td>{formatQuantity(item.stock?.general)}</td>
                  <td>{formatQuantity(item.stock?.overstockGeneral)}</td>
                  <td>{formatQuantity(item.stock?.overstockThibe)}</td>
                  <td>{formatQuantity(item.stock?.overstockArenal)}</td>
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
