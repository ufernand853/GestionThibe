import { useCallback, useEffect, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';

const formatDateTime = value => value
  ? new Intl.DateTimeFormat('es-AR', {
      dateStyle: 'short', timeStyle: 'short', hour12: false
    }).format(new Date(value))
  : '-';

export default function ItemsTrashPage() {
  const api = useApi();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [workingId, setWorkingId] = useState(null);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/items/trash');
      setItems(Array.isArray(response?.items) ? response.items : []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const restore = async item => {
    if (!window.confirm(`¿Restaurar el artículo ${item.code}?`)) return;
    setWorkingId(item.id);
    try {
      await api.post(`/items/trash/${item.id}/restore`, {});
      setItems(prev => prev.filter(candidate => candidate.id !== item.id));
      setMessage(`Artículo ${item.code} restaurado.`);
    } catch (err) {
      setError(err);
    } finally {
      setWorkingId(null);
    }
  };

  const removePermanently = async item => {
    if (!window.confirm(`¿Eliminar definitivamente ${item.code}? Esta acción no se puede deshacer.`)) return;
    setWorkingId(item.id);
    try {
      await api.delete(`/items/trash/${item.id}`);
      setItems(prev => prev.filter(candidate => candidate.id !== item.id));
      setMessage(`Artículo ${item.code} eliminado definitivamente.`);
    } catch (err) {
      setError(err);
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <div>
      <div className="flex-between">
        <div>
          <h2>Papelera de artículos</h2>
          <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
            Los artículos se eliminan definitivamente 30 días después de enviarlos a la papelera.
          </p>
        </div>
        <span className="badge">Total: {items.length}</span>
      </div>
      {error && <ErrorMessage error={error} />}
      {message && <div className="success-message">{message}</div>}
      {loading ? <LoadingIndicator message="Cargando papelera..." /> : (
        <div className="section-card">
          <div className="table-wrapper">
            <table>
              <thead><tr><th>Código</th><th>Descripción</th><th>Eliminado por</th><th>Fecha</th><th>Eliminación definitiva</th><th>Acciones</th></tr></thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id}>
                    <td>{item.code}</td><td>{item.description}</td><td>{item.deletedBy || '-'}</td>
                    <td>{formatDateTime(item.deletedAt)}</td><td>{formatDateTime(item.scheduledDeletionAt)}</td>
                    <td><div className="inline-actions">
                      <button type="button" onClick={() => restore(item)} disabled={workingId === item.id}>Restaurar</button>
                      <button type="button" className="danger-button" onClick={() => removePermanently(item)} disabled={workingId === item.id}>Eliminar definitivamente</button>
                    </div></td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan="6" style={{ textAlign: 'center' }}>La papelera está vacía.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
