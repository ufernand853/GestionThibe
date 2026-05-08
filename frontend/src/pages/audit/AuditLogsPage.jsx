import { useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';

const AUDIT_ACTIONS = ['Solicitud de movimiento', 'Artículo', 'Autenticación'];
const ACTION_LABELS = {
  'Solicitud de movimiento': 'Solicitud de movimiento',
  Artículo: 'Artículo',
  Autenticación: 'Autenticación'
};

const DETAIL_LABELS = {
  item: 'Artículo',
  movementRequest: 'Solicitud de movimiento',
  changes: 'Cambios',
  id: 'ID',
  code: 'Código',
  sku: 'SKU',
  description: 'Descripción',
  groupId: 'ID grupo',
  groupName: 'Grupo',
  attributes: 'Atributos',
  stock: 'Stock',
  unitsPerBox: 'Unidades por caja',
  precio: 'Precio',
  needsRecount: 'Requiere recuento',
  imageCount: 'Cantidad de imágenes',
  itemId: 'ID artículo',
  type: 'Tipo',
  fromLocationId: 'ID origen',
  fromLocation: 'Origen',
  toLocationId: 'ID destino',
  toLocation: 'Destino',
  quantity: 'Cantidad',
  reason: 'Motivo',
  requestedBy: 'Solicitado por',
  requestedAt: 'Fecha de solicitud',
  status: 'Estado',
  approvedBy: 'Aprobado por',
  approvedAt: 'Fecha de aprobación',
  executedAt: 'Fecha de ejecución',
  rejectedReason: 'Motivo de rechazo',
  rejectionReason: 'Motivo de rechazo',
  before: 'Antes',
  after: 'Después',
  boxes: 'Cajas',
  units: 'Unidades',
  name: 'Nombre',
  email: 'Email',
  role: 'Rol',
  summary: 'Resumen',
  ubicacion: 'Ubicación',
  cantidad: 'Cantidad'
};

const MOVEMENT_TYPE_LABELS = {
  ingress: 'Ingreso',
  egress: 'Egreso',
  transfer: 'Transferencia'
};

const STATUS_LABELS = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  executed: 'Ejecutada'
};

const labelFor = key => DETAIL_LABELS[key] || key;

const HIDDEN_DETAIL_KEYS = new Set([
  'summary',
  'id',
  'itemId',
  'fromLocationId',
  'toLocationId',
  'groupId',
  'roleId',
  'sku',
  'boxes',
  'units'
]);

const isPlainObject = value => value && typeof value === 'object' && !Array.isArray(value);

const hasDetails = details => isPlainObject(details) && Object.keys(details).length > 0;

const sanitizeAuditText = value => {
  if (typeof value !== 'string') {
    return value || '';
  }
  return value.replace(/\b[0-9a-f]{24}\s*:\s*/gi, 'Ubicación: ');
};

const isQuantity = value =>
  isPlainObject(value) &&
  Object.prototype.hasOwnProperty.call(value, 'boxes') &&
  Object.prototype.hasOwnProperty.call(value, 'units') &&
  Object.keys(value).every(key => ['boxes', 'units'].includes(key));

const formatPrimitive = (key, value) => {
  if (value === null || value === undefined || value === '') {
    return '-';
  }
  if (typeof value === 'boolean') {
    return value ? 'Sí' : 'No';
  }
  if (key === 'type' && MOVEMENT_TYPE_LABELS[value]) {
    return MOVEMENT_TYPE_LABELS[value];
  }
  if (key === 'status' && STATUS_LABELS[value]) {
    return STATUS_LABELS[value];
  }
  if (typeof value === 'string' && /At$/.test(key)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString('es-AR');
    }
  }
  return String(value);
};

function renderAuditDetailValue(value, keyPrefix) {
  if (isQuantity(value)) {
    return `${Number(value.boxes) || 0} caja(s), ${Number(value.units) || 0} unidad(es)`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '-';
    }
    return (
      <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.1rem' }}>
        {value.map((entry, index) => {
          const friendlyStockEntry = isPlainObject(entry) && entry.ubicacion && entry.cantidad
            ? `${entry.ubicacion}: ${entry.cantidad}`
            : null;
          return (
            <li key={`${keyPrefix}-${index}`}>
              {friendlyStockEntry || renderAuditDetailValue(entry, `${keyPrefix}-${index}`)}
            </li>
          );
        })}
      </ul>
    );
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(
      ([entryKey, entryValue]) => entryValue !== undefined && !HIDDEN_DETAIL_KEYS.has(entryKey)
    );
    if (entries.length === 0) {
      return '-';
    }
    return (
      <dl style={{ margin: '0.25rem 0 0', display: 'grid', gap: '0.35rem' }}>
        {entries.map(([entryKey, entryValue]) => (
          <div key={`${keyPrefix}-${entryKey}`} style={{ display: 'grid', gap: '0.1rem' }}>
            <dt style={{ color: '#475569', fontWeight: 700 }}>{labelFor(entryKey)}</dt>
            <dd style={{ margin: 0 }}>{renderAuditDetailValue(entryValue, `${keyPrefix}-${entryKey}`)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  return formatPrimitive(keyPrefix.split('-').pop(), value);
}

function AuditDetails({ details, fallback }) {
  if (!hasDetails(details)) {
    const sanitizedFallback = sanitizeAuditText(fallback);
    const fallbackText = typeof sanitizedFallback === 'string' && /[:|]/.test(sanitizedFallback) ? sanitizedFallback : '';
    return (
      <span style={{ color: fallbackText ? '#334155' : '#94a3b8' }}>
        {fallbackText || 'Detalle estructurado no disponible'}
      </span>
    );
  }
  return (
    <details>
      <summary style={{ cursor: 'pointer', color: '#2563eb', fontWeight: 700 }}>Ver detalle</summary>
      <div style={{ marginTop: '0.5rem', maxWidth: '42rem' }}>{renderAuditDetailValue(details, 'details')}</div>
    </details>
  );
}

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
    request: '',
    item: '',
    user: '',
    limit: 100,
    action: '',
    ...getDefaultDateRange()
  }));
  const actionOptions = useMemo(() => {
    const unique = new Set(AUDIT_ACTIONS);
    logs.forEach(log => {
      if (log && log.action) {
        unique.add(log.action);
      }
    });
    return Array.from(unique).sort((a, b) => a.localeCompare(b, 'es'));
  }, [logs]);

  useEffect(() => {
    let active = true;
    const loadLogs = async () => {
      setLoading(true);
      setError(null);
      try {
        const query = {
          limit: filters.limit
        };
        if (filters.action) {
          query.action = filters.action;
        }
        if (filters.request) {
          query.request = filters.request;
        }
        if (filters.item) {
          query.item = filters.item;
        }
        if (filters.user) {
          query.user = filters.user;
        }
        if (filters.from) {
          query.from = filters.from;
        }
        if (filters.to) {
          query.to = filters.to;
        }
        const response = await api.get('/logs/audit', { query });
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
  }, [api, canViewLogs, filters.action, filters.from, filters.item, filters.limit, filters.request, filters.to, filters.user]);

  if (!canViewLogs) {
    return <ErrorMessage error="No tiene permisos para acceder a la auditoría." />;
  }

  return (
    <div>
      <h2>Auditoría de operaciones</h2>
      <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
        Consulte el historial de acciones registradas sobre solicitudes de movimiento y operaciones críticas.
      </p>

      {error && <ErrorMessage error={error} />}

      <div className="section-card">
        <form className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div className="input-group">
            <label htmlFor="actionFilter">Acción</label>
            <select
              id="actionFilter"
              value={filters.action}
              onChange={event => setFilters(prev => ({ ...prev, action: event.target.value }))}
            >
              <option value="">Todas</option>
              {actionOptions.map(action => (
                <option key={action} value={action}>
                  {getActionLabel(action)}
                </option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="requestFilter">Operación</label>
            <input
              id="requestFilter"
              value={filters.request}
              onChange={event => setFilters(prev => ({ ...prev, request: event.target.value }))}
              placeholder="Ej.: Alta, baja, aprobación"
            />
          </div>
          <div className="input-group">
            <label htmlFor="itemFilter">Artículo</label>
            <input
              id="itemFilter"
              value={filters.item}
              onChange={event => setFilters(prev => ({ ...prev, item: event.target.value }))}
              placeholder="Código o descripción del artículo"
            />
          </div>
          <div className="input-group">
            <label htmlFor="userFilter">Usuario</label>
            <input
              id="userFilter"
              value={filters.user}
              onChange={event => setFilters(prev => ({ ...prev, user: event.target.value }))}
              placeholder="Nombre de usuario"
            />
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
                  <th>Detalle</th>
                  <th>Datos registrados</th>
                  <th>Usuario</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <tr key={log.id}>
                    <td>{new Date(log.timestamp).toLocaleString('es-AR')}</td>
                    <td>{getActionLabel(log.action)}</td>
                    <td>{sanitizeAuditText(log.request) || '-'}</td>
                    <td><AuditDetails details={log.details} fallback={log.request} /></td>
                    <td>{log.user || '-'}</td>
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
