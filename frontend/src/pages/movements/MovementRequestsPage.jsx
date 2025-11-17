import { useCallback, useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';
import { ensureQuantity, formatQuantity } from '../../utils/quantity.js';
import StockStatusBadge from '../../components/StockStatusBadge.jsx';
import { aggregatePendingByItem, computeTotalStockFromMap, deriveStockStatus } from '../../utils/stockStatus.js';
import {
  MOVEMENT_TYPE_BADGE_CLASS,
  MOVEMENT_TYPE_LABELS,
  resolveMovementType,
  locationTypeSuffix
} from '../../utils/movements.js';

const ORIGIN_PRIORITY = [
  'Guadalupe',
  'Justicia',
  'Arnavia',
  'Flex',
  'Sobrestock Arenal Import',
  'Sobrestock Thibe',
  'Sobrestock General',
  'Sobrestock Thibe Kids'
];

const MOVEMENT_TYPE_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'transfer', label: 'Transferencias' },
  { value: 'ingress', label: 'Entradas' },
  { value: 'egress', label: 'Salidas' }
];

export default function MovementRequestsPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const isAdmin = user?.role === 'Administrador';
  const isOperator = user?.role === 'Operador';
  const hasRequestPermission = permissions.includes('stock.request');
  const canRequest = hasRequestPermission;
  const isOperatorWithRestrictions = isOperator && hasRequestPermission;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);
  const [allLocations, setAllLocations] = useState([]);
  const [locations, setLocations] = useState([]);
  const [requests, setRequests] = useState([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [itemFilter, setItemFilter] = useState('');
  const [dateFilters, setDateFilters] = useState({ from: '', to: '' });
  const [pendingSnapshot, setPendingSnapshot] = useState([]);
  const [resubmittingId, setResubmittingId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [itemSearchTerm, setItemSearchTerm] = useState('');
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
    const query = {};
    if (statusFilter) {
      query.status = statusFilter;
    }
    if (typeFilter) {
      query.type = typeFilter;
    }
    if (dateFilters.from) {
      query.from = dateFilters.from;
    }
    if (dateFilters.to) {
      query.to = dateFilters.to;
    }
    if (itemFilter) {
      query.itemId = itemFilter;
    }
    const response = await api.get('/stock/requests', {
      query: Object.keys(query).length > 0 ? query : undefined
    });
    return Array.isArray(response) ? response : [];
  }, [api, dateFilters.from, dateFilters.to, itemFilter, statusFilter, typeFilter]);

  const refreshPendingSnapshot = useCallback(async () => {
    if (!canRequest) {
      setPendingSnapshot([]);
      return [];
    }
    try {
      const response = await api.get('/stock/requests', { query: { status: 'pending' } });
      const normalized = Array.isArray(response) ? response : [];
      setPendingSnapshot(normalized);
      return normalized;
    } catch (err) {
      console.warn('No se pudieron cargar solicitudes pendientes', err);
      setPendingSnapshot([]);
      return [];
    }
  }, [api, canRequest]);

  useEffect(() => {
    let active = true;
    const loadMetadata = async () => {
      try {
        const [itemsResponse, locationsResponse] = await Promise.all([
          api.get('/stock/items', { query: { limit: 2000 } }),
          api.get('/stock/locations')
        ]);
        if (!active) return;
        const normalizedItems = Array.isArray(itemsResponse?.items)
          ? itemsResponse.items
          : Array.isArray(itemsResponse)
          ? itemsResponse
          : [];
        setItems(normalizedItems);
        const normalizedLocations = Array.isArray(locationsResponse) ? locationsResponse : [];
        setAllLocations(normalizedLocations);
        setLocations(
          normalizedLocations
            .filter(location => location.status !== 'inactive')
            .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
        );
      } catch (err) {
        console.warn('No se pudieron cargar recursos de apoyo', err);
        if (!active) return;
        setItems([]);
        setAllLocations([]);
        setLocations([]);
      }
    };
    if (canRequest) {
      loadMetadata();
    } else {
      setItems([]);
      setAllLocations([]);
      setLocations([]);
    }
    return () => {
      active = false;
    };
  }, [api, canRequest]);

  useEffect(() => {
    if (!itemFilter) {
      return;
    }
    if (!Array.isArray(items) || !items.some(item => item.id === itemFilter)) {
      setItemFilter('');
    }
  }, [itemFilter, items]);

  const originOptions = useMemo(() => {
    const priorityMap = new Map(
      ORIGIN_PRIORITY.map((name, index) => [name.toLowerCase(), index])
    );
    const availableLocations = Array.isArray(locations) ? locations : [];
    const filteredLocations = isOperatorWithRestrictions
      ? availableLocations.filter(location => location.type === 'warehouse')
      : availableLocations;
    return filteredLocations
      .filter(location => location.type === 'warehouse')
      .slice()
      .sort((a, b) => {
        const aName = (a.name || '').toLowerCase();
        const bName = (b.name || '').toLowerCase();
        const aPriority = priorityMap.has(aName) ? priorityMap.get(aName) : Number.MAX_SAFE_INTEGER;
        const bPriority = priorityMap.has(bName) ? priorityMap.get(bName) : Number.MAX_SAFE_INTEGER;
        if (aPriority !== bPriority) {
          return aPriority - bPriority;
        }
        return (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' });
      });
  }, [isOperatorWithRestrictions, locations]);

  const pendingMap = useMemo(() => aggregatePendingByItem(pendingSnapshot), [pendingSnapshot]);

  const locationMap = useMemo(() => {
    const map = new Map();
    (Array.isArray(allLocations) ? allLocations : []).forEach(location => {
      map.set(String(location.id), location);
    });
    return map;
  }, [allLocations]);

  const selectedItem = useMemo(
    () => (formValues.itemId ? items.find(item => item.id === formValues.itemId) : null),
    [formValues.itemId, items]
  );

  const sortedItems = useMemo(() => {
    if (!Array.isArray(items)) {
      return [];
    }
    return [...items].sort((a, b) => {
      const codeA = String(a.code || '');
      const codeB = String(b.code || '');
      return codeA.localeCompare(codeB, 'es', { sensitivity: 'base', numeric: true });
    });
  }, [items]);

  const filteredItems = useMemo(() => {
    const query = itemSearchTerm.trim().toLowerCase();
    let base = sortedItems;
    if (query) {
      base = sortedItems.filter(item => {
        const code = String(item.code || '').toLowerCase();
        const description = String(item.description || '').toLowerCase();
        return code.includes(query) || description.includes(query);
      });
    }
    if (formValues.itemId) {
      const selected = sortedItems.find(item => item.id === formValues.itemId);
      if (selected && !base.some(item => item.id === selected.id)) {
        return [selected, ...base];
      }
    }
    return base;
  }, [formValues.itemId, itemSearchTerm, sortedItems]);

  const currentMovementType = useMemo(() => {
    if (!formValues.fromLocation || !formValues.toLocation) {
      return null;
    }
    const fromLocation = locationMap.get(formValues.fromLocation);
    const toLocation = locationMap.get(formValues.toLocation);
    return resolveMovementType({
      explicitType: null,
      fromType: fromLocation?.type,
      toType: toLocation?.type
    });
  }, [formValues.fromLocation, formValues.toLocation, locationMap]);

  const selectedItemStock = useMemo(() => {
    if (!selectedItem || !selectedItem.stock) {
      return [];
    }
    return Object.entries(selectedItem.stock)
      .map(([locationId, quantity]) => {
        const normalized = ensureQuantity(quantity);
        if (normalized.boxes === 0 && normalized.units === 0) {
          return null;
        }
        const location = locationMap.get(locationId);
        return {
          locationId,
          locationName: location?.name || `Depósito ${locationId.slice(-4)}`,
          locationType: location?.type || null,
          quantity: normalized
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.locationName.localeCompare(b.locationName, 'es', { sensitivity: 'base' }));
  }, [locationMap, selectedItem]);

  const itemTotals = useMemo(() => {
    const map = new Map();
    (Array.isArray(items) ? items : []).forEach(item => {
      map.set(item.id, computeTotalStockFromMap(item.stock));
    });
    return map;
  }, [items]);

  const itemStatuses = useMemo(() => {
    const map = new Map();
    itemTotals.forEach((total, itemId) => {
      const pendingInfo = pendingMap.get(itemId);
      map.set(itemId, deriveStockStatus(total, pendingInfo));
    });
    return map;
  }, [itemTotals, pendingMap]);

  useEffect(() => {
    let active = true;
    const loadRequests = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await refreshRequests();
        if (!active) return;
        setRequests(data);
        if (canRequest) {
          if (statusFilter === 'pending') {
            setPendingSnapshot(data);
          } else {
            await refreshPendingSnapshot();
          }
        }
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
  }, [canRequest, refreshPendingSnapshot, refreshRequests, statusFilter]);

  const handleFormChange = event => {
    const { name, value } = event.target;
    setFormValues(prev => ({ ...prev, [name]: value }));
  };

  const handleDateFilterChange = event => {
    const { name, value } = event.target;
    setDateFilters(prev => ({ ...prev, [name]: value }));
  };

  const availableDestinations = useMemo(() => {
    if (!Array.isArray(locations)) {
      return [];
    }
    if (!isOperatorWithRestrictions) {
      return locations;
    }
    return locations.filter(location => ['warehouse', 'external'].includes(location.type));
  }, [isOperatorWithRestrictions, locations]);

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

      const fromLocation = locationMap.get(String(formValues.fromLocation));
      const toLocation = locationMap.get(String(formValues.toLocation));

      if (isOperatorWithRestrictions) {
        const isFromWarehouse = fromLocation?.type === 'warehouse';
        const isToAllowed = ['warehouse', 'external'].includes(toLocation?.type);
        if (!isFromWarehouse || !isToAllowed) {
          setError(
            'Como operador solo puede solicitar transferencias desde depósitos internos hacia depósitos internos o externos.'
          );
          setSubmitting(false);
          return;
        }
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
      if (statusFilter === 'pending') {
        setPendingSnapshot(refreshed);
      } else {
        await refreshPendingSnapshot();
      }
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
      if (statusFilter === 'pending') {
        setPendingSnapshot(refreshed);
      } else {
        await refreshPendingSnapshot();
      }
    } catch (err) {
      setError(err);
    } finally {
      setResubmittingId(null);
    }
  };

  const handleDelete = async request => {
    if (!isAdmin) return;
    const confirmed = window.confirm('¿Está seguro de que desea eliminar esta solicitud?');
    if (!confirmed) return;

    setDeletingId(request.id);
    setError(null);
    setSuccessMessage('');
    try {
      await api.delete(`/stock/request/${request.id}`);
      setRequests(prev => prev.filter(item => item.id !== request.id));
      setPendingSnapshot(prev => prev.filter(item => item.id !== request.id));
    } catch (err) {
      setError(err);
    } finally {
      setDeletingId(null);
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
            <input
              id="itemSearch"
              type="search"
              placeholder="Buscar por código o descripción"
              value={itemSearchTerm}
              onChange={event => setItemSearchTerm(event.target.value)}
              aria-label="Buscar artículo"
              style={{ marginBottom: '0.5rem' }}
            />
            <select id="itemId" name="itemId" value={formValues.itemId} onChange={handleFormChange} required>
              <option value="">Seleccione artículo</option>
              {filteredItems.map(item => (
                <option key={item.id} value={item.id}>
                  {item.code} · {item.description}
                </option>
              ))}
            </select>
            {itemSearchTerm.trim() && filteredItems.length === 0 && (
              <p style={{ color: '#64748b', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                No hay artículos que coincidan con la búsqueda.
              </p>
            )}
          </div>
          {formValues.itemId && (
            <div className="input-group" style={{ gridColumn: '1 / -1' }}>
              <label>Stock disponible por depósito</label>
              {selectedItemStock.length > 0 ? (
                <ul className="stock-summary-list">
                  {selectedItemStock.map(entry => (
                    <li key={entry.locationId} className="stock-summary-item">
                      <span className="stock-summary-location">
                        {entry.locationName}
                        {locationTypeSuffix(entry.locationType)}
                      </span>
                      <span className="stock-summary-quantity">{formatQuantity(entry.quantity)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="stock-summary-empty">No hay stock registrado para este artículo.</p>
              )}
            </div>
          )}
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
              {originOptions.map(location => (
                <option key={location.id} value={location.id}>
                  {location.name}
                  {locationTypeSuffix(location.type)}
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
              {availableDestinations.map(location => (
                <option key={location.id} value={location.id}>
                  {location.name}
                  {locationTypeSuffix(location.type)}
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
            <div className="quantity-with-flag">
              <input
                id="quantityUnits"
                name="quantityUnits"
                type="number"
                min="0"
                value={formValues.quantityUnits}
                onChange={handleFormChange}
              />
              {currentMovementType && (
                <span
                  className={`badge ${
                    MOVEMENT_TYPE_BADGE_CLASS[currentMovementType] || MOVEMENT_TYPE_BADGE_CLASS.transfer
                  }`}
                >
                  {MOVEMENT_TYPE_LABELS[currentMovementType]}
                </span>
              )}
            </div>
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
        <div className="flex-between" style={{ alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
          <h3>Solicitudes registradas</h3>
          <div className="inline-actions" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
            <div className="input-group" style={{ minWidth: '150px' }}>
              <label htmlFor="statusFilter">Estado</label>
              <select id="statusFilter" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
                <option value="">Todas</option>
                <option value="pending">Pendientes</option>
                <option value="approved">Aprobadas</option>
                <option value="executed">Ejecutadas</option>
                <option value="rejected">Rechazadas</option>
              </select>
            </div>
            <div className="input-group" style={{ minWidth: '180px' }}>
              <label htmlFor="typeFilter">Tipo de movimiento</label>
              <select id="typeFilter" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}>
                {MOVEMENT_TYPE_OPTIONS.map(option => (
                  <option key={option.value || 'all'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="input-group" style={{ minWidth: '220px' }}>
              <label htmlFor="itemFilter">Artículo</label>
              <select id="itemFilter" value={itemFilter} onChange={event => setItemFilter(event.target.value)}>
                <option value="">Todos</option>
                {sortedItems.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.code} · {item.description}
                  </option>
                ))}
              </select>
            </div>
            <div className="input-group" style={{ minWidth: '160px' }}>
              <label htmlFor="fromDate">Desde</label>
              <input
                id="fromDate"
                type="date"
                name="from"
                value={dateFilters.from}
                onChange={handleDateFilterChange}
              />
            </div>
            <div className="input-group" style={{ minWidth: '160px' }}>
              <label htmlFor="toDate">Hasta</label>
              <input
                id="toDate"
                type="date"
                name="to"
                value={dateFilters.to}
                onChange={handleDateFilterChange}
              />
            </div>
          </div>
        </div>
        <div className="origin-legend" style={{ marginTop: '0.75rem' }}>
          <strong>Orígenes preferidos:</strong>
          {ORIGIN_PRIORITY.map(name => (
            <span key={name} className="badge">
              {name}
            </span>
          ))}
        </div>
        {loading ? (
          <LoadingIndicator message="Buscando solicitudes..." />
        ) : requests.length === 0 ? (
          <p style={{ color: '#64748b' }}>No hay solicitudes registradas con el filtro seleccionado.</p>
        ) : (
          <div className="table-wrapper table-wrapper--compact" style={{ marginTop: '1rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Artículo</th>
                  <th>Origen</th>
                  <th>Destino</th>
                  <th>Cantidad</th>
                  <th>Disponibilidad</th>
                  <th>Estado</th>
                  <th>Solicitado por</th>
                  <th>Fecha</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(request => {
                  const itemId = request.item?.id || request.itemId;
                  const stockStatus = itemStatuses.get(itemId);
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
                        {isAdmin && (
                          <button
                            type="button"
                            className="danger-button"
                            style={{ marginLeft: '0.5rem' }}
                            onClick={() => handleDelete(request)}
                            disabled={deletingId === request.id}
                          >
                            {deletingId === request.id ? 'Eliminando...' : 'Eliminar'}
                          </button>
                        )}
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
