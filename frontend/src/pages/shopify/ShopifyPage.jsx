import { useCallback, useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';
import { API_ROOT_URL } from '../../utils/apiConfig.js';

const STATUS_LABELS = { draft: 'Borrador', active: 'Activo', archived: 'Archivado', deleted: 'Eliminado' };

function getUpdatedInventoryLocations(results = []) {
  return results.reduce((total, result) => total + (Number(result?.inventorySync?.updated) || 0), 0);
}

function formatDate(value) {
  if (!value) return 'Sin sincronizar';
  return new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
}

function formatMoney(value) {
  if (value === null || value === undefined || value === '') return '-';
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(value) || 0);
}

function formatLocationQuantity(location) {
  const parts = [];
  if (location.boxes > 0) parts.push(`${location.boxes} caja(s)`);
  if (location.units > 0) parts.push(`${location.units} unidad(es)`);
  return parts.length > 0 ? parts.join(', ') : 'sin stock';
}

function getCurrentLocations(item) {
  const locations = Array.isArray(item?.payload?.stockByLocation) ? item.payload.stockByLocation : [];
  return locations.filter(location => (Number(location.boxes) || 0) > 0 || (Number(location.units) || 0) > 0);
}

function getImageUrl(path) {
  if (!path) return '';
  if (/^data:image\//i.test(path) || /^https?:\/\//i.test(path)) return path;
  return `${API_ROOT_URL}/${String(path).replace(/^\/+/, '')}`;
}

function getShopifyImageSummary(item) {
  const images = Array.isArray(item?.payload?.images) ? item.payload.images : [];
  const media = Array.isArray(item?.payload?.media) ? item.payload.media : [];
  return {
    images,
    media,
    previewImages: images.slice(0, 3).map((image, index) => ({
      src: getImageUrl(image),
      alt: `${item.code || item.sku || 'Artículo'} · imagen ${index + 1}`,
      key: `${item.id}-${index}-${image}`
    }))
  };
}

export default function ShopifyPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const canWrite = permissions.includes('items.write');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [filters, setFilters] = useState({ search: '', status: '' });
  const [selectedIds, setSelectedIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');
  const [shopifyConfig, setShopifyConfig] = useState(null);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allVisibleSelected = items.length > 0 && items.every(item => selectedSet.has(item.id));

  const fetchItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (filters.search.trim()) params.set('search', filters.search.trim());
      if (filters.status) params.set('status', filters.status);
      const data = await api.get(`/shopify/products?${params.toString()}`);
      setItems(data.items || []);
      setTotal(data.total || 0);
      setShopifyConfig(data.config || null);
    } catch (err) {
      setError(err.message || 'No se pudo cargar Shopify.');
    } finally {
      setLoading(false);
    }
  }, [api, filters.search, filters.status, page, pageSize]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  const toggleItem = id => {
    setSelectedIds(current => (current.includes(id) ? current.filter(value => value !== id) : [...current, id]));
  };

  const toggleVisible = () => {
    setSelectedIds(current => {
      const visibleIds = items.map(item => item.id);
      if (visibleIds.every(id => current.includes(id))) return current.filter(id => !visibleIds.includes(id));
      return Array.from(new Set([...current, ...visibleIds]));
    });
  };

  const runBulkAction = async (action, status) => {
    if (selectedIds.length === 0) {
      setError('Seleccioná uno o varios artículos para procesar.');
      return;
    }
    setSaving(true);
    setError(null);
    setMessage('');
    try {
      const endpoint = action === 'archive' ? '/shopify/products/archive' : '/shopify/products/sync';
      const data = await api.post(endpoint, { itemIds: selectedIds, status });
      const mode = data.config?.dryRun ? ' (dry-run: no se llamó a Shopify)' : '';
      const updatedInventoryLocations = getUpdatedInventoryLocations(data.results || []);
      const inventoryDetail = updatedInventoryLocations > 0
        ? ` Inventario actualizado en ${updatedInventoryLocations} ubicación(es).`
        : '';
      setMessage(`Actualización completada correctamente: ${data.processed} artículo(s) procesado(s)${mode}.${inventoryDetail}`);
      setSelectedIds([]);
      await fetchItems();
    } catch (err) {
      setError(err.message || 'No se pudo procesar la operación de Shopify.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-wrapper shopify-page">
      <section className="section-card">
        <div className="page-header-row">
          <div>
            <h2>Shopify</h2>
            <p className="muted-text">ABM de productos Shopify usando los artículos del sistema. Podés enviar uno o varios artículos a la vez.</p>
            {shopifyConfig && (
              <p className="muted-text">
                Configuración: {shopifyConfig.shopDomain || 'sin dominio'} · API {shopifyConfig.apiVersion} ·{' '}
                {shopifyConfig.dryRun
                  ? `modo preparación/dry-run (${shopifyConfig.authMode || 'sin auth'})`
                  : shopifyConfig.configured
                    ? `credenciales cargadas (${shopifyConfig.authMode})`
                    : 'faltan credenciales'}
                {' '}· imágenes públicas {shopifyConfig.hasPublicBackendUrl ? 'configuradas' : 'sin configurar'}
              </p>
            )}
          </div>
          <div className="shopify-actions">
            <button type="button" onClick={() => runBulkAction('sync', 'draft')} disabled={!canWrite || saving || selectedIds.length === 0}>Enviar a Shopify</button>
            <button type="button" className="secondary-button" onClick={() => runBulkAction('sync', 'draft')} disabled={!canWrite || saving || selectedIds.length === 0}>Guardar como borrador</button>
            <button type="button" className="danger-button" onClick={() => runBulkAction('archive')} disabled={!canWrite || saving || selectedIds.length === 0}>Dar de baja</button>
          </div>
        </div>
        <div className="form-grid form-grid--spaced">
          <label>Buscar<input value={filters.search} onChange={event => { setFilters(current => ({ ...current, search: event.target.value })); setPage(1); }} placeholder="Código, SKU o descripción" /></label>
          <label>Estado Shopify<select value={filters.status} onChange={event => { setFilters(current => ({ ...current, status: event.target.value })); setPage(1); }}><option value="">Todos</option><option value="draft">Borrador</option><option value="active">Activo</option><option value="archived">Archivado</option></select></label>
        </div>
        {error && <ErrorMessage error={error} />}
        {message && <div className="success-message" role="status">{message}</div>}
      </section>
      <section className="section-card">
        {loading ? <LoadingIndicator /> : <>
          <div className="table-toolbar">
            <span>{selectedIds.length} seleccionado(s) de {total}</span>
            <button type="button" className="secondary-button" onClick={toggleVisible}>
              {allVisibleSelected ? 'Quitar visibles' : 'Seleccionar visibles'}
            </button>
          </div>
          <div className="table-responsive">
            <table className="data-table">
              <thead>
                <tr>
                  <th><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} /></th>
                  <th>Artículo</th>
                  <th>Grupo</th>
                  <th>Precio</th>
                  <th>Stock</th>
                  <th>Ubicación actual</th>
                  <th>Imágenes</th>
                  <th>Estado</th>
                  <th>Última sync</th>
                  <th>Payload Shopify</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  const currentLocations = getCurrentLocations(item);
                  const imageSummary = getShopifyImageSummary(item);
                  return (
                    <tr key={item.id}>
                      <td>
                        <input checked={selectedSet.has(item.id)} type="checkbox" onChange={() => toggleItem(item.id)} />
                      </td>
                      <td>
                        <strong>{item.code}</strong><br />
                        <span className="muted-text">{item.description}</span><br />
                        <small>SKU: {item.sku || '-'}</small>
                      </td>
                      <td>{item.group?.name || '-'}</td>
                      <td>{formatMoney(item.precio)}</td>
                      <td>{item.payload.inventory.boxes} caja(s), {item.payload.inventory.units} unidad(es)</td>
                      <td>
                        {currentLocations.length > 0
                          ? currentLocations.map(location => (
                              <small key={location.locationId} className="muted-text" style={{ display: 'block' }}>
                                {location.locationName}: {formatLocationQuantity(location)}
                              </small>
                            ))
                          : '-'}
                      </td>
                      <td>
                        {imageSummary.images.length > 0 ? (
                          <div className="shopify-image-summary">
                            <div className="shopify-image-thumbnails">
                              {imageSummary.previewImages.map(image => (
                                <img key={image.key} src={image.src} alt={image.alt} loading="lazy" />
                              ))}
                            </div>
                            <small className="muted-text">
                              {imageSummary.images.length} asociada(s) · {imageSummary.media.length} enviable(s)
                            </small>
                            {imageSummary.media.length === 0 && (
                              <small className="muted-text" style={{ display: 'block' }}>
                                Requiere URL pública para Shopify
                              </small>
                            )}
                          </div>
                        ) : '-'}
                      </td>
                      <td>
                        <span className={`status-pill status-pill--${item.shopify.status}`}>
                          {STATUS_LABELS[item.shopify.status] || item.shopify.status}
                        </span>
                      </td>
                      <td>{formatDate(item.shopify.lastSyncedAt)}</td>
                      <td>
                        <small>
                          {item.payload.title} · {item.payload.productType} · {imageSummary.media.length} imagen(es) para Shopify
                        </small>
                      </td>
                    </tr>
                  );
                })}
                {items.length === 0 && <tr><td colSpan="10">No hay artículos para mostrar.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="pagination-controls">
            <button type="button" onClick={() => setPage(value => Math.max(1, value - 1))} disabled={page <= 1}>
              Anterior
            </button>
            <span>Página {page} de {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage(value => Math.min(totalPages, value + 1))}
              disabled={page >= totalPages}
            >
              Siguiente
            </button>
          </div>
        </>}
      </section>
    </div>
  );
}
