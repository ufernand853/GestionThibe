import { useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';

const INITIAL_FORM_STATE = { name: '', contactInfo: '', status: 'active' };

export default function DestinationsPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const canWrite = permissions.includes('items.write');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [destinations, setDestinations] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [formValues, setFormValues] = useState({ ...INITIAL_FORM_STATE });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  const normalizeDestination = destination => {
    const rawId = destination.id || destination._id;
    return {
      id:
        rawId && typeof rawId === 'object' && typeof rawId.toString === 'function'
          ? rawId.toString()
          : rawId || '',
      name: destination.name || '',
      contactInfo: destination.contactInfo || '',
      status: destination.status || 'active'
    };
  };

  useEffect(() => {
    let active = true;
    const loadDestinations = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await api.get('/destinations');
        if (!active) return;
        const normalized = Array.isArray(response)
          ? response.map(normalizeDestination).sort((a, b) => a.name.localeCompare(b.name, 'es'))
          : [];
        setDestinations(normalized);
      } catch (err) {
        if (!active) return;
        setError(err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    loadDestinations();
    return () => {
      active = false;
    };
  }, [api]);

  const handleFormChange = event => {
    const { name, value } = event.target;
    setSuccessMessage('');
    setFormValues(prev => ({ ...prev, [name]: value }));
  };

  const handleEdit = destination => {
    setEditingId(destination.id);
    setFormValues({
      name: destination.name,
      contactInfo: destination.contactInfo,
      status: destination.status
    });
    setSuccessMessage('');
    setError(null);
  };

  const handleCreateNew = () => {
    setEditingId(null);
    setFormValues({ ...INITIAL_FORM_STATE });
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
        const updated = await api.put(`/destinations/${editingId}`, payload);
        const normalized = normalizeDestination(updated);
        setDestinations(prev =>
          prev
            .map(destination => (destination.id === normalized.id ? normalized : destination))
            .sort((a, b) => a.name.localeCompare(b.name, 'es'))
        );
        setSuccessMessage(`Destino ${normalized.name} actualizado.`);
      } else {
        const created = await api.post('/destinations', payload);
        const normalized = normalizeDestination(created);
        setDestinations(prev =>
          [...prev, normalized].sort((a, b) => a.name.localeCompare(b.name, 'es'))
        );
        setSuccessMessage(`Destino ${normalized.name} creado.`);
        setEditingId(normalized.id);
      }
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async destination => {
    if (!canWrite || !destination?.id) return;
    const confirmed = window.confirm(`¿Eliminar el destino "${destination.name}"? Esta acción no se puede deshacer.`);
    if (!confirmed) {
      return;
    }
    setDeletingId(destination.id);
    setError(null);
    setSuccessMessage('');
    try {
      await api.delete(`/destinations/${destination.id}`);
      setDestinations(prev =>
        prev.filter(current => current.id !== destination.id).sort((a, b) => a.name.localeCompare(b.name, 'es'))
      );
      if (editingId === destination.id) {
        handleCreateNew();
      }
      setSuccessMessage(`Destino ${destination.name} eliminado.`);
    } catch (err) {
      setError(err);
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return <LoadingIndicator message="Cargando destinos..." />;
  }

  return (
    <div>
      <h2>Destinos</h2>
      <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
        Gestione los destinos disponibles para envíos u operaciones logísticas.
      </p>

      {error && <ErrorMessage error={error} />}
      {successMessage && <div className="success-message">{successMessage}</div>}

      <div className="section-card">
        <div className="flex-between">
          <h3>Listado de destinos</h3>
          <div className="inline-actions" style={{ alignItems: 'center' }}>
            {canWrite && (
              <button type="button" className="secondary-button" onClick={handleCreateNew}>
                Nuevo destino
              </button>
            )}
            <span className="badge">{destinations.length} destinos</span>
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
              {destinations.map(destination => (
                <tr key={destination.id}>
                  <td>{destination.name}</td>
                  <td>{destination.contactInfo || '-'}</td>
                  <td>
                    <span className={`badge ${destination.status === 'active' ? 'approved' : 'rejected'}`}>
                      {destination.status}
                    </span>
                  </td>
                  {canWrite && (
                    <td>
                      <div className="inline-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => handleEdit(destination)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="danger-button"
                          onClick={() => handleDelete(destination)}
                          disabled={deletingId === destination.id}
                        >
                          {deletingId === destination.id ? 'Eliminando...' : 'Eliminar'}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {destinations.length === 0 && (
                <tr>
                  <td colSpan={canWrite ? 4 : 3} style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                    No hay destinos registrados.
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
            <h3>{editingId ? 'Editar destino' : 'Nuevo destino'}</h3>
            {editingId && (
              <button
                type="button"
                className="danger-button"
                onClick={() => handleDelete(destinations.find(destination => destination.id === editingId))}
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
              <label htmlFor="destinationName">Nombre *</label>
              <input
                id="destinationName"
                name="name"
                value={formValues.name}
                onChange={handleFormChange}
                required
              />
            </div>
            <div className="input-group">
              <label htmlFor="destinationContact">Contacto</label>
              <input
                id="destinationContact"
                name="contactInfo"
                value={formValues.contactInfo}
                onChange={handleFormChange}
              />
            </div>
            <div className="input-group">
              <label htmlFor="destinationStatus">Estado</label>
              <select id="destinationStatus" name="status" value={formValues.status} onChange={handleFormChange}>
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
              </select>
            </div>
            <div>
              <button type="submit" disabled={saving}>
                {saving ? 'Guardando...' : editingId ? 'Actualizar destino' : 'Crear destino'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
