import { useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';
import { formatQuantity } from '../../utils/quantity.js';
import { formatStockListLabel } from '../../utils/stockLists.js';

const TYPE_LABELS = {
  in: 'Entrada',
  out: 'Salida',
  transfer: 'Transferencia'
};

export default function ApprovalsPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const canApprove = permissions.includes('stock.approve');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [requests, setRequests] = useState([]);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    let active = true;
    const loadPending = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await api.get('/stock/requests', { query: { status: 'pending' } });
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
    if (canApprove) {
      loadPending();
    }
    return () => {
      active = false;
    };
  }, [api, canApprove]);

  const handleApprove = async requestId => {
    try {
      await api.post(`/stock/approve/${requestId}`);
      setRequests(prev => prev.filter(request => request.id !== requestId));
      setSuccessMessage('Solicitud aprobada y ejecutada.');
    } catch (err) {
      setError(err);
    }
  };

  const handleReject = async requestId => {
    const reason = window.prompt('Indique el motivo del rechazo (opcional)');
    if (reason === null) {
      return;
    }
    try {
      await api.post(`/stock/reject/${requestId}`, { reason });
      setRequests(prev => prev.filter(request => request.id !== requestId));
      setSuccessMessage('Solicitud rechazada correctamente.');
    } catch (err) {
      setError(err);
    }
  };

  if (!canApprove) {
    return <ErrorMessage error="No cuenta con permisos de aprobación." />;
  }

  return (
    <div>
      <h2>Bandeja de aprobación</h2>
      <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
        Evalúe y apruebe o rechace las solicitudes de movimiento críticas. Cada acción quedará registrada en la auditoría.
      </p>

      {error && <ErrorMessage error={error} />}
      {successMessage && <div className="success-message">{successMessage}</div>}

      <div className="section-card">
        <h3>Solicitudes pendientes</h3>
        {loading ? (
          <LoadingIndicator message="Buscando solicitudes pendientes..." />
        ) : requests.length === 0 ? (
          <p style={{ color: '#64748b' }}>No hay solicitudes pendientes de aprobación.</p>
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
                  <th>Solicitado por</th>
                  <th>Fecha</th>
                  <th>Acciones</th>
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
                    <td>{request.requestedBy?.username || 'N/D'}</td>
                    <td>{new Date(request.requestedAt).toLocaleString('es-AR')}</td>
                    <td>
                      <div className="inline-actions">
                        <button type="button" onClick={() => handleApprove(request.id)}>
                          Aprobar
                        </button>
                        <button type="button" className="secondary-button" onClick={() => handleReject(request.id)}>
                          Rechazar
                        </button>
                      </div>
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
