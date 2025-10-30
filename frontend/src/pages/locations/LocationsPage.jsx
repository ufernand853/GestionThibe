import { useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';

const INITIAL_FORM_STATE = {
  name: '',
  type: 'warehouse',
  description: '',
  contactInfo: '',
  status: 'active'
};

const TYPE_LABELS = {
  warehouse: 'Depósito interno',
  external: 'Destino externo'
};

export default function LocationsPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const isOperator = user?.role === 'Operador';
  const canRead = permissions.includes('items.read') && !isOperator;
  const canWrite = permissions.includes('items.write') && !isOperator;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [locations, setLocations] = useState([]);
  const [filterType, setFilterType] = useState('all');
  const [editingId, setEditingId] = useState(null);
  const [formValues, setFormValues] = useState({ ...INITIAL_FORM_STATE });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  const normalizeLocation = location => {
    const rawId = location.id || location._id;
    const normalizedId =
      rawId && typeof rawId === 'object' && typeof rawId.toString === 'function'
        ? rawId.toString()
        : rawId || '';

    return {
      id: normalizedId,
      name: location.name || '',
      type: location.type === 'external' ? 'external' : 'warehouse',
      description: location.description || '',
      contactInfo: location.contactInfo || '',
      status: location.status === 'inactive' ? 'inactive' : 'active'
    };
  };

  useEffect(() => {
    let active = true;
    const loadLocations = async () => {
      setLoading(true);
      setError(null);
      try {
        if (!canRead) {
          setLocations([]);
          setLoading(false);
          return;
        }
        const response = await api.get('/locations');
        if (!active) return;
        const normalized = Array.isArray(response)
          ? response
              .map(normalizeLocation)
              .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
          : [];
        setLocations(normalized);
      } catch (err) {
        if (!active) return;
        setError(err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    loadLocations();
    return () => {
      active = false;
    };
  }, [api, canRead]);

  const filteredLocations = useMemo(() => {
    if (filterType === 'all') {
      return locations;
    }
    return locations.filter(location => location.type === filterType);
  }, [filterType, locations]);

  const handleFormChange = event => {
    const { name, value } = event.target;
    setSuccessMessage('');
    setFormValues(prev => ({ ...prev, [name]: value }));
  };

  const handleCreateNew = () => {
    setEditingId(null);
    setFormValues({ ...INITIAL_FORM_STATE });
    setSuccessMessage('');
    setError(null);
  };

  const handleEdit = location => {
    setEditingId(location.id);
    setFormValues({
      name: location.name,
      type: location.type,
      description: location.description,
      contactInfo: location.contactInfo,
      status: location.status
    });
    setSuccessMessage('');
    setError(null);
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
      if (editingId) {
        const updated = await api.put(`/locations/${editingId}`, payload);
        const normalized = normalizeLocation(updated);
        setLocations(prev =>
          prev
            .map(location => (location.id === normalized.id ? normalized : location))
            .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
        );
        setSuccessMessage(`Ubicación ${normalized.name} actualizada.`);
      } else {
        const created = await api.post('/locations', payload);
        const normalized = normalizeLocation(created);
        setLocations(prev =>
          [...prev, normalized].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
        );
        setSuccessMessage(`Ubicación ${normalized.name} creada.`);
        setEditingId(normalized.id);
      }
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async location => {
    if (!canWrite || !location?.id) return;
    const confirmed = window.confirm(
      `¿Eliminar la ubicación "${location.name}"? Esta acción no se puede deshacer.`
    );
    if (!confirmed) {
      return;
    }
    setDeletingId(location.id);
    setError(null);
    setSuccessMessage('');
    try {
      await api.delete(`/locations/${location.id}`);
      setLocations(prev =>
        prev
          .filter(current => current.id !== location.id)
          .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
      );
      if (editingId === location.id) {
        handleCreateNew();
      }
      setSuccessMessage(`Ubicación ${location.name} eliminada.`);
    } catch (err) {
      setError(err);
    } finally {
      setDeletingId(null);
    }
  };

  if (!canRead) {
    return <ErrorMessage error="No tiene permisos para acceder a las ubicaciones." />;
  }

  if (loading) {
    return <LoadingIndicator message="Cargando ubicaciones..." />;
  }

  return (
    <div>
      <h2>Ubicaciones</h2>
      <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
        Administre depósitos internos y destinos externos desde un único catálogo.
      </p>

      {error && <ErrorMessage error={error} />}
      {successMessage && <div className="success-message">{successMessage}</div>}

      <div className="section-card">
        <div className="flex-between" style={{ alignItems: 'center' }}>
          <h3>Listado de ubicaciones</h3>
          <div className="inline-actions" style={{ alignItems: 'center', gap: '0.5rem' }}>
            <select
              value={filterType}
              onChange={event => setFilterType(event.target.value)}
              aria-label="Filtrar por tipo"
            >
              <option value="all">Todos los tipos</option>
              <option value="warehouse">Depósitos internos</option>
              <option value="external">Destinos externos</option>
            </select>
            {canWrite && (
              <button type="button" className="secondary-button" onClick={handleCreateNew}>
                Nueva ubicación
              </button>
            )}
            <span className="badge">{filteredLocations.length} ubicaciones</span>
          </div>
        </div>
        <div className="table-wrapper" style={{ marginTop: '1rem' }}>
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Descripción</th>
                <th>Contacto</th>
                <th>Estado</th>
                {canWrite && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {filteredLocations.map(location => (
                <tr key={location.id}>
                  <td>{location.name}</td>
                  <td>
                    <span className="badge neutral">{TYPE_LABELS[location.type] || location.type}</span>
                  </td>
                  <td>{location.description || '-'}</td>
                  <td>{location.contactInfo || '-'}</td>
                  <td>
                    <span className={`badge ${location.status === 'active' ? 'approved' : 'rejected'}`}>
                      {location.status}
                    </span>
                  </td>
                  {canWrite && (
                    <td>
                      <div className="inline-actions">
                        <button type="button" className="secondary-button" onClick={() => handleEdit(location)}>
                          Editar
                        </button>
                        <button
                          type="button"
                          className="danger-button"
                          onClick={() => handleDelete(location)}
                          disabled={deletingId === location.id}
                        >
                          {deletingId === location.id ? 'Eliminando...' : 'Eliminar'}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {filteredLocations.length === 0 && (
                <tr>
                  <td colSpan={canWrite ? 6 : 5} style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                    No hay ubicaciones registradas con el filtro seleccionado.
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
            <h3>{editingId ? 'Editar ubicación' : 'Nueva ubicación'}</h3>
            {editingId && (
              <button
                type="button"
                className="danger-button"
                onClick={() => handleDelete(locations.find(location => location.id === editingId))}
                disabled={deletingId === editingId}
              >
                {deletingId === editingId ? 'Eliminando...' : 'Eliminar'}
              </button>
            )}
          </div>
          <form
            className="form-grid"
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}
            onSubmit={handleSubmit}
          >
            <div className="input-group">
              <label htmlFor="locationName">Nombre *</label>
              <input id="locationName" name="name" value={formValues.name} onChange={handleFormChange} required />
            </div>
            <div className="input-group">
              <label htmlFor="locationType">Tipo</label>
              <select id="locationType" name="type" value={formValues.type} onChange={handleFormChange}>
                <option value="warehouse">Depósito interno</option>
                <option value="external">Destino externo</option>
              </select>
            </div>
            <div className="input-group">
              <label htmlFor="locationStatus">Estado</label>
              <select id="locationStatus" name="status" value={formValues.status} onChange={handleFormChange}>
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
              </select>
            </div>
            <div className="input-group">
              <label htmlFor="locationDescription">Descripción</label>
              <input
                id="locationDescription"
                name="description"
                value={formValues.description}
                onChange={handleFormChange}
              />
            </div>
            <div className="input-group">
              <label htmlFor="locationContact">Contacto</label>
              <input
                id="locationContact"
                name="contactInfo"
                value={formValues.contactInfo}
                onChange={handleFormChange}
              />
            </div>
            <div>
              <button type="submit" disabled={saving}>
                {saving ? 'Guardando...' : editingId ? 'Actualizar ubicación' : 'Crear ubicación'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
