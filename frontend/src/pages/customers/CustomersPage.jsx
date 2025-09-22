import { useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';

export default function CustomersPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const canWrite = permissions.includes('items.write');
  const canViewReserved = permissions.includes('reports.read');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [formValues, setFormValues] = useState({ name: '', contactInfo: '', status: 'active' });
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerStock, setCustomerStock] = useState([]);
  const [loadingStock, setLoadingStock] = useState(false);

  useEffect(() => {
    let active = true;
    const loadCustomers = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await api.get('/customers');
        if (!active) return;
        setCustomers(Array.isArray(response) ? response : []);
        if (response?.[0]) {
          setSelectedCustomer(response[0]);
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
    loadReserved(selectedCustomer?.id);
    return () => {
      active = false;
    };
  }, [api, canViewReserved, selectedCustomer?.id]);

  const handleFormChange = event => {
    const { name, value } = event.target;
    setFormValues(prev => ({ ...prev, [name]: value }));
  };

  const handleEdit = customer => {
    setSelectedCustomer(customer);
    setFormValues({
      name: customer.name,
      contactInfo: customer.contactInfo || '',
      status: customer.status || 'active'
    });
  };

  const handleSubmit = async event => {
    event.preventDefault();
    if (!canWrite) return;
    setSaving(true);
    setError(null);
    try {
      if (selectedCustomer && customers.some(customer => customer.id === selectedCustomer.id)) {
        const updated = await api.put(`/customers/${selectedCustomer.id}`, formValues);
        setCustomers(prev => prev.map(customer => (customer.id === updated.id ? updated : customer)));
        setSuccessMessage(`Cliente ${updated.name} actualizado.`);
      } else {
        const created = await api.post('/customers', formValues);
        setCustomers(prev => [created, ...prev]);
        setSelectedCustomer(created);
        setSuccessMessage(`Cliente ${created.name} creado.`);
      }
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
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
          <span className="badge">{customers.length} clientes</span>
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
                  onClick={() => setSelectedCustomer(customer)}
                  style={{ backgroundColor: selectedCustomer?.id === customer.id ? '#e2e8f0' : undefined, cursor: 'pointer' }}
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
                      <button type="button" className="secondary-button" onClick={() => handleEdit(customer)}>
                        Editar
                      </button>
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
          <h3>{selectedCustomer ? 'Editar cliente' : 'Nuevo cliente'}</h3>
          <form className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }} onSubmit={handleSubmit}>
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
                {saving ? 'Guardando...' : selectedCustomer ? 'Actualizar cliente' : 'Crear cliente'}
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
          <div className="table-wrapper" style={{ marginTop: '1rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Artículo</th>
                  <th>Código</th>
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
                    <td>{record.quantity}</td>
                    <td>{record.status}</td>
                    <td>{new Date(record.dateCreated).toLocaleDateString('es-AR')}</td>
                    <td>{record.dateDelivered ? new Date(record.dateDelivered).toLocaleDateString('es-AR') : '-'}</td>
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
