import { useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';
import { formatQuantity } from '../../utils/quantity.js';
import StockStatusBadge from '../../components/StockStatusBadge.jsx';
import { aggregatePendingByItem, computeTotalStockFromMap, deriveStockStatus } from '../../utils/stockStatus.js';
import { MOVEMENT_TYPE_BADGE_CLASS, MOVEMENT_TYPE_LABELS, resolveMovementType } from '../../utils/movements.js';

export default function ApprovalsPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const canApprove = permissions.includes('stock.approve');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [requests, setRequests] = useState([]);
  const [itemsSnapshot, setItemsSnapshot] = useState([]);
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

  useEffect(() => {
    let active = true;
    const loadItems = async () => {
      try {
        const response = await api.get('/items', { query: { page: 1, pageSize: 500 } });
        if (!active) return;
        setItemsSnapshot(response.items || []);
      } catch (err) {
        if (!active) return;
        console.warn('No se pudieron cargar artículos para indicadores', err);
        setItemsSnapshot([]);
      }
    };
    if (canApprove) {
      loadItems();
    } else {
      setItemsSnapshot([]);
    }
    return () => {
      active = false;
    };
  }, [api, canApprove]);

  const pendingMap = useMemo(() => aggregatePendingByItem(requests), [requests]);

  const itemTotals = useMemo(() => {
    const map = new Map();
    (Array.isArray(itemsSnapshot) ? itemsSnapshot : []).forEach(item => {
      map.set(item.id, computeTotalStockFromMap(item.stock));
    });
    return map;
  }, [itemsSnapshot]);

  const itemStatusMap = useMemo(() => {
    const map = new Map();
    itemTotals.forEach((total, itemId) => {
      const pendingInfo = pendingMap.get(itemId);
      map.set(itemId, deriveStockStatus(total, pendingInfo));
    });
    return map;
  }, [itemTotals, pendingMap]);

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
        Evalúe y apruebe o rechace las solicitudes de transferencia registradas por los operadores.
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
                  <th>Origen</th>
                  <th>Destino</th>
                  <th>Cantidad</th>
                  <th>Disponibilidad</th>
                  <th>Solicitado por</th>
                  <th>Fecha</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(request => {
                  const itemId = request.item?.id || request.itemId;
                  const stockStatus = itemStatusMap.get(itemId);
                  const movementType = resolveMovementType({
                    explicitType: request.type,
                    fromType: request.fromLocation?.type,
                    toType: request.toLocation?.type
                  });
                  const movementBadgeClass =
                    MOVEMENT_TYPE_BADGE_CLASS[movementType] || MOVEMENT_TYPE_BADGE_CLASS.transfer;
                  const movementLabel = MOVEMENT_TYPE_LABELS[movementType] || MOVEMENT_TYPE_LABELS.transfer;
                  return (
                    <tr key={request.id}>
                      <td>{request.item?.code || request.itemId}</td>
                      <td>{request.fromLocation?.name || '-'}</td>
                      <td>{request.toLocation?.name || '-'}</td>
                      <td>
                        <div className="quantity-with-flag">
                          <span>{formatQuantity(request.quantity)}</span>
                          <span className={`badge ${movementBadgeClass}`}>{movementLabel}</span>
                        </div>
                      </td>
                      <td>
                        {stockStatus ? (
                          <div className="stock-status-cell">
                            <StockStatusBadge status={stockStatus} />
                            {stockStatus.pendingCount > 0 && (
                              <span className="stock-status-note">
                                {stockStatus.pendingCount === 1
                                  ? '1 solicitud pendiente'
                                  : `${stockStatus.pendingCount} solicitudes pendientes`}
                              </span>
                            )}
                          </div>
                        ) : (
                          '-'
                        )}
                      </td>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
