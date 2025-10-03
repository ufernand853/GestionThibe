import { useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';
import { formatQuantity } from '../../utils/quantity.js';
import { STOCK_LIST_OPTIONS, formatStockListLabel } from '../../utils/stockLists.js';

const TYPE_LABELS = {
  in: 'Entrada',
  out: 'Salida',
  transfer: 'Transferencia'
};

export default function MovementRequestsPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const canRequest = permissions.includes('stock.request');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [formValues, setFormValues] = useState({
    itemId: '',
    type: 'out',
    fromList: 'general',
    toList: 'customer',
    quantityBoxes: '',
    quantityUnits: '1',
    reason: '',
    customerId: '',
    boxLabel: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    let active = true;
    const loadMetadata = async () => {
      try {
        const [itemsResponse, customersResponse] = await Promise.all([
          api.get('/items', { query: { page: 1, pageSize: 100 } }),
          api.get('/customers')
        ]);
        if (!active) return;
        setItems(itemsResponse.items || []);
        setCustomers(Array.isArray(customersResponse) ? customersResponse : []);
      } catch (err) {
        console.warn('No se pudieron cargar recursos de apoyo', err);
      }
    };
    if (canRequest) {
      loadMetadata();
    }
    return () => {
      active = false;
    };
  }, [api, canRequest]);

  useEffect(() => {
    let active = true;
    const loadRequests = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await api.get('/stock/requests', {
          query: statusFilter ? { status: statusFilter } : undefined
        });
        if (!active) return;
        setRequests(Array.isArray(response) ? response : []);
      } catch (err) {
        if (!active) return;
        setError(err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    if (canRequest) {
      loadRequests();
    }
    return () => {
      active = false;
    };
  }, [api, canRequest, statusFilter]);

  const handleFormChange = event => {
    const { name, value } = event.target;
    setFormValues(prev => ({ ...prev, [name]: value }));
  };

  const handleTypeChange = event => {
    const value = event.target.value;
    setFormValues(prev => ({
      ...prev,
      type: value,
      fromList: value === 'in' ? '' : prev.fromList || 'general',
      toList: value === 'out' ? '' : prev.toList || 'general'
    }));
  };

  const handleSubmit = async event => {
    event.preventDefault();
    if (!canRequest) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        itemId: formValues.itemId,
        type: formValues.type,
        quantity: {
          boxes: formValues.quantityBoxes === '' ? 0 : Number(formValues.quantityBoxes),
          units: formValues.quantityUnits === '' ? 0 : Number(formValues.quantityUnits)
        },
        reason: formValues.reason
      };
      if (formValues.fromList) payload.fromList = formValues.fromList;
      if (formValues.toList) payload.toList = formValues.toList;
      if (formValues.customerId) payload.customerId = formValues.customerId;
      const trimmedBox = formValues.boxLabel.trim();
      if (trimmedBox) payload.boxLabel = trimmedBox;
      await api.post('/stock/request', payload);
      setSuccessMessage('Solicitud registrada correctamente.');
      setFormValues(prev => ({
        ...prev,
        reason: '',
        quantityBoxes: '',
        quantityUnits: '1',
        boxLabel: ''
      }));
      const refreshed = await api.get('/stock/requests', {
        query: statusFilter ? { status: statusFilter } : undefined
      });
      setRequests(Array.isArray(refreshed) ? refreshed : []);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const requiresCustomer = formValues.fromList === 'customer' || formValues.toList === 'customer';

  useEffect(() => {
    if (!requiresCustomer && (formValues.customerId || formValues.boxLabel)) {
      setFormValues(prev => ({ ...prev, customerId: '', boxLabel: '' }));
    }
  }, [requiresCustomer, formValues.customerId, formValues.boxLabel]);

  if (!canRequest) {
    return <ErrorMessage error="No cuenta con permisos para solicitar movimientos." />;
  }

  return (
    <div>
      <h2>Solicitudes de movimiento</h2>
      <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
        Genere solicitudes de entrada, salida o transferencia de stock. Las salidas y movimientos críticos requerirán aprobación.
      </p>

      {error && <ErrorMessage error={error} />}
      {successMessage && <div className="success-message">{successMessage}</div>}

      <div className="section-card">
        <h3>Nueva solicitud</h3>
        <form className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }} onSubmit={handleSubmit}>
          <div className="input-group">
            <label htmlFor="itemId">Artículo *</label>
            <select id="itemId" name="itemId" value={formValues.itemId} onChange={handleFormChange} required>
              <option value="">Seleccione artículo</option>
              {items.map(item => (
                <option key={item.id} value={item.id}>
                  {item.code} · {item.description}
                </option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="type">Tipo *</label>
            <select id="type" name="type" value={formValues.type} onChange={handleTypeChange}>
              <option value="out">Salida</option>
              <option value="in">Entrada</option>
              <option value="transfer">Transferencia</option>
            </select>
          </div>
          {formValues.type !== 'in' && (
            <div className="input-group">
              <label htmlFor="fromList">Desde</label>
              <select id="fromList" name="fromList" value={formValues.fromList} onChange={handleFormChange} required={formValues.type !== 'in'}>
                <option value="">Seleccione lista origen</option>
                {STOCK_LIST_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {formValues.type !== 'out' && (
            <div className="input-group">
              <label htmlFor="toList">Hacia</label>
              <select id="toList" name="toList" value={formValues.toList} onChange={handleFormChange} required={formValues.type !== 'out'}>
                <option value="">Seleccione lista destino</option>
                {STOCK_LIST_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="input-group">
            <label htmlFor="quantityBoxes">Cajas</label>
            <input
              id="quantityBoxes"
              name="quantityBoxes"
              type="number"
              min="0"
              value={formValues.quantityBoxes}
              onChange={handleFormChange}
            />
          </div>
          <div className="input-group">
            <label htmlFor="quantityUnits">Unidades *</label>
            <input
              id="quantityUnits"
              name="quantityUnits"
              type="number"
              min="0"
              value={formValues.quantityUnits}
              onChange={handleFormChange}
              required
            />
          </div>
          {requiresCustomer && (
            <div className="input-group">
              <label htmlFor="customerId">Cliente</label>
              <select id="customerId" name="customerId" value={formValues.customerId} onChange={handleFormChange} required>
                <option value="">Seleccione cliente</option>
                {customers.map(customer => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {requiresCustomer && (
            <div className="input-group">
              <label htmlFor="boxLabel">Caja</label>
              <input
                id="boxLabel"
                name="boxLabel"
                value={formValues.boxLabel}
                onChange={handleFormChange}
                placeholder="Identificador de caja"
                maxLength={100}
              />
            </div>
          )}
          <div className="input-group" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="reason">Motivo</label>
            <textarea
              id="reason"
              name="reason"
              value={formValues.reason}
              onChange={handleFormChange}
              rows={2}
              placeholder="Ej: Reserva para cliente, entrega a tienda, devolución, etc."
            />
          </div>
          <div>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Enviando...' : 'Registrar solicitud'}
            </button>
          </div>
        </form>
      </div>

      <div className="section-card">
        <div className="flex-between">
          <h3>Historial de solicitudes</h3>
          <div className="input-group" style={{ maxWidth: '220px' }}>
            <label htmlFor="statusFilter">Estado</label>
            <select id="statusFilter" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
              <option value="">Todos</option>
              <option value="pending">Pendientes</option>
              <option value="approved">Aprobadas</option>
              <option value="rejected">Rechazadas</option>
              <option value="executed">Ejecutadas</option>
            </select>
          </div>
        </div>

        {loading ? (
          <LoadingIndicator message="Cargando solicitudes..." />
        ) : (
          <div className="table-wrapper" style={{ marginTop: '1rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Artículo</th>
                  <th>Tipo</th>
                  <th>Origen</th>
                  <th>Destino</th>
                  <th>Cantidad</th>
                  <th>Cliente</th>
                  <th>Caja</th>
                  <th>Estado</th>
                  <th>Solicitado por</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(request => (
                  <tr key={request.id}>
                    <td>{request.item?.code || request.itemId}</td>
                    <td>{TYPE_LABELS[request.type] || request.type}</td>
                    <td>{request.fromListLabel || formatStockListLabel(request.fromList) || '-'}</td>
                    <td>{request.toListLabel || formatStockListLabel(request.toList) || '-'}</td>
                    <td>{formatQuantity(request.quantity)}</td>
                    <td>{request.customer?.name || '-'}</td>
                    <td>{request.boxLabel || '-'}</td>
                    <td>
                      <span className={`badge ${request.status}`}>{request.status}</span>
                    </td>
                    <td>{request.requestedBy?.username || 'N/D'}</td>
                    <td>{new Date(request.requestedAt).toLocaleString('es-AR')}</td>
                  </tr>
                ))}
                {requests.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                      No se registran solicitudes con los filtros aplicados.
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
