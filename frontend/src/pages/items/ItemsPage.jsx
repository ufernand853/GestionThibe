import { useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';

const ATTRIBUTES = ['gender', 'size', 'color', 'material', 'season', 'fit'];

export default function ItemsPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const canWrite = permissions.includes('items.write');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [groups, setGroups] = useState([]);
  const [filters, setFilters] = useState({ search: '', groupId: '', gender: '', size: '', color: '' });
  const [formValues, setFormValues] = useState({
    code: '',
    description: '',
    groupId: '',
    gender: '',
    size: '',
    color: '',
    material: '',
    season: '',
    fit: '',
    stockGeneral: '',
    overstockGeneral: '',
    overstockThibe: '',
    overstockArenal: ''
  });
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [editingItem, setEditingItem] = useState(null);

  useEffect(() => {
    let active = true;
    const loadGroups = async () => {
      try {
        const response = await api.get('/groups');
        if (active) {
          setGroups(Array.isArray(response) ? response : []);
        }
      } catch (err) {
        console.warn('No se pudieron cargar los grupos', err);
      }
    };
    loadGroups();
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    let active = true;
    const loadItems = async () => {
      setLoading(true);
      setError(null);
      try {
        const query = {
          page,
          pageSize,
          search: filters.search,
          groupId: filters.groupId,
          gender: filters.gender,
          size: filters.size,
          color: filters.color
        };
        const response = await api.get('/items', { query });
        if (!active) return;
        setItems(response.items || []);
        setTotal(response.total || 0);
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
    loadItems();
    return () => {
      active = false;
    };
  }, [api, filters.color, filters.gender, filters.groupId, filters.search, filters.size, page, pageSize]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const resetForm = () => {
    setFormValues({
      code: '',
      description: '',
      groupId: '',
      gender: '',
      size: '',
      color: '',
      material: '',
      season: '',
      fit: '',
      stockGeneral: '',
      overstockGeneral: '',
      overstockThibe: '',
      overstockArenal: ''
    });
    setEditingItem(null);
  };

  const handleFormChange = event => {
    const { name, value } = event.target;
    setFormValues(prev => ({ ...prev, [name]: value }));
  };

  const buildPayload = () => {
    const stock = {
      general: formValues.stockGeneral === '' ? undefined : Number(formValues.stockGeneral),
      overstockGeneral:
        formValues.overstockGeneral === '' ? undefined : Number(formValues.overstockGeneral),
      overstockThibe: formValues.overstockThibe === '' ? undefined : Number(formValues.overstockThibe),
      overstockArenal:
        formValues.overstockArenal === '' ? undefined : Number(formValues.overstockArenal)
    };
    const attributes = {};
    ATTRIBUTES.forEach(attribute => {
      if (formValues[attribute]) {
        attributes[attribute] = formValues[attribute];
      }
    });
    return {
      description: formValues.description,
      groupId: formValues.groupId || null,
      attributes: Object.keys(attributes).length ? attributes : undefined,
      stock
    };
  };

  const handleSubmit = async event => {
    event.preventDefault();
    if (!canWrite) return;
    setSaving(true);
    setError(null);
    try {
      if (editingItem) {
        await api.put(`/items/${editingItem.id}`, buildPayload());
        setSuccessMessage(`Artículo ${editingItem.code} actualizado correctamente.`);
      } else {
        const payload = buildPayload();
        payload.code = formValues.code;
        const response = await api.post('/items', payload);
        setSuccessMessage(`Artículo ${response.code} creado correctamente.`);
      }
      resetForm();
      setPage(1);
      const refreshed = await api.get('/items', {
        query: { ...filters, page: 1, pageSize }
      });
      setItems(refreshed.items || []);
      setTotal(refreshed.total || 0);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = item => {
    setEditingItem(item);
    setFormValues({
      code: item.code,
      description: item.description,
      groupId: item.groupId || '',
      gender: item.attributes?.gender || '',
      size: item.attributes?.size || '',
      color: item.attributes?.color || '',
      material: item.attributes?.material || '',
      season: item.attributes?.season || '',
      fit: item.attributes?.fit || '',
      stockGeneral: item.stock?.general ?? '',
      overstockGeneral: item.stock?.overstockGeneral ?? '',
      overstockThibe: item.stock?.overstockThibe ?? '',
      overstockArenal: item.stock?.overstockArenal ?? ''
    });
  };

  return (
    <div>
      <div className="flex-between">
        <div>
          <h2>Gestión de artículos</h2>
          <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
            Administre la taxonomía, atributos y stock por lista para cada artículo.
          </p>
        </div>
        <div>
          <span className="badge">Total: {total}</span>
        </div>
      </div>

      {error && <ErrorMessage error={error} />}
      {successMessage && <div className="success-message">{successMessage}</div>}

      <div className="section-card">
        <form className="form-grid" onSubmit={handleSubmit} style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {!editingItem && (
            <div className="input-group">
              <label htmlFor="code">Código *</label>
              <input
                id="code"
                name="code"
                value={formValues.code}
                onChange={handleFormChange}
                required
                placeholder="SKU"
                disabled={!!editingItem}
              />
            </div>
          )}
          <div className="input-group">
            <label htmlFor="description">Descripción *</label>
            <input
              id="description"
              name="description"
              value={formValues.description}
              onChange={handleFormChange}
              required
              placeholder="Descripción detallada"
            />
          </div>
          <div className="input-group">
            <label htmlFor="groupId">Grupo</label>
            <select id="groupId" name="groupId" value={formValues.groupId} onChange={handleFormChange}>
              <option value="">Sin asignar</option>
              {groups.map(group => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          {ATTRIBUTES.map(attribute => (
            <div className="input-group" key={attribute}>
              <label htmlFor={attribute}>{attribute.charAt(0).toUpperCase() + attribute.slice(1)}</label>
              <input
                id={attribute}
                name={attribute}
                value={formValues[attribute]}
                onChange={handleFormChange}
                placeholder={`Ingrese ${attribute}`}
              />
            </div>
          ))}
          <div className="input-group">
            <label htmlFor="stockGeneral">Stock General</label>
            <input
              id="stockGeneral"
              name="stockGeneral"
              type="number"
              min="0"
              value={formValues.stockGeneral}
              onChange={handleFormChange}
            />
          </div>
          <div className="input-group">
            <label htmlFor="overstockGeneral">Sobrestock General</label>
            <input
              id="overstockGeneral"
              name="overstockGeneral"
              type="number"
              min="0"
              value={formValues.overstockGeneral}
              onChange={handleFormChange}
            />
          </div>
          <div className="input-group">
            <label htmlFor="overstockThibe">Sobrestock Thibe</label>
            <input
              id="overstockThibe"
              name="overstockThibe"
              type="number"
              min="0"
              value={formValues.overstockThibe}
              onChange={handleFormChange}
            />
          </div>
          <div className="input-group">
            <label htmlFor="overstockArenal">Sobrestock Arenal</label>
            <input
              id="overstockArenal"
              name="overstockArenal"
              type="number"
              min="0"
              value={formValues.overstockArenal}
              onChange={handleFormChange}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem' }}>
            <button type="submit" disabled={saving || !canWrite}>
              {editingItem ? 'Actualizar artículo' : 'Crear artículo'}
            </button>
            {editingItem && (
              <button type="button" className="secondary-button" onClick={resetForm}>
                Cancelar
              </button>
            )}
          </div>
        </form>
      </div>

      <div className="section-card">
        <h2>Buscar artículos</h2>
        <form className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <div className="input-group">
            <label htmlFor="search">Buscar</label>
            <input
              id="search"
              value={filters.search}
              onChange={event => {
                setFilters(prev => ({ ...prev, search: event.target.value }));
                setPage(1);
              }}
              placeholder="Código o descripción"
            />
          </div>
          <div className="input-group">
            <label htmlFor="filterGroup">Grupo</label>
            <select
              id="filterGroup"
              value={filters.groupId}
              onChange={event => {
                setFilters(prev => ({ ...prev, groupId: event.target.value }));
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {groups.map(group => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="filterGender">Género</label>
            <input
              id="filterGender"
              value={filters.gender}
              onChange={event => {
                setFilters(prev => ({ ...prev, gender: event.target.value }));
                setPage(1);
              }}
              placeholder="Dama, Caballero..."
            />
          </div>
          <div className="input-group">
            <label htmlFor="filterSize">Talle</label>
            <input
              id="filterSize"
              value={filters.size}
              onChange={event => {
                setFilters(prev => ({ ...prev, size: event.target.value }));
                setPage(1);
              }}
              placeholder="S, M, 36..."
            />
          </div>
          <div className="input-group">
            <label htmlFor="filterColor">Color</label>
            <input
              id="filterColor"
              value={filters.color}
              onChange={event => {
                setFilters(prev => ({ ...prev, color: event.target.value }));
                setPage(1);
              }}
              placeholder="Rojo, Azul..."
            />
          </div>
        </form>

        {loading ? (
          <LoadingIndicator message="Cargando artículos..." />
        ) : (
          <div className="table-wrapper" style={{ marginTop: '1rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Descripción</th>
                  <th>Grupo</th>
                  <th>Atributos</th>
                  <th>General</th>
                  <th>Sobre. General</th>
                  <th>Sobre. Thibe</th>
                  <th>Sobre. Arenal</th>
                  {canWrite && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id}>
                    <td>{item.code}</td>
                    <td>{item.description}</td>
                    <td>{item.group?.name || 'Sin grupo'}</td>
                    <td>
                      <div className="chip-list">
                        {Object.entries(item.attributes || {}).map(([key, value]) => (
                          <span key={key} className="badge">
                            {key}: {value}
                          </span>
                        ))}
                        {Object.keys(item.attributes || {}).length === 0 && <span>-</span>}
                      </div>
                    </td>
                    <td>{item.stock?.general ?? 0}</td>
                    <td>{item.stock?.overstockGeneral ?? 0}</td>
                    <td>{item.stock?.overstockThibe ?? 0}</td>
                    <td>{item.stock?.overstockArenal ?? 0}</td>
                    {canWrite && (
                      <td>
                        <div className="inline-actions">
                          <button type="button" className="secondary-button" onClick={() => handleEdit(item)}>
                            Editar
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={canWrite ? 9 : 8} style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                      No se encontraron artículos para los filtros seleccionados.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex-between" style={{ marginTop: '1rem' }}>
          <span style={{ color: '#64748b', fontSize: '0.9rem' }}>
            Página {page} de {totalPages}
          </span>
          <div className="inline-actions">
            <button type="button" className="secondary-button" disabled={page === 1} onClick={() => setPage(prev => Math.max(1, prev - 1))}>
              Anterior
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={page === totalPages}
              onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
            >
              Siguiente
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
