import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';
import { formatQuantity } from '../../utils/quantity.js';
import { API_ROOT_URL } from '../../utils/apiConfig.js';

const resolveImageUrl = value => {
  if (!value) return '';
  if (/^data:image\//i.test(value) || /^https?:\/\//i.test(value)) return value;
  return `${API_ROOT_URL}/${String(value).replace(/^\/+/, '')}`;
};

const formatPrice = value => {
  if (value === null || value === undefined || value === '') return '-';
  return `$${Number(value).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export default function OverstockPage() {
  const api = useApi();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canWrite = Array.isArray(user?.permissions) && user.permissions.includes('items.write');
  const [items, setItems] = useState([]);
  const [overstockGroups, setOverstockGroups] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [filters, setFilters] = useState({ search: '', groupId: '' });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [gallery, setGallery] = useState(null);
  const [imageError, setImageError] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/items/overstock', {
        query: { page, pageSize, search: filters.search, groupId: filters.groupId }
      });
      setItems(Array.isArray(response?.items) ? response.items : []);
      setTotal(Number(response?.total) || 0);
      setOverstockGroups(Array.isArray(response?.groups) ? response.groups : []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [api, filters.groupId, filters.search, page, pageSize]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const openImages = item => {
    const images = (Array.isArray(item.images) ? item.images : [])
      .map((image, index) => ({
        src: resolveImageUrl(image),
        alt: `${item.code} · imagen ${index + 1}`,
        key: `${item.id}-${index}-${image}`
      }))
      .filter(image => image.src);
    if (images.length === 0) return;
    setImageError('');
    setGallery({ itemId: item.id, itemCode: item.code, images, index: 0 });
  };

  const closeImages = () => {
    setGallery(null);
    setImageError('');
  };

  const stepImage = direction => {
    setImageError('');
    setGallery(current => {
      if (!current || current.images.length < 2) return current;
      return { ...current, index: (current.index + direction + current.images.length) % current.images.length };
    });
  };

  const selectedImage = useMemo(() => gallery?.images?.[gallery.index] || null, [gallery]);

  const handleEdit = item => {
    if (!canWrite) return;
    navigate('/items', { state: { editItem: item } });
  };

  const handleDelete = async item => {
    if (!canWrite || !item) return;
    const confirmed = window.confirm(
      `¿Enviar el artículo ${item.code} a la papelera? Podrá restaurarse durante 30 días.`
    );
    if (!confirmed) return;
    setDeletingId(item.id);
    setError(null);
    setSuccessMessage('');
    try {
      await api.delete(`/items/${item.id}`);
      setSuccessMessage(`Artículo ${item.code} enviado a la papelera.`);
      if (items.length === 1 && page > 1) {
        setPage(current => Math.max(1, current - 1));
      } else {
        await loadItems();
      }
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
          <h2>Sobrestock</h2>
          <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
            Artículos con stock positivo pertenecientes a grupos de sobrestock.
          </p>
        </div>
        <span className="badge">Total: {total}</span>
      </div>

      {error && <ErrorMessage error={error} />}
      {successMessage && <div className="success-message">{successMessage}</div>}

      {gallery && selectedImage && (
        <div className="image-lightbox" onClick={closeImages} role="dialog" aria-modal="true" aria-label={`Imágenes de ${gallery.itemCode}`}>
          <div className="image-lightbox__content" onClick={event => event.stopPropagation()}>
            {imageError ? <ErrorMessage error={imageError} /> : (
              <img key={selectedImage.key} src={selectedImage.src} alt={selectedImage.alt} onError={() => setImageError('No se pudo cargar esta imagen.')} />
            )}
            <div className="image-lightbox__actions">
              <button type="button" className="secondary-button" onClick={() => stepImage(-1)} disabled={gallery.images.length <= 1}>Anterior</button>
              <span>{gallery.index + 1} de {gallery.images.length}</span>
              <button type="button" className="secondary-button" onClick={() => stepImage(1)} disabled={gallery.images.length <= 1}>Siguiente</button>
              <button type="button" onClick={closeImages}>Cerrar</button>
            </div>
          </div>
        </div>
      )}

      <div className="section-card">
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div className="input-group">
            <label htmlFor="overstockSearch">Buscar</label>
            <input id="overstockSearch" type="search" value={filters.search} placeholder="Código o descripción" onChange={event => { setFilters(prev => ({ ...prev, search: event.target.value })); setPage(1); }} />
          </div>
          <div className="input-group">
            <label htmlFor="overstockGroup">Grupo</label>
            <select
              id="overstockGroup"
              value={filters.groupId}
              onChange={event => { setFilters(prev => ({ ...prev, groupId: event.target.value })); setPage(1); }}
            >
              <option value="">Todos los grupos de sobrestock</option>
              {overstockGroups.map(group => (
                <option key={group.id} value={group.id}>{group.name}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? <LoadingIndicator message="Cargando artículos en sobrestock..." /> : (
          <div className="table-wrapper" style={{ marginTop: '1rem' }}>
            <table>
              <thead><tr><th>Código</th><th>Descripción</th><th>Grupo</th><th>Precio</th><th>Atributos</th><th>Imágenes</th><th>Ubicaciones</th><th>Total</th>{canWrite && <th>Acciones</th>}</tr></thead>
              <tbody>
                {items.map(item => (
                  <tr key={item.id}>
                    <td>{item.code}</td><td>{item.description}</td><td>{item.group?.name || 'Sin grupo'}</td>
                    <td><div className="price-display"><span>{formatPrice(item.precio ?? item.pDecimal)}</span>
                      {Array.isArray(item.priceTiers) && item.priceTiers.length > 0 && <div className="chip-list">{item.priceTiers.map(tier => <span className="badge" key={tier.minQuantity}>x{tier.minQuantity} · {formatPrice(tier.price)}</span>)}</div>}
                    </div></td>
                    <td><div className="chip-list">{Object.entries(item.attributes || {}).map(([key, value]) => <span className="badge" key={key}>{key}: {value}</span>)}{Object.keys(item.attributes || {}).length === 0 && <span>-</span>}</div></td>
                    <td>{Array.isArray(item.images) && item.images.length > 0 ? <button type="button" className="secondary-button" onClick={() => openImages(item)}>Ver imágenes ({item.images.length})</button> : '-'}</td>
                    <td><div className="chip-list">{Object.entries(item.stockByLocation || {}).map(([locationId, quantity]) => <span className="badge" key={locationId}>{quantity.locationName} · {formatQuantity(quantity, { compact: true })}</span>)}</div></td>
                    <td>{formatQuantity(item.stockTotal)}</td>
                    {canWrite && (
                      <td>
                        <div className="inline-actions">
                          <button type="button" className="secondary-button" onClick={() => handleEdit(item)}>Editar</button>
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
                ))}
                {items.length === 0 && <tr><td colSpan={canWrite ? 9 : 8} style={{ textAlign: 'center', padding: '1.5rem 0' }}>No hay artículos con stock positivo en los grupos de sobrestock seleccionados.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex-between" style={{ marginTop: '1rem' }}>
          <span style={{ color: '#64748b', fontSize: '0.9rem' }}>Página {page} de {totalPages}</span>
          <div className="inline-actions">
            <button type="button" className="secondary-button" disabled={page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))}>Anterior</button>
            <button type="button" className="secondary-button" disabled={page >= totalPages} onClick={() => setPage(current => Math.min(totalPages, current + 1))}>Siguiente</button>
          </div>
        </div>
      </div>
    </div>
  );
}
