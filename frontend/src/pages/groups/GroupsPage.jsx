import { useCallback, useEffect, useMemo, useState } from 'react';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';

export default function GroupsPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const canWrite = permissions.includes('items.write');

  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [groupForm, setGroupForm] = useState({ name: '', parentId: '' });
  const [groupEditForm, setGroupEditForm] = useState({ name: '', parentId: '' });
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupCreateError, setGroupCreateError] = useState('');
  const [groupManagementError, setGroupManagementError] = useState('');
  const [editingGroupId, setEditingGroupId] = useState(null);
  const [savingGroupId, setSavingGroupId] = useState(null);
  const [deletingGroupId, setDeletingGroupId] = useState(null);

  const normalizeGroup = useCallback(group => {
    if (!group) {
      return group;
    }
    const id = group.id || group._id;
    if (!id) {
      return { ...group };
    }
    return { ...group, id };
  }, []);

  const sortGroupsByName = useCallback(
    list => [...list].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })),
    []
  );

  const groupMapById = useMemo(() => {
    const map = new Map();
    groups.forEach(group => {
      if (!group) {
        return;
      }
      const id = group.id || group._id;
      if (id) {
        map.set(id, group);
      }
    });
    return map;
  }, [groups]);

  useEffect(() => {
    let active = true;
    const loadGroups = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await api.get('/groups');
        if (!active) {
          return;
        }
        setGroups(
          Array.isArray(response)
            ? sortGroupsByName(response.map(item => normalizeGroup(item)))
            : []
        );
      } catch (err) {
        if (active) {
          setError(err);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    loadGroups();
    return () => {
      active = false;
    };
  }, [api, sortGroupsByName, normalizeGroup]);

  const handleGroupFormChange = event => {
    const { name, value } = event.target;
    const sanitizedValue = value === 'undefined' ? '' : value;
    setGroupForm(prev => ({ ...prev, [name]: sanitizedValue }));
    setGroupCreateError('');
    setGroupManagementError('');
    setSuccessMessage('');
  };

  const handleGroupEditFormChange = event => {
    const { name, value } = event.target;
    const sanitizedValue = value === 'undefined' ? '' : value;
    setGroupEditForm(prev => ({ ...prev, [name]: sanitizedValue }));
    setGroupManagementError('');
    setSuccessMessage('');
  };

  const handleCreateGroup = async event => {
    event.preventDefault();
    if (!canWrite || !groupForm.name.trim()) {
      return;
    }
    setCreatingGroup(true);
    setGroupCreateError('');
    setGroupManagementError('');
    setSuccessMessage('');
    try {
      const payload = {
        name: groupForm.name.trim(),
        parentId: groupForm.parentId || undefined
      };
      const newGroup = await api.post('/groups', payload);
      const normalizedGroup = normalizeGroup(newGroup);
      setGroups(prev => sortGroupsByName([...prev, normalizedGroup]));
      setGroupForm({ name: '', parentId: '' });
      setSuccessMessage(`Grupo ${normalizedGroup.name} creado correctamente.`);
    } catch (err) {
      setGroupCreateError(err);
    } finally {
      setCreatingGroup(false);
    }
  };

  const startGroupEdit = group => {
    setGroupCreateError('');
    setGroupManagementError('');
    setSuccessMessage('');
    setEditingGroupId(group.id);
    setGroupEditForm({ name: group.name || '', parentId: group.parent || '' });
  };

  const cancelGroupEdit = () => {
    setEditingGroupId(null);
    setGroupEditForm({ name: '', parentId: '' });
    setGroupManagementError('');
  };

  const handleUpdateGroup = async () => {
    if (!editingGroupId) {
      return;
    }
    const trimmedName = groupEditForm.name.trim();
    if (!trimmedName) {
      setGroupManagementError('El nombre es obligatorio');
      return;
    }
    setSavingGroupId(editingGroupId);
    setGroupManagementError('');
    setSuccessMessage('');
    try {
      const payload = { name: trimmedName };
      if (groupEditForm.parentId) {
        payload.parentId = groupEditForm.parentId;
      } else {
        payload.parentId = null;
      }
      const updatedGroup = await api.put(`/groups/${editingGroupId}`, payload);
      const normalizedGroup = normalizeGroup(updatedGroup);
      setGroups(prev =>
        sortGroupsByName(prev.map(group => (group.id === editingGroupId ? normalizedGroup : group)))
      );
      setSuccessMessage(`Grupo ${normalizedGroup.name} actualizado correctamente.`);
      cancelGroupEdit();
    } catch (err) {
      setGroupManagementError(err);
    } finally {
      setSavingGroupId(null);
    }
  };

  const handleDeleteGroup = async group => {
    if (!canWrite) {
      return;
    }
    const confirmed = window.confirm(
      `¿Seguro que deseas eliminar el grupo "${group.name}"? Esta acción no se puede deshacer.`
    );
    if (!confirmed) {
      return;
    }
    setDeletingGroupId(group.id);
    setGroupManagementError('');
    setGroupCreateError('');
    setSuccessMessage('');
    try {
      await api.delete(`/groups/${group.id}`);
      setGroups(prev => prev.filter(item => item.id !== group.id));
      setGroupForm(prev => (prev.parentId === group.id ? { ...prev, parentId: '' } : prev));
      if (editingGroupId === group.id) {
        cancelGroupEdit();
      }
      setSuccessMessage(`Grupo ${group.name} eliminado correctamente.`);
    } catch (err) {
      setGroupManagementError(err);
    } finally {
      setDeletingGroupId(null);
    }
  };

  if (loading) {
    return <LoadingIndicator message="Cargando grupos..." />;
  }

  return (
    <div>
      <div className="flex-between">
        <div>
          <h2>Gestión de grupos</h2>
          <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
            Administre la estructura jerárquica de grupos para organizar los artículos del catálogo.
          </p>
        </div>
      </div>

      {error && <ErrorMessage error={error} />}
      {successMessage && <div className="success-message">{successMessage}</div>}

      {!canWrite ? (
        <div className="section-card">
          <p style={{ margin: 0, color: '#64748b' }}>
            No tiene permisos para modificar los grupos. Solicite acceso al administrador del sistema.
          </p>
        </div>
      ) : (
        <div className="section-card">
          <h3 style={{ marginTop: 0 }}>Crear nuevo grupo</h3>
          <form
            className="form-grid"
            onSubmit={handleCreateGroup}
            style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', marginTop: '1rem' }}
          >
            <div className="input-group">
              <label htmlFor="groupName">Nombre *</label>
              <input
                id="groupName"
                name="name"
                value={groupForm.name}
                onChange={handleGroupFormChange}
                placeholder="Ej. Calzado"
                required
              />
            </div>
            <div className="input-group">
              <label htmlFor="parentGroup">Grupo padre</label>
              <select
                id="parentGroup"
                name="parentId"
                value={groupForm.parentId}
                onChange={handleGroupFormChange}
              >
                <option value="">Sin padre</option>
                {groups.map(group => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button type="submit" disabled={creatingGroup}>
                {creatingGroup ? 'Creando...' : 'Crear grupo'}
              </button>
            </div>
          </form>
          <ErrorMessage error={groupCreateError} />
        </div>
      )}

      <div className="section-card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ marginTop: 0, marginBottom: '0.75rem' }}>Grupos existentes</h3>
        {groups.length === 0 ? (
          <p style={{ color: '#94a3b8', margin: 0 }}>Aún no hay grupos configurados.</p>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th style={{ width: '35%' }}>Nombre</th>
                  <th style={{ width: '35%' }}>Grupo padre</th>
                  <th style={{ width: '30%' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(group => {
                  const isEditing = editingGroupId === group.id;
                  const isSaving = savingGroupId === group.id;
                  const isDeleting = deletingGroupId === group.id;
                  const parentName = group.parent
                    ? groupMapById.get(group.parent)?.name || 'Sin padre'
                    : 'Sin padre';

                  if (!canWrite && !isEditing) {
                    return (
                      <tr key={group.id}>
                        <td>{group.name}</td>
                        <td>{parentName}</td>
                        <td style={{ color: '#94a3b8' }}>Sin permisos</td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={group.id}>
                      <td>
                        {isEditing ? (
                          <input
                            name="name"
                            value={groupEditForm.name}
                            onChange={handleGroupEditFormChange}
                            disabled={isSaving}
                            required
                          />
                        ) : (
                          group.name
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <select
                            name="parentId"
                            value={groupEditForm.parentId}
                            onChange={handleGroupEditFormChange}
                            disabled={isSaving}
                          >
                            <option value="">Sin padre</option>
                            {groups
                              .filter(option => option.id !== group.id)
                              .map(option => (
                                <option key={option.id} value={option.id}>
                                  {option.name}
                                </option>
                              ))}
                          </select>
                        ) : (
                          parentName
                        )}
                      </td>
                      <td>
                        {isEditing ? (
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button type="button" onClick={handleUpdateGroup} disabled={isSaving}>
                              {isSaving ? 'Guardando...' : 'Guardar'}
                            </button>
                            <button
                              type="button"
                              onClick={cancelGroupEdit}
                              disabled={isSaving}
                              style={{
                                backgroundColor: '#e2e8f0',
                                color: '#0f172a',
                                border: '1px solid #cbd5f5'
                              }}
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button
                              type="button"
                              onClick={() => startGroupEdit(group)}
                              disabled={
                                (editingGroupId && editingGroupId !== group.id) ||
                                isDeleting ||
                                savingGroupId !== null ||
                                deletingGroupId !== null
                              }
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteGroup(group)}
                              disabled={
                                isDeleting ||
                                savingGroupId !== null ||
                                deletingGroupId !== null ||
                                editingGroupId !== null
                              }
                              style={{ backgroundColor: '#dc2626' }}
                            >
                              {isDeleting ? 'Eliminando...' : 'Eliminar'}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <ErrorMessage error={groupManagementError} />
      </div>
    </div>
  );
}
