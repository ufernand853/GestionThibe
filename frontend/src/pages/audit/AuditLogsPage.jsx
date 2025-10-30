import { useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';

const AUDIT_ACTIONS = ['requested', 'approved', 'executed', 'rejected', 'resubmitted'];
const ACTION_LABELS = {
  requested: 'Solicitada',
  approved: 'Aprobada',
  executed: 'Ejecutada',
  rejected: 'Rechazada',
  resubmitted: 'Reenviada'
};

const getDefaultDateRange = () => {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);
  const formatDate = date => date.toISOString().slice(0, 10);
  return { from: formatDate(from), to: formatDate(to) };
};

const getActionLabel = action => {
  if (!action) {
    return '-';
  }
  if (ACTION_LABELS[action]) {
    return ACTION_LABELS[action];
  }
  const normalized = action.replace(/[_-]+/g, ' ').toLowerCase();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

export default function AuditLogsPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const isOperator = user?.role === 'Operador';
  const canViewLogs = permissions.includes('stock.logs.read') && !isOperator;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [logs, setLogs] = useState([]);
  const [filters, setFilters] = useState(() => ({
    requestId: '',
    limit: 100,
    action: '',
    ...getDefaultDateRange()
  }));

  useEffect(() => {
    let active = true;
    const loadLogs = async () => {
      setLoading(true);
      setError(null);
      try {
        const query = {
          limit: filters.limit
        };
        if (filters.requestId) {
          query.requestId = filters.requestId;
        }
        if (filters.action) {
          query.action = filters.action;
        }
        if (filters.from) {
          query.from = filters.from;
        }
        if (filters.to) {
          query.to = filters.to;
        }
        const response = await api.get('/logs/movements', { query });
        if (!active) return;
        setLogs(Array.isArray(response) ? response : []);
      } catch (err) {
        if (!active) return;
        setError(err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    if (canViewLogs) {
      loadLogs();
    }
    return () => {
      active = false;
    };
  }, [api, canViewLogs, filters.action, filters.from, filters.limit, filters.requestId, filters.to]);

  if (!canViewLogs) {
    return <ErrorMessage error="No tiene permisos para acceder a la auditoría." />;
  }

  return (
    <div>
      <h2>Auditoría de movimientos</h2>
      <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
        Consulte el historial de acciones registradas sobre solicitudes de movimiento y operaciones críticas.
      </p>

      {error && <ErrorMessage error={error} />}

      <div className="section-card">
        <form className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div className="input-group">
            <label htmlFor="requestId">ID de solicitud</label>
            <input
              id="requestId"
              value={filters.requestId}
              onChange={event => setFilters(prev => ({ ...prev, requestId: event.target.value }))}
              placeholder="UUID de la solicitud"
            />
          </div>
          <div className="input-group">
            <label htmlFor="limit">Límite</label>
            <input
              id="limit"
              type="number"
              min="10"
              max="500"
              value={filters.limit}
              onChange={event => setFilters(prev => ({ ...prev, limit: Number(event.target.value) }))}
            />
          </div>
          <div className="input-group">
            <label htmlFor="actionFilter">Acción</label>
            <select
              id="actionFilter"
              value={filters.action}
              onChange={event => setFilters(prev => ({ ...prev, action: event.target.value }))}
            >
              <option value="">Todas</option>
              {AUDIT_ACTIONS.map(action => (
                <option key={action} value={action}>
                  {getActionLabel(action)}
                </option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="fromDate">Desde</label>
            <input
              id="fromDate"
              type="date"
              value={filters.from}
              onChange={event => setFilters(prev => ({ ...prev, from: event.target.value }))}
            />
          </div>
          <div className="input-group">
            <label htmlFor="toDate">Hasta</label>
            <input
              id="toDate"
              type="date"
              value={filters.to}
              onChange={event => setFilters(prev => ({ ...prev, to: event.target.value }))}
            />
          </div>
        </form>
      </div>

      <div className="section-card">
        {loading ? (
          <LoadingIndicator message="Obteniendo registros de auditoría..." />
        ) : (
          <div className="table-wrapper" style={{ marginTop: '1rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Acción</th>
                  <th>Solicitud</th>
                  <th>Usuario</th>
                  <th>User Agent</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id}>
                    <td>{new Date(log.timestamp).toLocaleString('es-AR')}</td>
                    <td>{getActionLabel(log.action)}</td>
                    <td>{log.movementRequestId || '-'}</td>
                    <td>{log.actor?.username || log.actor?.email || '-'}</td>
                    <td>{log.metadata?.userAgent || '-'}</td>
                  </tr>
                ))}
                {logs.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                      No se encontraron registros.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
