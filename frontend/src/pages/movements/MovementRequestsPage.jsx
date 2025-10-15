import { useCallback, useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';
import { formatQuantity } from '../../utils/quantity.js';

export default function MovementRequestsPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const canRequest = permissions.includes('stock.request');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);
  const [locations, setLocations] = useState([]);
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [resubmittingId, setResubmittingId] = useState(null);
  const [formValues, setFormValues] = useState({
    itemId: '',
    fromLocation: '',
    toLocation: '',
    quantityBoxes: '',
    quantityUnits: '',
    reason: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const refreshRequests = useCallback(async () => {
    const response = await api.get('/stock/requests', {
      query: statusFilter ? { status: statusFilter } : undefined
    });
    return Array.isArray(response) ? response : [];
  }, [api, statusFilter]);

  useEffect(() => {
    let active = true;
    const loadMetadata = async () => {
      try {
        const [itemsResponse, locationsResponse] = await Promise.all([
          api.get('/items', { query: { page: 1, pageSize: 100 } }),
          api.get('/locations')
        ]);
        if (!active) return;
        setItems(itemsResponse.items || []);
        setLocations(
          Array.isArray(locationsResponse)
            ? locationsResponse
                .filter(location => location.status !== 'inactive')
                .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
            : []
        );
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
        const data = await refreshRequests();
        if (!active) return;
        setRequests(data);
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
  }, [canRequest, refreshRequests]);

  const handleFormChange = event => {
    const { name, value } = event.target;
    setFormValues(prev => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async event => {
    event.preventDefault();
    if (!canRequest) return;
    setSubmitting(true);
    setError(null);
    setSuccessMessage('');
    try {
      const boxes = formValues.quantityBoxes === '' ? 0 : Number(formValues.quantityBoxes);
      const units = formValues.quantityUnits === '' ? 0 : Number(formValues.quantityUnits);

      if ((!Number.isFinite(boxes) || boxes < 0) || (!Number.isFinite(units) || units < 0)) {
        setError('Las cantidades de cajas y unidades deben ser números válidos mayores o iguales a 0.');
        setSubmitting(false);
        return;
      }

      if (boxes === 0 && units === 0) {
        setError('Debe indicar al menos una cantidad en cajas o unidades.');
        setSubmitting(false);
        return;
      }

      if (!formValues.fromLocation || !formValues.toLocation) {
        setError('Debe seleccionar ubicaciones de origen y destino.');
        setSubmitting(false);
        return;
      }

      if (formValues.fromLocation === formValues.toLocation) {
        setError('La ubicación de origen y destino no pueden ser la misma.');
        setSubmitting(false);
        return;
      }

      const payload = {
        itemId: formValues.itemId,
        fromLocation: formValues.fromLocation,
        toLocation: formValues.toLocation,
        quantity: {
          boxes,
          units
        },
        reason: formValues.reason
      };

      await api.post('/stock/request', payload);
      setSuccessMessage('Solicitud registrada correctamente.');
      setFormValues(prev => ({
        ...prev,
        reason: '',
        quantityBoxes: '',
        quantityUnits: ''
      }));
      const refreshed = await refreshRequests();
      setRequests(refreshed);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResubmit = async request => {
    if (!canRequest) return;
    setResubmittingId(request.id);
    setError(null);
    setSuccessMessage('');
    try {
      await api.post(`/stock/request/${request.id}/resubmit`);
      setSuccessMessage('Solicitud reenviada correctamente.');
      const refreshed = await refreshRequests();
      setRequests(refreshed);
    } catch (err) {
      setError(err);
    } finally {
      setResubmittingId(null);
    }
  };

  if (!canRequest) {
    return <ErrorMessage error="No cuenta con permisos para solicitar movimientos." />;
  }

  return (
    <div>
      <h2>Solicitudes de transferencia</h2>
      <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
        Genere solicitudes de transferencia de stock entre depósitos. Las solicitudes serán ejecutadas luego de la aprobación.
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
            <label htmlFor="fromLocation">Ubicación origen *</label>
            <select
              id="fromLocation"
              name="fromLocation"
              value={formValues.fromLocation}
              onChange={handleFormChange}
              required
            >
              <option value="">Seleccione origen</option>
              {locations
                .filter(location => location.type === 'warehouse')
                .map(location => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="toLocation">Ubicación destino *</label>
            <select
              id="toLocation"
              name="toLocation"
              value={formValues.toLocation}
              onChange={handleFormChange}
              required
            >
              <option value="">Seleccione destino</option>
              {locations.map(location => (
                <option key={location.id} value={location.id}>
                  {location.name}
                  {location.type === 'external' ? ' · Externo' : ''}
                </option>
              ))}
            </select>
          </div>
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
            <label htmlFor="quantityUnits">Unidades</label>
            <input
              id="quantityUnits"
              name="quantityUnits"
              type="number"
              min="0"
              value={formValues.quantityUnits}
              onChange={handleFormChange}
            />
          </div>
          <div className="input-group" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="reason">Motivo</label>
            <textarea id="reason" name="reason" value={formValues.reason} onChange={handleFormChange} rows={2} />
          </div>
          <div>
            <button type="submit" disabled={submitting}>
              {submitting ? 'Enviando...' : 'Registrar solicitud'}
            </button>
          </div>
        </form>
      </div>

      <div className="section-card">
        <div className="flex-between" style={{ alignItems: 'center' }}>
          <h3>Solicitudes registradas</h3>
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
            <option value="">Todas</option>
            <option value="pending">Pendientes</option>
            <option value="approved">Aprobadas</option>
            <option value="executed">Ejecutadas</option>
            <option value="rejected">Rechazadas</option>
          </select>
        </div>
        {loading ? (
          <LoadingIndicator message="Buscando solicitudes..." />
        ) : requests.length === 0 ? (
          <p style={{ color: '#64748b' }}>No hay solicitudes registradas con el filtro seleccionado.</p>
        ) : (
          <div className="table-wrapper" style={{ marginTop: '1rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Artículo</th>
                  <th>Origen</th>
                  <th>Destino</th>
                  <th>Cantidad</th>
                  <th>Estado</th>
                  <th>Solicitado por</th>
                  <th>Fecha</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(request => (
                  <tr key={request.id}>
                    <td>{request.item?.code || request.itemId}</td>
                    <td>{request.fromLocation?.name || '-'}</td>
                    <td>{request.toLocation?.name || '-'}</td>
                    <td>{formatQuantity(request.quantity)}</td>
                    <td>
                      <span className={`badge ${request.status}`}>{request.status}</span>
                    </td>
                    <td>{request.requestedBy?.username || 'N/D'}</td>
                    <td>{new Date(request.requestedAt).toLocaleString('es-AR')}</td>
                    <td>
                      {request.status === 'rejected' && (
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => handleResubmit(request)}
                          disabled={resubmittingId === request.id}
                        >
                          {resubmittingId === request.id ? 'Reenviando...' : 'Reenviar'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
