import { useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';

const INITIAL_FORM_STATE = { name: '', description: '', status: 'active' };

export default function DepositsPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const canWrite = permissions.includes('items.write');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deposits, setDeposits] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [formValues, setFormValues] = useState({ ...INITIAL_FORM_STATE });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  const normalizeDeposit = deposit => {
    const rawId = deposit.id || deposit._id;
    return {
      id:
        rawId && typeof rawId === 'object' && typeof rawId.toString === 'function'
          ? rawId.toString()
          : rawId || '',
      name: deposit.name || '',
      description: deposit.description || '',
      status: deposit.status || 'active'
    };
  };

  useEffect(() => {
    let active = true;
    const loadDeposits = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await api.get('/deposits');
        if (!active) return;
        const normalized = Array.isArray(response)
          ? response.map(normalizeDeposit).sort((a, b) => a.name.localeCompare(b.name, 'es'))
          : [];
        setDeposits(normalized);
      } catch (err) {
        if (!active) return;
        setError(err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    loadDeposits();
    return () => {
      active = false;
    };
  }, [api]);

  const handleFormChange = event => {
    const { name, value } = event.target;
    setSuccessMessage('');
    setFormValues(prev => ({ ...prev, [name]: value }));
  };

  const handleEdit = deposit => {
    setEditingId(deposit.id);
    setFormValues({
      name: deposit.name,
      description: deposit.description,
      status: deposit.status
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
        const updated = await api.put(`/deposits/${editingId}`, payload);
        const normalized = normalizeDeposit(updated);
        setDeposits(prev =>
          prev
            .map(deposit => (deposit.id === normalized.id ? normalized : deposit))
            .sort((a, b) => a.name.localeCompare(b.name, 'es'))
        );
        setSuccessMessage(`Depósito ${normalized.name} actualizado.`);
      } else {
        const created = await api.post('/deposits', payload);
        const normalized = normalizeDeposit(created);
        setDeposits(prev =>
          [...prev, normalized].sort((a, b) => a.name.localeCompare(b.name, 'es'))
        );
        setSuccessMessage(`Depósito ${normalized.name} creado.`);
        setEditingId(normalized.id);
      }
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async deposit => {
    if (!canWrite || !deposit?.id) return;
    const confirmed = window.confirm(`¿Eliminar el depósito "${deposit.name}"? Esta acción no se puede deshacer.`);
    if (!confirmed) {
      return;
    }
    setDeletingId(deposit.id);
    setError(null);
    setSuccessMessage('');
    try {
      await api.delete(`/deposits/${deposit.id}`);
      setDeposits(prev =>
        prev.filter(current => current.id !== deposit.id).sort((a, b) => a.name.localeCompare(b.name, 'es'))
      );
      if (editingId === deposit.id) {
        handleCreateNew();
      }
      setSuccessMessage(`Depósito ${deposit.name} eliminado.`);
    } catch (err) {
      setError(err);
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) {
    return <LoadingIndicator message="Cargando depósitos..." />;
  }

  return (
    <div>
      <h2>Depósitos</h2>
      <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
        Administre los depósitos disponibles para transferir stock entre ubicaciones.
      </p>

      {error && <ErrorMessage error={error} />}
      {successMessage && <div className="success-message">{successMessage}</div>}

      <div className="section-card">
        <div className="flex-between">
          <h3>Listado de depósitos</h3>
          <div className="inline-actions" style={{ alignItems: 'center' }}>
            {canWrite && (
              <button type="button" className="secondary-button" onClick={handleCreateNew}>
                Nuevo depósito
              </button>
            )}
            <span className="badge">{deposits.length} depósitos</span>
          </div>
        </div>
        <div className="table-wrapper" style={{ marginTop: '1rem' }}>
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Descripción</th>
                <th>Estado</th>
                {canWrite && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {deposits.map(deposit => (
                <tr key={deposit.id}>
                  <td>{deposit.name}</td>
                  <td>{deposit.description || '-'}</td>
                  <td>
                    <span className={`badge ${deposit.status === 'active' ? 'approved' : 'rejected'}`}>
                      {deposit.status}
                    </span>
                  </td>
                  {canWrite && (
                    <td>
                      <div className="inline-actions">
                        <button type="button" className="secondary-button" onClick={() => handleEdit(deposit)}>
                          Editar
                        </button>
                        <button
                          type="button"
                          className="danger-button"
                          onClick={() => handleDelete(deposit)}
                          disabled={deletingId === deposit.id}
                        >
                          {deletingId === deposit.id ? 'Eliminando...' : 'Eliminar'}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {deposits.length === 0 && (
                <tr>
                  <td colSpan={canWrite ? 4 : 3} style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                    No hay depósitos registrados.
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
            <h3>{editingId ? 'Editar depósito' : 'Nuevo depósito'}</h3>
            {editingId && (
              <button
                type="button"
                className="danger-button"
                onClick={() => handleDelete(deposits.find(deposit => deposit.id === editingId))}
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
              <label htmlFor="depositName">Nombre *</label>
              <input id="depositName" name="name" value={formValues.name} onChange={handleFormChange} required />
            </div>
            <div className="input-group">
              <label htmlFor="depositDescription">Descripción</label>
              <input
                id="depositDescription"
                name="description"
                value={formValues.description}
                onChange={handleFormChange}
              />
            </div>
            <div className="input-group">
              <label htmlFor="depositStatus">Estado</label>
              <select id="depositStatus" name="status" value={formValues.status} onChange={handleFormChange}>
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
              </select>
            </div>
            <div>
              <button type="submit" disabled={saving}>
                {saving ? 'Guardando...' : editingId ? 'Actualizar depósito' : 'Crear depósito'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
