import { useCallback, useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';
import { ensureQuantity, formatQuantity } from '../../utils/quantity.js';
import StockStatusBadge from '../../components/StockStatusBadge.jsx';
import { aggregatePendingByItem, computeTotalStockFromMap, deriveStockStatus } from '../../utils/stockStatus.js';
import { API_ROOT_URL } from '../../utils/apiConfig.js';

const ATTRIBUTE_FIELDS = [
  {
    key: 'gender',
    label: 'Género',
    type: 'select',
    placeholder: 'Seleccione género',
    options: [
      { value: 'Dama', label: 'Dama' },
      { value: 'Caballero', label: 'Caballero' },
      { value: 'Niño/a', label: 'Niño/a' },
      { value: 'Unisex', label: 'Unisex' }
    ]
  },
  {
    key: 'size',
    label: 'Talle',
    placeholder: 'Ingrese el talle'
  },
  {
    key: 'color',
    label: 'Color',
    placeholder: 'Ingrese el color'
  },
  {
    key: 'material',
    label: 'Material',
    placeholder: 'Ingrese el material'
  },
  {
    key: 'season',
    label: 'Temporada',
    type: 'select',
    placeholder: 'Selecciona la temporada',
    options: [
      { value: 'Primavera', label: 'Primavera' },
      { value: 'Verano', label: 'Verano' },
      { value: 'Invierno', label: 'Invierno' },
      { value: 'Otoño', label: 'Otoño' }
    ]
  },
  // otros atributos adicionales pueden configurarse agregando nuevas entradas aquí
];

const ATTRIBUTE_KEYS = ATTRIBUTE_FIELDS.map(field => field.key);

const MAX_IMAGES = 5;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const GENDER_FILTER_OPTIONS = ['Caballero', 'Dama', 'Niños', 'Unisex'];
const COLOR_FILTER_OPTIONS = [
  'Arena',
  'Azul cielo',
  'Azul marino',
  'Azul oscuro',
  'Azul índigo',
  'Blanco',
  'Bordó',
  'Celeste',
  'Estampado floral',
  'Gris',
  'Gris vigoré',
  'Gris/Coral',
  'Lila',
  'Marrón',
  'Multicolor',
  'Negro',
  'Negro y nude',
  'Surtido',
  'Verde jade'
];
const SIZE_FILTER_OPTIONS = [
  '180x30 cm',
  '2 plazas',
  '24-34',
  '30-44',
  '35-45',
  '35L',
  '36-44',
  '36-45',
  '38-48',
  '4-16',
  '6-14',
  '6-16',
  '90-110',
  'Mediana',
  'Queen',
  'S-L',
  'S-XL',
  'S-XXL',
  'Único'
];

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

export default function ItemsPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const canWrite = permissions.includes('items.write');
  const canViewRequests = permissions.includes('stock.request') || permissions.includes('stock.approve');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [groups, setGroups] = useState([]);
  const [locations, setLocations] = useState([]);
  const [pendingSnapshot, setPendingSnapshot] = useState([]);
  const [filters, setFilters] = useState({ search: '', groupId: '', gender: '', size: '', color: '' });
  const [formValues, setFormValues] = useState({
    code: '',
    description: '',
    groupId: '',
    needsRecount: false,
    pDecimal: '',
    gender: '',
    size: '',
    color: '',
    material: '',
    season: '',
    stockByLocation: {}
  });
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [imageFiles, setImageFiles] = useState([]);
  const [existingImages, setExistingImages] = useState([]);
  const [imageError, setImageError] = useState('');
  const [editingItem, setEditingItem] = useState(null);

  const getGroupId = useCallback(group => {
    const rawId = group?.id ?? group?._id;
    if (!rawId) return '';
    return typeof rawId === 'string' ? rawId : String(rawId);
  }, []);

  const sortGroupsByName = useCallback(
    list => [...list].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })),
    []
  );

  const clearNewImages = useCallback(() => {
    setImageFiles([]);
  }, []);

  useEffect(() => {
    let active = true;
    const loadMetadata = async () => {
      try {
        const [groupsResponse, locationsResponse] = await Promise.all([
          api.get('/groups'),
          api.get('/locations')
        ]);
        if (!active) return;
        setGroups(Array.isArray(groupsResponse) ? sortGroupsByName(groupsResponse) : []);
        setLocations(
          Array.isArray(locationsResponse)
            ? [...locationsResponse]
                .filter(location => location.type === 'warehouse')
                .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
            : []
        );
      } catch (err) {
        console.warn('No se pudieron cargar grupos o ubicaciones', err);
      }
    };
    loadMetadata();
    return () => {
      active = false;
    };
  }, [api, sortGroupsByName]);

  useEffect(() => {
    let active = true;
    if (!canViewRequests) {
      setPendingSnapshot([]);
      return () => {
        active = false;
      };
    }
    const loadPending = async () => {
      try {
        const response = await api.get('/stock/requests', { query: { status: 'pending' } });
        if (!active) return;
        setPendingSnapshot(Array.isArray(response) ? response : []);
      } catch (err) {
        if (!active) return;
        console.warn('No se pudieron cargar solicitudes pendientes', err);
        setPendingSnapshot([]);
      }
    };
    loadPending();
    return () => {
      active = false;
    };
  }, [api, canViewRequests]);

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

  const pendingMap = useMemo(() => aggregatePendingByItem(pendingSnapshot), [pendingSnapshot]);

  const itemTotals = useMemo(() => {
    const map = new Map();
    (Array.isArray(items) ? items : []).forEach(item => {
      map.set(item.id, computeTotalStockFromMap(item.stock));
    });
    return map;
  }, [items]);

  const itemStatusMap = useMemo(() => {
    const map = new Map();
    itemTotals.forEach((total, itemId) => {
      const pendingInfo = pendingMap.get(itemId);
      map.set(itemId, deriveStockStatus(total, pendingInfo));
    });
    return map;
  }, [itemTotals, pendingMap]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const resetForm = () => {
    setFormValues({
      code: '',
      description: '',
      groupId: '',
      needsRecount: false,
      pDecimal: '',
      gender: '',
      size: '',
      color: '',
      material: '',
      season: '',
      stockByLocation: {}
    });
    clearNewImages();
    setExistingImages([]);
    setImageError('');
    setEditingItem(null);
  };

  const handleFormChange = event => {
    const { name, type, checked, value } = event.target;
    const nextValue = type === 'checkbox' ? checked : value;
    setFormValues(prev => ({ ...prev, [name]: nextValue }));
  };

  const handleStockByLocationChange = (locationId, field, rawValue) => {
    let value = rawValue;
    if (value !== '') {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < 0) {
        return;
      }
      value = String(Math.trunc(numeric));
    }
    setFormValues(prev => {
      const current = prev.stockByLocation || {};
      const existing = current[locationId] || { boxes: '', units: '' };
      return {
        ...prev,
        stockByLocation: {
          ...current,
          [locationId]: { ...existing, [field]: value }
        }
      };
    });
  };

  const buildPayload = () => {
    const stock = {};
    const previousStockRaw = editingItem?.stock;
    const previousStock =
      previousStockRaw instanceof Map ? Object.fromEntries(previousStockRaw.entries()) : previousStockRaw || {};
    const processedLocations = new Set();

    Object.entries(formValues.stockByLocation || {}).forEach(([locationId, values]) => {
      processedLocations.add(locationId);
      const boxesValue = values?.boxes ?? '';
      const unitsValue = values?.units ?? '';
      if (boxesValue === '' && unitsValue === '') {
        if (editingItem && previousStock && Object.prototype.hasOwnProperty.call(previousStock, locationId)) {
          stock[locationId] = null;
        }
        return;
      }
      const boxes = boxesValue === '' ? 0 : Number(boxesValue);
      const units = unitsValue === '' ? 0 : Number(unitsValue);
      if (!Number.isFinite(boxes) || boxes < 0 || !Number.isFinite(units) || units < 0) {
        return;
      }
      stock[locationId] = { boxes, units };
    });

    if (editingItem && previousStock) {
      Object.keys(previousStock).forEach(locationId => {
        if (!processedLocations.has(locationId) && !stock[locationId]) {
          stock[locationId] = null;
        }
      });
    }
    const attributes = {};
    ATTRIBUTE_KEYS.forEach(attribute => {
      const value = formValues[attribute];
      if (value) {
        attributes[attribute] = value;
      } else if (editingItem) {
        attributes[attribute] = null;
      }
    });
    const payload = {
      description: formValues.description,
      groupId: formValues.groupId || null,
      needsRecount: Boolean(formValues.needsRecount),
      attributes: Object.keys(attributes).length ? attributes : undefined,
      stock,
      images: [...existingImages, ...imageFiles.map(image => image.dataUrl)].filter(Boolean)
    };
    const pDecimalValue = typeof formValues.pDecimal === 'string' ? formValues.pDecimal.trim() : '';
    if (pDecimalValue) {
      payload.pDecimal = pDecimalValue;
    } else if (editingItem) {
      payload.pDecimal = null;
    }
    return payload;
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

  const handleEdit = item => {
    clearNewImages();
    setEditingItem(item);
    setExistingImages(Array.isArray(item.images) ? item.images : []);
    setImageError('');
    const normalizeField = value => (value === 0 ? '' : String(value));
    const stockByLocation = {};
    Object.entries(item.stock || {}).forEach(([locationId, quantity]) => {
      const normalized = ensureQuantity(quantity);
      stockByLocation[locationId] = {
        boxes: normalizeField(normalized.boxes),
        units: normalizeField(normalized.units)
      };
    });

    setFormValues({
      code: item.code,
      description: item.description,
      groupId: item.groupId || '',
      needsRecount: Boolean(item.needsRecount),
      pDecimal: item.pDecimal === null || item.pDecimal === undefined ? '' : String(item.pDecimal),
      gender: item.attributes?.gender || '',
      size: item.attributes?.size || '',
      color: item.attributes?.color || '',
      material: item.attributes?.material || '',
      season: item.attributes?.season || '',
      stockByLocation
    });
  };

  const handleDelete = async item => {
    if (!item) return;
    const confirmed = window.confirm(
      `¿Seguro que deseas eliminar el artículo ${item.code}? Esta acción no se puede deshacer.`
    );
    if (!confirmed) {
      return;
    }

    setDeletingId(item.id);
    setError(null);
    setSuccessMessage('');

    try {
      await api.delete(`/items/${item.id}`);

      if (editingItem?.id === item.id) {
        resetForm();
      }

      setSuccessMessage(`Artículo ${item.code} eliminado correctamente.`);

      let nextPage = page;
      let response = await api.get('/items', {
        query: { ...filters, page: nextPage, pageSize }
      });

      let nextItems = response.items || [];
      let nextTotal = response.total || 0;

      if (nextItems.length === 0 && nextPage > 1) {
        nextPage = nextPage - 1;
        response = await api.get('/items', {
          query: { ...filters, page: nextPage, pageSize }
        });
        nextItems = response.items || [];
        nextTotal = response.total || 0;
        setPage(nextPage);
      }

      setItems(nextItems);
      setTotal(nextTotal);
    } catch (err) {
      setError(err);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <div className="flex-between">
        <div>
          <h2>Gestión de artículos</h2>
          <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
            Administre la taxonomía, atributos y stock distribuido por ubicación para cada artículo.
          </p>
        </div>
        <div>
          <span className="badge">Total: {total}</span>
        </div>
      </div>

      {error && <ErrorMessage error={error} />}
      {successMessage && <div className="success-message">{successMessage}</div>}

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
                  {groups.map(group => {
                    const id = getGroupId(group);
                    return (
                      <option key={id || group.name} value={id}>
                        {group.name}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div className="input-group">
                <label htmlFor="pDecimal">P Decimal</label>
                <input
                  id="pDecimal"
                  name="pDecimal"
                  type="number"
                  step="0.01"
                  value={formValues.pDecimal}
                  onChange={handleFormChange}
                  placeholder="Valor decimal"
                />
              </div>
              <div className="input-group">
                <label htmlFor="needsRecount">Recuento manual</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <input
                    id="needsRecount"
                    name="needsRecount"
                    type="checkbox"
                    checked={Boolean(formValues.needsRecount)}
                    onChange={handleFormChange}
                    disabled={!canWrite}
                  />
                  <span>Marcar artículo para recuento</span>
                </div>
                <p className="input-helper">
                  Los artículos marcados aparecerán priorizados en el tablero hasta que se actualice su stock.
                </p>
              </div>
              {ATTRIBUTE_FIELDS.map(({ key, label, placeholder, type, options = [] }) => {
                const selectedValue = formValues[key];
                const hasSelectedOption = options.some(option => option.value === selectedValue);
                return (
                  <div className="input-group" key={key}>
                    <label htmlFor={key}>{label}</label>
                    {type === 'select' ? (
                      <select id={key} name={key} value={selectedValue} onChange={handleFormChange}>
                        <option value="">{placeholder || 'Sin especificar'}</option>
                        {options.map(option => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                        {!hasSelectedOption && selectedValue && (
                          <option value={selectedValue}>{selectedValue}</option>
                        )}
                      </select>
                    ) : (
                      <input
                        id={key}
                        name={key}
                        value={selectedValue}
                        onChange={handleFormChange}
                        placeholder={placeholder}
                      />
                    )}
                  </div>
                );
              })}
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
                <h3>Stock por ubicación</h3>
                <p className="form-section__description">
                  Registra las cantidades disponibles en cada depósito interno (opcional). También podés dejar todo en cero y
                  cargar los movimientos desde la bandeja de transferencias.
                </p>
              </div>
            </div>
            {locations.length === 0 ? (
              <p style={{ color: '#64748b' }}>
                Aún no hay ubicaciones internas configuradas. Creá al menos una desde la sección Ubicaciones para distribuir
                stock inicial.
              </p>
            ) : (
              <div className="stock-grid">
                {locations.map(location => {
                  const entry = formValues.stockByLocation?.[location.id] || { boxes: '', units: '' };
                  return (
                    <div key={location.id} className="stock-card">
                      <div className="stock-card__header">
                        <h4>{location.name}</h4>
                        {location.description && <p>{location.description}</p>}
                      </div>
                      <div className="form-grid form-grid--dense">
                        <div className="input-group">
                          <label htmlFor={`stock-${location.id}-boxes`}>Cajas</label>
                          <input
                            id={`stock-${location.id}-boxes`}
                            type="number"
                            min="0"
                            value={entry.boxes}
                            onChange={event => handleStockByLocationChange(location.id, 'boxes', event.target.value)}
                          />
                        </div>
                        <div className="input-group">
                          <label htmlFor={`stock-${location.id}-units`}>Unidades</label>
                          <input
                            id={`stock-${location.id}-units`}
                            type="number"
                            min="0"
                            value={entry.units}
                            onChange={event => handleStockByLocationChange(location.id, 'units', event.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
              {groups.map(group => {
                const id = getGroupId(group);
                return (
                  <option key={id || group.name} value={id}>
                    {group.name}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="filterGender">Género</label>
            <select
              id="filterGender"
              value={filters.gender}
              onChange={event => {
                setFilters(prev => ({ ...prev, gender: event.target.value }));
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {GENDER_FILTER_OPTIONS.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="filterSize">Talle</label>
            <select
              id="filterSize"
              value={filters.size}
              onChange={event => {
                setFilters(prev => ({ ...prev, size: event.target.value }));
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {SIZE_FILTER_OPTIONS.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="filterColor">Color</label>
            <select
              id="filterColor"
              value={filters.color}
              onChange={event => {
                setFilters(prev => ({ ...prev, color: event.target.value }));
                setPage(1);
              }}
            >
              <option value="">Todos</option>
              {COLOR_FILTER_OPTIONS.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
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
                  <th>P Decimal</th>
                  <th>Atributos</th>
                  <th>Imágenes</th>
                  <th>Ubicaciones</th>
                  <th>Total</th>
                  <th>Recuento</th>
                  <th>Disponibilidad</th>
                  {canWrite && <th>Acciones</th>}
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const totalQuantity = itemTotals.get(item.id) || { boxes: 0, units: 0 };
                  const stockStatus = itemStatusMap.get(item.id);
                  return (
                    <tr key={item.id}>
                    <td>{item.code}</td>
                    <td>{item.description}</td>
                    <td>{item.group?.name || 'Sin grupo'}</td>
                    <td>
                      {item.pDecimal === null || item.pDecimal === undefined
                        ? '-'
                        : Number(item.pDecimal).toLocaleString('es-AR', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2
                          })}
                    </td>
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
                    <td>
                      <div className="chip-list">
                        {Object.entries(item.stock || {}).map(([locationId, quantity]) => (
                          <span key={locationId} className="badge">
                            {locations.find(location => location.id === locationId)?.name || 'Ubicación'} ·
                            {formatQuantity(quantity, { compact: true })}
                          </span>
                        ))}
                        {(!item.stock || Object.keys(item.stock).length === 0) && <span>-</span>}
                      </div>
                    </td>
                    <td>{formatQuantity(totalQuantity)}</td>
                    <td>
                      {item.needsRecount ? (
                        <span className="badge" style={{ backgroundColor: '#f97316', color: '#fff' }}>
                          Reconteo pendiente
                        </span>
                      ) : (
                        <span style={{ color: '#64748b', fontSize: '0.85rem' }}>Al día</span>
                      )}
                    </td>
                    <td>
                      {stockStatus ? (
                        <div className="stock-status-cell">
                          <StockStatusBadge status={stockStatus} />
                          {stockStatus.pendingCount > 0 && (
                            <span className="stock-status-note">
                              {stockStatus.pendingCount === 1
                                ? '1 solicitud pendiente'
                                : `${stockStatus.pendingCount} solicitudes pendientes`}
                            </span>
                          )}
                        </div>
                      ) : (
                        '-'
                      )}
                    </td>
                    {canWrite && (
                      <td>
                        <div className="inline-actions">
                          <button type="button" className="secondary-button" onClick={() => handleEdit(item)}>
                            Editar
                          </button>
                          <button
                            type="button"
                            className="danger-button"
                            onClick={() => handleDelete(item)}
                            disabled={deletingId === item.id}
                          >
                            {deletingId === item.id ? 'Eliminando…' : 'Eliminar'}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
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
