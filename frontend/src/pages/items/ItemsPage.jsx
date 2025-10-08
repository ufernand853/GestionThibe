import { useCallback, useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';
import { ensureQuantity, formatQuantity } from '../../utils/quantity.js';
import { API_ROOT_URL } from '../../utils/apiConfig.js';

const ATTRIBUTES = ['gender', 'size', 'color', 'material', 'season', 'fit'];

const MAX_IMAGES = 5;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('El archivo no pudo convertirse a una URL base64.'));
      }
    };
    reader.onerror = () => {
      reject(reader.error || new Error('No se pudo leer el archivo.'));
    };
    reader.readAsDataURL(file);
  });
}

const STOCK_LOCATIONS = [
  {
    key: 'general',
    title: 'Stock general',
    helper: 'Inventario disponible para la operación habitual.',
    boxesField: 'stockGeneralBoxes',
    unitsField: 'stockGeneralUnits',
    labels: {
      boxes: 'Cajas',
      units: 'Unidades'
    }
  },
  {
    key: 'overstockGeneral',
    title: 'Sobrestock general',
    helper: 'Excedente disponible para reponer otras listas.',
    boxesField: 'overstockGeneralBoxes',
    unitsField: 'overstockGeneralUnits',
    labels: {
      boxes: 'Cajas',
      units: 'Unidades'
    }
  },
  {
    key: 'overstockThibe',
    title: 'Sobrestock Thibe',
    helper: 'Mercadería reservada para la sucursal Thibe.',
    boxesField: 'overstockThibeBoxes',
    unitsField: 'overstockThibeUnits',
    labels: {
      boxes: 'Cajas',
      units: 'Unidades'
    }
  },
  {
    key: 'overstockArenal',
    title: 'Sobrestock Arenal',
    helper: 'Stock extra asignado a Arenal.',
    boxesField: 'overstockArenalBoxes',
    unitsField: 'overstockArenalUnits',
    labels: {
      boxes: 'Cajas',
      units: 'Unidades'
    }
  }
];

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
  const [imageFiles, setImageFiles] = useState([]);
  const [existingImages, setExistingImages] = useState([]);
  const [imageError, setImageError] = useState('');
  const [editingItem, setEditingItem] = useState(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupError, setGroupError] = useState('');

  const clearNewImages = useCallback(() => {
    setImageFiles([]);
  }, []);

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
    clearNewImages();
    setExistingImages([]);
    setImageError('');
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

    STOCK_LOCATIONS.forEach(({ key, boxesField, unitsField }) => {
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
      stock,
      images: [...existingImages, ...imageFiles.map(image => image.dataUrl)].filter(Boolean)
    };
  };

  const handleImageSelect = async event => {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) {
      return;
    }
    let message = '';
    const currentTotal = existingImages.length + imageFiles.length;
    const availableSlots = MAX_IMAGES - currentTotal;
    if (availableSlots <= 0) {
      message = `Solo se permiten hasta ${MAX_IMAGES} imágenes por artículo.`;
    } else {
      const limitedFiles = files.slice(0, availableSlots);
      let rejectedBySize = false;
      const validFiles = limitedFiles.filter(file => {
        if (file.size > MAX_IMAGE_SIZE) {
          rejectedBySize = true;
          return false;
        }
        return true;
      });
      if (validFiles.length > 0) {
        try {
          const dataUrls = await Promise.all(validFiles.map(file => fileToDataUrl(file)));
          setImageFiles(prev => [
            ...prev,
            ...dataUrls.map((dataUrl, index) => ({
              dataUrl,
              name: validFiles[index].name,
              size: validFiles[index].size
            }))
          ]);
        } catch (error) {
          console.error('No se pudieron procesar las imágenes seleccionadas', error);
          message = 'Ocurrió un error al procesar las imágenes seleccionadas.';
        }
      }
      if (!message) {
        if (files.length > availableSlots) {
          message = `Solo se permiten hasta ${MAX_IMAGES} imágenes por artículo.`;
        } else if (rejectedBySize) {
          message = 'Algunas imágenes superan el tamaño máximo de 5 MB y fueron descartadas.';
        }
        if (validFiles.length === 0 && rejectedBySize) {
          message = 'Las imágenes deben pesar menos de 5 MB.';
        }
      }
    }
    if (message) {
      setImageError(message);
    } else {
      setImageError('');
    }
    event.target.value = '';
  };

  const handleRemoveExistingImage = imagePath => {
    setExistingImages(prev => prev.filter(path => path !== imagePath));
    setImageError('');
  };

  const handleRemoveNewImage = index => {
    setImageFiles(prev => {
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
    setImageError('');
  };

  const getImageUrl = path => {
    if (!path) {
      return '';
    }
    if (/^data:image\//i.test(path) || /^https?:\/\//i.test(path)) {
      return path;
    }
    return `${API_ROOT_URL}/${path.replace(/^\/+/, '')}`;
  };

  const handleSubmit = async event => {
    event.preventDefault();
    if (!canWrite) return;
    setSaving(true);
    setError(null);
    setImageError('');
    try {
      const payload = buildPayload();
      if (!editingItem) {
        payload.code = formValues.code;
      }
      if (editingItem) {
        await api.put(`/items/${editingItem.id}`, payload);
        setSuccessMessage(`Artículo ${editingItem.code} actualizado correctamente.`);
      } else {
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
    clearNewImages();
    setEditingItem(item);
    setExistingImages(Array.isArray(item.images) ? item.images : []);
    setImageError('');
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
        <form className="item-form" onSubmit={handleSubmit}>
          <section className="form-section">
            <div className="form-section__header">
              <div>
                <h3>Datos del artículo</h3>
                <p className="form-section__description">
                  Define la información general y los atributos que describen al artículo.
                </p>
              </div>
              {editingItem && <span className="badge">Editando {editingItem.code}</span>}
            </div>
            <div className="form-grid form-grid--spaced">
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
            </div>
          </section>

          <section className="form-section">
            <div className="form-section__header">
              <div>
                <h3>Imágenes del artículo</h3>
                <p className="form-section__description">
                  Adjunta fotografías para identificar el artículo visualmente.
                </p>
              </div>
            </div>
            <div className="form-grid form-grid--spaced">
              <div className="input-group">
                <label htmlFor="itemImages">Subir imágenes</label>
                <input
                  id="itemImages"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  onChange={handleImageSelect}
                />
                <p className="input-helper">Puedes seleccionar hasta 10 imágenes, máximo 5 MB cada una.</p>
              </div>
            </div>
            <ErrorMessage error={imageError} />
            {(existingImages.length > 0 || imageFiles.length > 0) && (
              <div className="image-preview-wrapper">
                {existingImages.length > 0 && (
                  <div className="image-preview-group">
                    <h4>Imágenes actuales</h4>
                    <div className="image-preview-grid">
                      {existingImages.map(image => (
                        <div key={image} className="image-preview-item">
                          <img src={getImageUrl(image)} alt="Imagen del artículo" />
                          <button type="button" className="secondary-button" onClick={() => handleRemoveExistingImage(image)}>
                            Quitar
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {imageFiles.length > 0 && (
                  <div className="image-preview-group">
                    <h4>Nuevas imágenes</h4>
                    <div className="image-preview-grid">
                      {imageFiles.map((image, index) => (
                        <div key={image.dataUrl || index} className="image-preview-item">
                          <img src={image.dataUrl} alt={image.name || `Nueva imagen ${index + 1}`} />
                          <button type="button" className="secondary-button" onClick={() => handleRemoveNewImage(index)}>
                            Quitar
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="form-section">
            <div className="form-section__header">
              <div>
                <h3>Stock por lista</h3>
                <p className="form-section__description">
                  Registra las cantidades disponibles por depósito o canal para facilitar la reposición.
                </p>
              </div>
            </div>
            <div className="stock-grid">
              {STOCK_LOCATIONS.map(location => (
                <div key={location.key} className="stock-card">
                  <div className="stock-card__header">
                    <h4>{location.title}</h4>
                    {location.helper && <p>{location.helper}</p>}
                  </div>
                  <div className="form-grid form-grid--dense">
                    <div className="input-group">
                      <label htmlFor={location.boxesField}>{location.labels.boxes}</label>
                      <input
                        id={location.boxesField}
                        name={location.boxesField}
                        type="number"
                        min="0"
                        value={formValues[location.boxesField]}
                        onChange={handleFormChange}
                      />
                    </div>
                    <div className="input-group">
                      <label htmlFor={location.unitsField}>{location.labels.units}</label>
                      <input
                        id={location.unitsField}
                        name={location.unitsField}
                        type="number"
                        min="0"
                        value={formValues[location.unitsField]}
                        onChange={handleFormChange}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="section-hint">
              <strong>Otras opciones para organizar el formulario:</strong>
              <ul>
                <li>Dividir la edición en pestañas para alternar rápidamente entre atributos y stock.</li>
                <li>Agregar un panel lateral con un resumen de stock consolidado por depósito.</li>
                <li>Permitir duplicar los datos desde un artículo existente como plantilla inicial.</li>
              </ul>
            </div>
          </section>

          <div className="form-section form-section--actions">
            <div className="inline-actions">
              <button type="submit" disabled={saving || !canWrite}>
                {editingItem ? 'Actualizar artículo' : 'Crear artículo'}
              </button>
              {editingItem && (
                <button type="button" className="secondary-button" onClick={resetForm}>
                  Cancelar
                </button>
              )}
            </div>
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
                  <th>Imágenes</th>
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
                    <td>{Array.isArray(item.images) ? item.images.length : 0}</td>
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
                    <td colSpan={canWrite ? 10 : 9} style={{ textAlign: 'center', padding: '1.5rem 0' }}>
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
