import { useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';
import { ensureQuantity, formatQuantity, sumQuantities } from '../../utils/quantity.js';

const INITIAL_FORM_STATE = { name: '', contactInfo: '', status: 'active' };

export default function CustomersPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const canWrite = permissions.includes('items.write');
  const canViewReserved = permissions.includes('reports.read');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [formValues, setFormValues] = useState({ ...INITIAL_FORM_STATE });
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [editingCustomerId, setEditingCustomerId] = useState(null);
  const [customerStock, setCustomerStock] = useState([]);
  const [loadingStock, setLoadingStock] = useState(false);
  const [deletingCustomerId, setDeletingCustomerId] = useState(null);

  const reservedSummary = useMemo(() => {
    const buckets = new Map();
    customerStock.forEach(record => {
      if (record.status !== 'reserved') {
        return;
      }
      const key = record.boxLabel || '__NO_BOX__';
      if (!buckets.has(key)) {
        buckets.set(key, {
          label: record.boxLabel ? record.boxLabel : 'Sin caja',
          boxLabel: record.boxLabel,
          totalQuantity: { boxes: 0, units: 0 },
          items: new Map()
        });
      }
      const bucket = buckets.get(key);
      const recordQuantity = ensureQuantity(record.quantity);
      bucket.totalQuantity = sumQuantities(bucket.totalQuantity, recordQuantity);
      const code = record.item?.code || record.itemId;
      if (!bucket.items.has(code)) {
        bucket.items.set(code, {
          code,
          description: record.item?.description || '',
          quantity: { boxes: 0, units: 0 }
        });
      }
      const itemEntry = bucket.items.get(code);
      itemEntry.quantity = sumQuantities(itemEntry.quantity, recordQuantity);
    });
    return Array.from(buckets.values())
      .map(bucket => ({
        boxLabel: bucket.boxLabel,
        label: bucket.label,
        totalQuantity: bucket.totalQuantity,
        items: Array.from(bucket.items.values())
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }, [customerStock]);


  const normalizeCustomer = customer => {
    const rawId = customer.id || customer._id;
    return {
      id:
        rawId && typeof rawId === 'object' && typeof rawId.toString === 'function'
          ? rawId.toString()
          : rawId || '',
      name: customer.name || '',
      contactInfo: customer.contactInfo || '',
      status: customer.status || 'active'
    };
  };

  const editingCustomer = useMemo(
    () => (editingCustomerId ? customers.find(customer => customer.id === editingCustomerId) || null : null),
    [customers, editingCustomerId]
  );

  useEffect(() => {
    let active = true;
    const loadCustomers = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await api.get('/customers');
        if (!active) return;
        const normalized = Array.isArray(response)
          ? response.map(normalizeCustomer).sort((a, b) => a.name.localeCompare(b.name))
          : [];
        setCustomers(normalized);
        if (normalized[0]) {
          setSelectedCustomerId(prev => prev || normalized[0].id);
        } else {
          setSelectedCustomerId(null);
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
    loadCustomers();
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    if (customers.length === 0) {
      setSelectedCustomerId(null);
      return;
    }
    if (!customers.some(customer => customer.id === selectedCustomerId)) {
      setSelectedCustomerId(customers[0].id);
    }
  }, [customers, selectedCustomerId]);

  useEffect(() => {
    let active = true;
    const loadReserved = async customerId => {
      if (!customerId || !canViewReserved) {
        setCustomerStock([]);
        return;
      }
      setLoadingStock(true);
      try {
        const response = await api.get(`/customers/${customerId}/stock`);
        if (!active) return;
        setCustomerStock(Array.isArray(response) ? response : []);
      } catch (err) {
        if (!active) return;
        console.warn('No se pudo obtener el stock reservado', err);
        setCustomerStock([]);
      } finally {
        if (active) {
          setLoadingStock(false);
        }
      }
    };
    loadReserved(selectedCustomerId);
    return () => {
      active = false;
    };
  }, [api, canViewReserved, selectedCustomerId]);

  const handleFormChange = event => {
    const { name, value } = event.target;
    setSuccessMessage('');
    setFormValues(prev => ({ ...prev, [name]: value }));
  };

  const handleEdit = customer => {
    setEditingCustomerId(customer.id);
    setSelectedCustomerId(customer.id);
    setSuccessMessage('');
    setError(null);
    setFormValues({
      name: customer.name,
      contactInfo: customer.contactInfo || '',
      status: customer.status || 'active'
    });
  };

  const handleCreateNew = () => {
    setEditingCustomerId(null);
    setSuccessMessage('');
    setError(null);
    setFormValues({ ...INITIAL_FORM_STATE });
  };

  const handleSubmit = async event => {
    event.preventDefault();
    if (!canWrite) return;
    const trimmedName = formValues.name.trim();
    if (!trimmedName) {
      setError(new Error('El nombre es obligatorio.'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = { ...formValues, name: trimmedName };
      if (editingCustomerId && customers.some(customer => customer.id === editingCustomerId)) {
        const updated = await api.put(`/customers/${editingCustomerId}`, payload);
        const normalized = normalizeCustomer(updated);
        setCustomers(prev =>
          prev
            .map(customer => (customer.id === normalized.id ? normalized : customer))
            .sort((a, b) => a.name.localeCompare(b.name))
        );
        setEditingCustomerId(normalized.id);
        setSelectedCustomerId(normalized.id);
        setFormValues({
          name: normalized.name,
          contactInfo: normalized.contactInfo,
          status: normalized.status
        });
        setSuccessMessage(`Cliente ${normalized.name} actualizado.`);
      } else {
        const created = await api.post('/customers', payload);
        const normalized = normalizeCustomer(created);
        setCustomers(prev =>
          [...prev, normalized].sort((a, b) => a.name.localeCompare(b.name))
        );
        setEditingCustomerId(normalized.id);
        setSelectedCustomerId(normalized.id);
        setFormValues({
          name: normalized.name,
          contactInfo: normalized.contactInfo,
          status: normalized.status
        });
        setSuccessMessage(`Cliente ${normalized.name} creado.`);
      }
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (event, customer) => {
    event.stopPropagation();
    if (!canWrite || !customer?.id) return;
    const confirmed = window.confirm(`¿Eliminar al cliente "${customer.name}"? Esta acción no se puede deshacer.`);
    if (!confirmed) {
      return;
    }
    setDeletingCustomerId(customer.id);
    setError(null);
    setSuccessMessage('');
    try {
      await api.delete(`/customers/${customer.id}`);
      setCustomers(prev => {
        const filtered = prev
          .filter(current => current.id !== customer.id)
          .sort((a, b) => a.name.localeCompare(b.name));
        const fallbackId = filtered[0]?.id || null;
        setSelectedCustomerId(previousSelected =>
          previousSelected === customer.id ? fallbackId : previousSelected
        );
        return filtered;
      });
      if (editingCustomerId === customer.id) {
        setEditingCustomerId(null);
        setFormValues({ ...INITIAL_FORM_STATE });
      }
      setSuccessMessage(`Cliente ${customer.name} eliminado.`);
    } catch (err) {
      setError(err);
    } finally {
      setDeletingCustomerId(null);
    }
  };

  const handleRowClick = customer => {
    setSelectedCustomerId(customer.id);
  };

  if (loading) {
    return <LoadingIndicator message="Cargando clientes..." />;
  }

  return (
    <div>
      <h2>Clientes y reservas</h2>
      <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
        Administre clientes y visualice el stock reservado asociado a cada uno.
      </p>

      {error && <ErrorMessage error={error} />}
      {successMessage && <div className="success-message">{successMessage}</div>}

      <div className="section-card">
        <div className="flex-between">
          <h3>Clientes registrados</h3>
          <div className="inline-actions" style={{ alignItems: 'center' }}>
            {canWrite && (
              <button type="button" className="secondary-button" onClick={handleCreateNew}>
                Nuevo
              </button>
            )}
            <span className="badge">{customers.length} clientes</span>
          </div>
        </div>
        <div className="table-wrapper" style={{ marginTop: '1rem' }}>
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Contacto</th>
                <th>Estado</th>
                {canWrite && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {customers.map(customer => (
                <tr
                  key={customer.id}
                  onClick={() => handleRowClick(customer)}
                  style={{
                    backgroundColor: selectedCustomerId === customer.id ? '#e2e8f0' : undefined,
                    cursor: 'pointer'
                  }}
                >
                  <td>{customer.name}</td>
                  <td>{customer.contactInfo || '-'}</td>
                  <td>
                    <span className={`badge ${customer.status === 'active' ? 'approved' : 'rejected'}`}>
                      {customer.status}
                    </span>
                  </td>
                  {canWrite && (
                    <td>
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={event => {
                            event.stopPropagation();
                            handleEdit(customer);
                          }}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="danger-button"
                          onClick={event => handleDelete(event, customer)}
                          disabled={deletingCustomerId === customer.id}
                        >
                          {deletingCustomerId === customer.id ? 'Eliminando...' : 'Eliminar'}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {customers.length === 0 && (
                <tr>
                  <td colSpan={canWrite ? 4 : 3} style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                    No hay clientes registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canWrite && (
        <div className="section-card">
          <div className="flex-between" style={{ alignItems: 'center', gap: '1rem' }}>
            <h3>{editingCustomer ? `Editar: ${editingCustomer.name}` : 'Nuevo cliente'}</h3>
            {editingCustomer && (
              <button
                type="button"
                className="danger-button"
                onClick={event => handleDelete(event, editingCustomer)}
                disabled={deletingCustomerId === editingCustomer.id}
              >
                {deletingCustomerId === editingCustomer.id ? 'Eliminando...' : 'Eliminar'}
              </button>
            )}
          </div>
          <form
            className="form-grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
            onSubmit={handleSubmit}
          >
            <div className="input-group">
              <label htmlFor="customerName">Nombre *</label>
              <input
                id="customerName"
                name="name"
                value={formValues.name}
                onChange={handleFormChange}
                required
              />
            </div>
            <div className="input-group">
              <label htmlFor="customerContact">Contacto</label>
              <input
                id="customerContact"
                name="contactInfo"
                value={formValues.contactInfo}
                onChange={handleFormChange}
              />
            </div>
            <div className="input-group">
              <label htmlFor="customerStatus">Estado</label>
              <select id="customerStatus" name="status" value={formValues.status} onChange={handleFormChange}>
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
              </select>
            </div>
            <div>
              <button type="submit" disabled={saving}>
                {saving ? 'Guardando...' : editingCustomer ? 'Actualizar cliente' : 'Crear cliente'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="section-card">
        <h3>Stock reservado</h3>
        {!canViewReserved ? (
          <p style={{ color: '#64748b' }}>No tiene permisos para consultar stock reservado.</p>
        ) : loadingStock ? (
          <LoadingIndicator message="Consultando stock del cliente..." />
        ) : customerStock.length === 0 ? (
          <p style={{ color: '#64748b' }}>No hay stock reservado para el cliente seleccionado.</p>
        ) : (
          <>
            <div className="table-wrapper" style={{ marginTop: '1rem' }}>
              <table>
                <thead>
                  <tr>
                    <th>Artículo</th>
                    <th>Código</th>
                    <th>Caja</th>
                    <th>Cantidad</th>
                    <th>Estado</th>
                    <th>Reservado</th>
                    <th>Entregado</th>
                  </tr>
                </thead>
                <tbody>
                  {customerStock.map(record => (
                    <tr key={record.id}>
                      <td>{record.item?.description || '-'}</td>
                      <td>{record.item?.code || record.itemId}</td>
                      <td>{record.boxLabel || '-'}</td>
                      <td>{formatQuantity(record.quantity)}</td>
                      <td>{record.status}</td>
                      <td>{new Date(record.dateCreated).toLocaleDateString('es-AR')}</td>
                      <td>{record.dateDelivered ? new Date(record.dateDelivered).toLocaleDateString('es-AR') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {reservedSummary.length > 0 && (
              <div style={{ marginTop: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.75rem' }}>Resumen por caja</h4>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Caja</th>
                        <th>Artículos</th>
                        <th>Total reservado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reservedSummary.map(group => (
                        <tr key={group.boxLabel || 'sin-caja'}>
                          <td>{group.label}</td>
                          <td>
                            <div className="chip-list">
                              {group.items.map(item => (
                                <span key={item.code} className="badge">
                                  {item.code}
                                  {item.description ? ` · ${item.description}` : ''} ({formatQuantity(item.quantity, { compact: true })})
                                </span>
                              ))}
                            </div>
                          </td>
                          <td>{formatQuantity(group.totalQuantity)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
