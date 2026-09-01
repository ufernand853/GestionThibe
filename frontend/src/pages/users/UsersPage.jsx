import { useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';

export default function UsersPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const isOperator = user?.role === 'Operador';
  const isAdmin = user?.role === 'Administrador';
  const canRead = permissions.includes('users.read') && !isOperator;
  const canWrite = permissions.includes('users.write') && !isOperator;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [locations, setLocations] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [formValues, setFormValues] = useState({
    username: '',
    email: '',
    password: '',
    roleId: '',
    status: 'active',
    localSaleEnabled: false,
    localSaleAllLocations: false,
    localSaleLocationId: ''
  });
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [usersResponse, rolesResponse, locationsResponse] = await Promise.all([
          api.get('/users'),
          api.get('/roles'),
          api.get('/locations', { query: { type: 'warehouse', status: 'active' } })
        ]);
        if (!active) return;
        setUsers(Array.isArray(usersResponse) ? usersResponse : []);
        setRoles(Array.isArray(rolesResponse) ? rolesResponse : []);
        setLocations((Array.isArray(locationsResponse) ? locationsResponse : []).filter(location => location.isLocal));
      } catch (err) {
        if (!active) return;
        setError(err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    if (canRead) {
      load();
    } else {
      setLoading(false);
    }
    return () => {
      active = false;
    };
  }, [api, canRead]);

  const handleFormChange = event => {
    const { name, value, type, checked } = event.target;
    setFormValues(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
  };

  const handleEdit = userToEdit => {
    setSelectedUser(userToEdit);
    setFormValues({
      username: userToEdit.username,
      email: userToEdit.email,
      password: '',
      roleId: userToEdit.roleId || '',
      status: userToEdit.status || 'active',
      localSaleEnabled: Boolean(userToEdit.localSaleEnabled),
      localSaleAllLocations: Boolean(userToEdit.localSaleAllLocations),
      localSaleLocationId: userToEdit.localSaleLocation?.id || ''
    });
  };

  const resetForm = () => {
    setSelectedUser(null);
    setFormValues({ username: '', email: '', password: '', roleId: '', status: 'active', localSaleEnabled: false, localSaleAllLocations: false, localSaleLocationId: '' });
  };

  const handleSubmit = async event => {
    event.preventDefault();
    if (!canWrite) return;
    setSaving(true);
    setError(null);
    try {
      if (selectedUser) {
        const payload = {
          username: formValues.username,
          email: formValues.email,
          roleId: formValues.roleId,
          status: formValues.status,
          localSaleEnabled: formValues.localSaleEnabled,
          localSaleAllLocations: formValues.localSaleEnabled && formValues.localSaleAllLocations,
          localSaleLocationId: formValues.localSaleEnabled && !formValues.localSaleAllLocations ? formValues.localSaleLocationId : null
        };
        if (formValues.password) {
          payload.password = formValues.password;
        }
        const updated = await api.put(`/users/${selectedUser.id}`, payload);
        setUsers(prev => prev.map(current => (current.id === updated.id ? updated : current)));
        setSuccessMessage(`Usuario ${updated.username} actualizado.`);
      } else {
        const created = await api.post('/users', formValues);
        setUsers(prev => [created, ...prev]);
        setSuccessMessage(`Usuario ${created.username} creado.`);
      }
      resetForm();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDisable = async userId => {
    if (!canWrite) return;
    if (!window.confirm('¿Seguro desea deshabilitar este usuario?')) {
      return;
    }
    try {
      setError(null);
      setSuccessMessage('');
      await api.delete(`/users/${userId}`);
      setUsers(prev => prev.map(current => (current.id === userId ? { ...current, status: 'disabled' } : current)));
      setSuccessMessage('Usuario deshabilitado.');
    } catch (err) {
      setError(err);
    }
  };

  const handleDelete = async userId => {
    if (!canWrite || !isAdmin) return;
    if (!window.confirm('¿Seguro desea eliminar este usuario de forma permanente?')) {
      return;
    }
    try {
      setError(null);
      setSuccessMessage('');
      await api.delete(`/users/${userId}/permanent`);
      setUsers(prev => prev.filter(current => current.id !== userId));
      if (selectedUser?.id === userId) {
        resetForm();
      }
      setSuccessMessage('Usuario eliminado.');
    } catch (err) {
      setError(err);
    }
  };

  if (!canRead) {
    return <ErrorMessage error="No tiene permisos para ver usuarios." />;
  }

  if (loading) {
    return <LoadingIndicator message="Cargando usuarios..." />;
  }

  return (
    <div>
      <h2>Administración de usuarios</h2>
      <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
        Gestione cuentas, roles y estados de acceso al sistema.
      </p>

      {error && <ErrorMessage error={error} />}
      {successMessage && <div className="success-message">{successMessage}</div>}

      <div className="section-card">
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Email</th>
                <th>Rol</th>
                <th>Permisos</th>
                <th>Estado</th>
                <th>Venta local</th>
                <th>Último acceso</th>
                {canWrite && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {users.map(current => (
                <tr key={current.id}>
                  <td>{current.username}</td>
                  <td>{current.email}</td>
                  <td>{current.role || '-'}</td>
                  <td>
                    <div className="chip-list">
                      {current.permissions?.map(permission => (
                        <span key={permission} className="badge">
                          {permission}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{current.localSaleEnabled ? current.localSaleAllLocations ? 'Todos los locales' : current.localSaleLocation?.name || 'Habilitado' : '-'}</td>
                  <td>
                    <span className={`badge ${current.status === 'active' ? 'approved' : 'rejected'}`}>
                      {current.status}
                    </span>
                  </td>
                  <td>{current.lastLoginAt ? new Date(current.lastLoginAt).toLocaleString('es-AR') : '-'}</td>
                  {canWrite && (
                    <td>
                      <div className="inline-actions">
                        <button type="button" className="secondary-button" onClick={() => handleEdit(current)}>
                          Editar
                        </button>
                        {isAdmin && current.id !== user?.id && (
                          <button
                            type="button"
                            className="danger-button"
                            onClick={() => handleDelete(current.id)}
                          >
                            Eliminar
                          </button>
                        )}
                        {current.status !== 'disabled' && (
                          <button type="button" onClick={() => handleDisable(current.id)}>
                            Deshabilitar
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={canWrite ? 8 : 7} style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                    No hay usuarios registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {canWrite && (
        <div className="section-card">
          <h3>{selectedUser ? 'Editar usuario' : 'Nuevo usuario'}</h3>
          <form className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }} onSubmit={handleSubmit}>
            <div className="input-group">
              <label htmlFor="username">Usuario *</label>
              <input
                id="username"
                name="username"
                value={formValues.username}
                onChange={handleFormChange}
                required
              />
            </div>
            <div className="input-group">
              <label htmlFor="localSaleEnabled">Venta desde Local</label>
              <label className="checkbox-label">
                <input id="localSaleEnabled" name="localSaleEnabled" type="checkbox" checked={formValues.localSaleEnabled} onChange={handleFormChange} />
                Habilitar esta credencial
              </label>
            </div>
            {formValues.localSaleEnabled && (
              <div className="input-group">
                <label htmlFor="localSaleAllLocations">Alcance</label>
                <label className="checkbox-label">
                  <input id="localSaleAllLocations" name="localSaleAllLocations" type="checkbox" checked={formValues.localSaleAllLocations} onChange={handleFormChange} />
                  Permitir operar en todos los locales
                </label>
              </div>
            )}
            {formValues.localSaleEnabled && !formValues.localSaleAllLocations && (
              <div className="input-group">
                <label htmlFor="localSaleLocationId">Local asignado *</label>
                <select id="localSaleLocationId" name="localSaleLocationId" value={formValues.localSaleLocationId} onChange={handleFormChange} required>
                  <option value="">Seleccione local</option>
                  {locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
                </select>
              </div>
            )}
            <div className="input-group">
              <label htmlFor="email">Email *</label>
              <input
                id="email"
                name="email"
                type="email"
                value={formValues.email}
                onChange={handleFormChange}
                required
              />
            </div>
            <div className="input-group">
              <label htmlFor="roleId">Rol *</label>
              <select id="roleId" name="roleId" value={formValues.roleId} onChange={handleFormChange} required>
                <option value="">Seleccione rol</option>
                {roles.map(role => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="input-group">
              <label htmlFor="status">Estado</label>
              <select id="status" name="status" value={formValues.status} onChange={handleFormChange}>
                <option value="active">Activo</option>
                <option value="disabled">Deshabilitado</option>
              </select>
            </div>
            <div className="input-group">
              <label htmlFor="password">Contraseña {selectedUser ? '(opcional)' : '*'}</label>
              <input
                id="password"
                name="password"
                type="password"
                value={formValues.password}
                onChange={handleFormChange}
                required={!selectedUser}
              />
            </div>
            <div>
              <button type="submit" disabled={saving}>
                {saving ? 'Guardando...' : selectedUser ? 'Actualizar usuario' : 'Crear usuario'}
              </button>
            </div>
            {selectedUser && (
              <div>
                <button type="button" className="secondary-button" onClick={resetForm}>
                  Cancelar
                </button>
              </div>
            )}
          </form>
        </div>
      )}
    </div>
  );
}
