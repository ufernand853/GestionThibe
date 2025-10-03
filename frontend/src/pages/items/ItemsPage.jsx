import { useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';
import { ensureQuantity, formatQuantity } from '../../utils/quantity.js';

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
  const [groupForm, setGroupForm] = useState({ name: '', parentId: '' });
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
    stockGeneralBoxes: '',
    stockGeneralUnits: '',
    overstockGeneralBoxes: '',
    overstockGeneralUnits: '',
    overstockThibeBoxes: '',
    overstockThibeUnits: '',
    overstockArenalBoxes: '',
    overstockArenalUnits: ''
  });
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [editingItem, setEditingItem] = useState(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupError, setGroupError] = useState('');

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
      stockGeneralBoxes: '',
      stockGeneralUnits: '',
      overstockGeneralBoxes: '',
      overstockGeneralUnits: '',
      overstockThibeBoxes: '',
      overstockThibeUnits: '',
      overstockArenalBoxes: '',
      overstockArenalUnits: ''
    });
    setEditingItem(null);
  };

  const handleFormChange = event => {
    const { name, value } = event.target;
    setFormValues(prev => ({ ...prev, [name]: value }));
  };

  const handleGroupFormChange = event => {
    const { name, value } = event.target;
    setGroupForm(prev => ({ ...prev, [name]: value }));
  };

  const buildPayload = () => {
    const stock = {};
    const STOCK_FIELDS = [
      {
        key: 'general',
        boxesField: 'stockGeneralBoxes',
        unitsField: 'stockGeneralUnits'
      },
      {
        key: 'overstockGeneral',
        boxesField: 'overstockGeneralBoxes',
        unitsField: 'overstockGeneralUnits'
      },
      {
        key: 'overstockThibe',
        boxesField: 'overstockThibeBoxes',
        unitsField: 'overstockThibeUnits'
      },
      {
        key: 'overstockArenal',
        boxesField: 'overstockArenalBoxes',
        unitsField: 'overstockArenalUnits'
      }
    ];

    STOCK_FIELDS.forEach(({ key, boxesField, unitsField }) => {
      const boxesValue = formValues[boxesField];
      const unitsValue = formValues[unitsField];
      if (boxesValue === '' && unitsValue === '') {
        return;
      }
      const boxes = boxesValue === '' ? 0 : Number(boxesValue);
      const units = unitsValue === '' ? 0 : Number(unitsValue);
      stock[key] = { boxes, units };
    });
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

  const handleCreateGroup = async event => {
    event.preventDefault();
    if (!canWrite || !groupForm.name.trim()) return;
    setCreatingGroup(true);
    setGroupError('');
    try {
      const payload = {
        name: groupForm.name.trim(),
        parentId: groupForm.parentId || undefined
      };
      const newGroup = await api.post('/groups', payload);
      setGroups(prev => {
        const updated = [...prev, newGroup];
        return updated.sort((a, b) => a.name.localeCompare(b.name, 'es'));
      });
      setGroupForm({ name: '', parentId: '' });
      setSuccessMessage(`Grupo ${newGroup.name} creado correctamente.`);
    } catch (err) {
      setGroupError(err);
    } finally {
      setCreatingGroup(false);
    }
  };

  const handleEdit = item => {
    setEditingItem(item);
    const general = ensureQuantity(item.stock?.general);
    const overstockGeneral = ensureQuantity(item.stock?.overstockGeneral);
    const overstockThibe = ensureQuantity(item.stock?.overstockThibe);
    const overstockArenal = ensureQuantity(item.stock?.overstockArenal);
    const normalizeField = value => (value === 0 ? '' : String(value));

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
      stockGeneralBoxes: normalizeField(general.boxes),
      stockGeneralUnits: normalizeField(general.units),
      overstockGeneralBoxes: normalizeField(overstockGeneral.boxes),
      overstockGeneralUnits: normalizeField(overstockGeneral.units),
      overstockThibeBoxes: normalizeField(overstockThibe.boxes),
      overstockThibeUnits: normalizeField(overstockThibe.units),
      overstockArenalBoxes: normalizeField(overstockArenal.boxes),
      overstockArenalUnits: normalizeField(overstockArenal.units)
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

      {canWrite && (
        <div className="section-card">
          <h2>Crear grupo</h2>
          <form className="form-grid" onSubmit={handleCreateGroup} style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
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
          <ErrorMessage error={groupError} />
        </div>
      )}

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
            <label htmlFor="stockGeneralBoxes">Stock General (Cajas)</label>
            <input
              id="stockGeneralBoxes"
              name="stockGeneralBoxes"
              type="number"
              min="0"
              value={formValues.stockGeneralBoxes}
              onChange={handleFormChange}
            />
          </div>
          <div className="input-group">
            <label htmlFor="stockGeneralUnits">Stock General (Unidades)</label>
            <input
              id="stockGeneralUnits"
              name="stockGeneralUnits"
              type="number"
              min="0"
              value={formValues.stockGeneralUnits}
              onChange={handleFormChange}
            />
          </div>
          <div className="input-group">
            <label htmlFor="overstockGeneralBoxes">Sobrestock General (Cajas)</label>
            <input
              id="overstockGeneralBoxes"
              name="overstockGeneralBoxes"
              type="number"
              min="0"
              value={formValues.overstockGeneralBoxes}
              onChange={handleFormChange}
            />
          </div>
          <div className="input-group">
            <label htmlFor="overstockGeneralUnits">Sobrestock General (Unidades)</label>
            <input
              id="overstockGeneralUnits"
              name="overstockGeneralUnits"
              type="number"
              min="0"
              value={formValues.overstockGeneralUnits}
              onChange={handleFormChange}
            />
          </div>
          <div className="input-group">
            <label htmlFor="overstockThibeBoxes">Sobrestock Thibe (Cajas)</label>
            <input
              id="overstockThibeBoxes"
              name="overstockThibeBoxes"
              type="number"
              min="0"
              value={formValues.overstockThibeBoxes}
              onChange={handleFormChange}
            />
          </div>
          <div className="input-group">
            <label htmlFor="overstockThibeUnits">Sobrestock Thibe (Unidades)</label>
            <input
              id="overstockThibeUnits"
              name="overstockThibeUnits"
              type="number"
              min="0"
              value={formValues.overstockThibeUnits}
              onChange={handleFormChange}
            />
          </div>
          <div className="input-group">
            <label htmlFor="overstockArenalBoxes">Sobrestock Arenal (Cajas)</label>
            <input
              id="overstockArenalBoxes"
              name="overstockArenalBoxes"
              type="number"
              min="0"
              value={formValues.overstockArenalBoxes}
              onChange={handleFormChange}
            />
          </div>
          <div className="input-group">
            <label htmlFor="overstockArenalUnits">Sobrestock Arenal (Unidades)</label>
            <input
              id="overstockArenalUnits"
              name="overstockArenalUnits"
              type="number"
              min="0"
              value={formValues.overstockArenalUnits}
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
                    <td>{formatQuantity(item.stock?.general)}</td>
                    <td>{formatQuantity(item.stock?.overstockGeneral)}</td>
                    <td>{formatQuantity(item.stock?.overstockThibe)}</td>
                    <td>{formatQuantity(item.stock?.overstockArenal)}</td>
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
