import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import useApi from '../hooks/useApi.js';
import { useAuth } from '../context/AuthContext.jsx';
import LoadingIndicator from '../components/LoadingIndicator.jsx';
import ErrorMessage from '../components/ErrorMessage.jsx';
import { formatQuantity } from '../utils/quantity.js';
import { computeTotalStockFromMap } from '../utils/stockStatus.js';
import { computeInventoryAlerts, RECOUNT_THRESHOLD_DAYS } from '../utils/inventoryAlerts.js';

const formatUpdatedAt = value => {
  if (!value) {
    return 'Sin registro';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Sin registro';
  }
  return date.toLocaleString('es-AR', {
    dateStyle: 'short',
    timeStyle: 'short'
  });
};

const formatRecountReasons = item => {
  const reasons = item?.reasons || [];
  const parts = [];
  if (reasons.includes('manual')) {
    parts.push('Marcado manualmente');
  }
  if (reasons.includes('stale')) {
    if (item?.staleDays === null) {
      parts.push('Sin registro de actualización');
    } else if (item.staleDays === 1) {
      parts.push('1 día sin actualización');
    } else {
      parts.push(`${item.staleDays} días sin actualización`);
    }
  }
  if (parts.length === 0) {
    return 'Recuento pendiente';
  }
  return parts.join(' · ');
};

const buildItemSummaries = items =>
  (Array.isArray(items) ? items : []).map(item => ({
    id: item.id,
    code: item.code,
    description: item.description,
    group: item.group || null,
    groupId:
      item.groupId ||
      item.group?.id ||
      item.group?._id ||
      (typeof item.group === 'object' ? item.group?.id || item.group?._id : null) ||
      null,
    needsRecount: Boolean(item.needsRecount),
    updatedAt: item.updatedAt || null,
    total: computeTotalStockFromMap(item.stock)
  }));

export default function InventoryAlertsPage() {
  const api = useApi();
  const { user } = useAuth();
  const location = useLocation();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const canViewCatalog = permissions.includes('items.read');
  const isAdmin = user?.role === 'Administrador';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [itemsSnapshot, setItemsSnapshot] = useState([]);
  const [activeSection, setActiveSection] = useState('all');
  const [recountSearch, setRecountSearch] = useState('');
  const [outOfStockSearch, setOutOfStockSearch] = useState('');
  const [recountThresholdDays, setRecountThresholdDays] = useState(RECOUNT_THRESHOLD_DAYS);
  const [thresholdInput, setThresholdInput] = useState(String(RECOUNT_THRESHOLD_DAYS));
  const [configSaving, setConfigSaving] = useState(false);
  const [configMessage, setConfigMessage] = useState(null);

  useEffect(() => {
    let active = true;
    if (!canViewCatalog) {
      setItemsSnapshot([]);
      setLoading(false);
      return () => {
        active = false;
      };
    }
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const configPromise = api.get('/preferences/dashboard/attention').catch(error => {
          console.warn('No se pudo obtener la configuración de alertas', error);
          return null;
        });
        const collectedItems = [];
        const seenIds = new Set();
        let pageNumber = 1;
        const pageSize = 200;
        let totalItems = null;
        while (true) {
          const response = await api.get('/items', { query: { page: pageNumber, pageSize } });
          if (!active) {
            return;
          }
          const pageItems = Array.isArray(response?.items) ? response.items : [];
          pageItems.forEach(item => {
            const id = item?.id;
            if (id && !seenIds.has(id)) {
              seenIds.add(id);
              collectedItems.push(item);
            }
          });
          const responseTotal = Number(response?.total);
          if (Number.isFinite(responseTotal) && responseTotal >= 0) {
            totalItems = responseTotal;
          }
          const effectivePageSize = Number(response?.pageSize) || pageSize;
          if (pageItems.length < effectivePageSize) {
            break;
          }
          if (totalItems !== null && collectedItems.length >= totalItems) {
            break;
          }
          pageNumber += 1;
        }
        setItemsSnapshot(collectedItems);
        const attentionConfig = await configPromise;
        const normalizedThreshold = Number.isFinite(attentionConfig?.recountThresholdDays)
          ? Math.max(0, Math.round(attentionConfig.recountThresholdDays))
          : RECOUNT_THRESHOLD_DAYS;
        setRecountThresholdDays(normalizedThreshold);
        setThresholdInput(String(normalizedThreshold));
      } catch (err) {
        if (!active) {
          return;
        }
        setError(err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [api, canViewCatalog]);

  useEffect(() => {
    if (loading) {
      return;
    }
    const hash = location.hash?.replace('#', '');
    if (hash === 'recount' || hash === 'out-of-stock') {
      setActiveSection(hash);
    } else {
      setActiveSection('all');
    }
  }, [location.hash, loading]);

  useEffect(() => {
    if (loading) {
      return;
    }
    const hash = location.hash?.replace('#', '');
    if (!hash) {
      return;
    }
    const target = document.getElementById(hash);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (typeof target.focus === 'function') {
        target.focus({ preventScroll: true });
      }
    }
  }, [activeSection, location.hash, loading]);

  const itemSummaries = useMemo(() => buildItemSummaries(itemsSnapshot), [itemsSnapshot]);
  const { recount: recountItems, outOfStock: outOfStockItems } = useMemo(
    () => computeInventoryAlerts(itemSummaries, { thresholdDays: recountThresholdDays }),
    [itemSummaries, recountThresholdDays]
  );

  const filteredRecountItems = useMemo(() => {
    const query = recountSearch.trim().toLowerCase();
    if (!query) {
      return recountItems;
    }
    return recountItems.filter(item => {
      const candidates = [item.code, item.description, item.group?.name];
      return candidates.some(value => typeof value === 'string' && value.toLowerCase().includes(query));
    });
  }, [recountItems, recountSearch]);

  const filteredOutOfStockItems = useMemo(() => {
    const query = outOfStockSearch.trim().toLowerCase();
    if (!query) {
      return outOfStockItems;
    }
    return outOfStockItems.filter(item => {
      const candidates = [item.code, item.description, item.group?.name];
      return candidates.some(value => typeof value === 'string' && value.toLowerCase().includes(query));
    });
  }, [outOfStockItems, outOfStockSearch]);

  const recountHelperText =
    recountThresholdDays > 0
      ? `Incluye artículos marcados manualmente o sin actualización en ${recountThresholdDays}+ días.`
      : 'Incluye artículos marcados manualmente o sin registro de actualización automática.';

  const handleThresholdSubmit = async event => {
    event.preventDefault();
    setConfigMessage(null);
    const parsedThreshold = Number(thresholdInput);
    if (!Number.isFinite(parsedThreshold) || parsedThreshold < 0) {
      setConfigMessage({ type: 'error', message: 'Ingresá un número válido mayor o igual a 0.' });
      return;
    }
    setConfigSaving(true);
    try {
      const response = await api.put('/preferences/dashboard/attention', {
        recountThresholdDays: parsedThreshold
      });
      const normalizedThreshold = Number.isFinite(response?.recountThresholdDays)
        ? Math.max(0, Math.round(response.recountThresholdDays))
        : RECOUNT_THRESHOLD_DAYS;
      setRecountThresholdDays(normalizedThreshold);
      setThresholdInput(String(normalizedThreshold));
      setConfigMessage({ type: 'success', message: 'Configuración actualizada.' });
    } catch (err) {
      setConfigMessage({ type: 'error', message: err?.message || 'No se pudo guardar la configuración.' });
    } finally {
      setConfigSaving(false);
    }
  };

  const configStatusClass = configMessage
    ? `attention-actions__status attention-actions__status--${configMessage.type}`
    : null;

  if (!canViewCatalog) {
    return (
      <div className="inventory-alerts-page">
        <h2>Alertas de inventario</h2>
        <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
          Consulte los artículos que requieren seguimiento especial del stock.
        </p>
        <ErrorMessage error="No posee permisos para visualizar el catálogo de artículos." />
      </div>
    );
  }

  return (
    <div className="inventory-alerts-page">
      <h2>Alertas de inventario</h2>
      <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
        Revise los artículos sin stock disponible y aquellos que necesitan un nuevo recuento.
      </p>

      {error && <ErrorMessage error={error} />}

      {loading ? (
        <LoadingIndicator message="Cargando alertas de inventario..." />
      ) : (
        <>
          {isAdmin && (
            <section className="section-card" style={{ marginBottom: '1rem' }}>
              <h3>Administración</h3>
              <p style={{ color: '#475569', marginTop: '-0.5rem' }}>
                Configurá los días sin actualización necesarios para generar la alarma automática de recuento pendiente.
              </p>
              <form
                onSubmit={handleThresholdSubmit}
                className="form-grid"
                style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', alignItems: 'flex-end' }}
              >
                <div className="input-group">
                  <label htmlFor="recountThreshold">Días de inactividad</label>
                  <input
                    id="recountThreshold"
                    type="number"
                    min="0"
                    value={thresholdInput}
                    onChange={event => setThresholdInput(event.target.value)}
                  />
                  <p className="input-helper">Ingresá 0 para desactivar la alarma automática.</p>
                </div>
                <div className="attention-actions__field attention-actions__field--buttons">
                  <button type="submit" disabled={configSaving}>
                    {configSaving ? 'Guardando…' : 'Guardar'}
                  </button>
                  {configMessage && configStatusClass && (
                    <p className={configStatusClass} role={configMessage.type === 'error' ? 'alert' : 'status'}>
                      {configMessage.message}
                    </p>
                  )}
                </div>
              </form>
            </section>
          )}

          {(activeSection === 'all' || activeSection === 'recount') && (
            <section className="section-card" id="recount" tabIndex={-1}>
              <div className="flex-between" style={{ alignItems: 'flex-start', gap: '1rem' }}>
                <div>
                  <h3>Artículos con recuento pendiente</h3>
                  <p style={{ color: '#475569', marginTop: '-0.5rem' }}>
                    {recountHelperText}
                  </p>
                </div>
                <span className="badge">Total: {recountItems.length}</span>
              </div>
              {recountItems.length === 0 ? (
                <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '1rem' }}>
                  No hay artículos pendientes de recuento.
                </p>
              ) : (
                <>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.75rem',
                      marginTop: '1rem'
                    }}
                  >
                    <div style={{ color: '#64748b', fontSize: '0.85rem' }}>
                      Coincidencias: {filteredRecountItems.length} de {recountItems.length}
                    </div>
                    <input
                      type="search"
                      placeholder="Buscar por código, descripción o grupo"
                      value={recountSearch}
                      onChange={event => setRecountSearch(event.target.value)}
                      style={{
                        flex: '1 1 220px',
                        minWidth: '200px',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '0.5rem',
                        border: '1px solid #cbd5f5'
                      }}
                    />
                  </div>
                  {filteredRecountItems.length === 0 ? (
                    <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '1rem' }}>
                      No hay resultados que coincidan con la búsqueda actual.
                    </p>
                  ) : (
                    <div className="table-wrapper" style={{ marginTop: '1rem' }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Código</th>
                            <th>Descripción</th>
                            <th>Grupo</th>
                            <th>Stock</th>
                            <th>Motivo</th>
                            <th>Última actualización</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredRecountItems.map(item => (
                            <tr key={item.id}>
                              <td>{item.code}</td>
                              <td>{item.description}</td>
                              <td>{item.group?.name || 'Sin grupo'}</td>
                              <td>{formatQuantity(item.total)}</td>
                              <td>{formatRecountReasons(item)}</td>
                              <td>{formatUpdatedAt(item.updatedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {(activeSection === 'all' || activeSection === 'out-of-stock') && (
            <section className="section-card" id="out-of-stock" tabIndex={-1}>
              <div className="flex-between" style={{ alignItems: 'flex-start', gap: '1rem' }}>
                <div>
                  <h3>Artículos agotados</h3>
                  <p style={{ color: '#475569', marginTop: '-0.5rem' }}>
                    Listado completo de artículos sin unidades disponibles en el inventario consolidado.
                  </p>
                </div>
                <span className="badge">Total: {outOfStockItems.length}</span>
              </div>
              {outOfStockItems.length === 0 ? (
                <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '1rem' }}>
                  No hay artículos agotados en este momento.
                </p>
              ) : (
                <>
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '0.75rem',
                      marginTop: '1rem'
                    }}
                  >
                    <div style={{ color: '#64748b', fontSize: '0.85rem' }}>
                      Coincidencias: {filteredOutOfStockItems.length} de {outOfStockItems.length}
                    </div>
                    <input
                      type="search"
                      placeholder="Buscar por código, descripción o grupo"
                      value={outOfStockSearch}
                      onChange={event => setOutOfStockSearch(event.target.value)}
                      style={{
                        flex: '1 1 220px',
                        minWidth: '200px',
                        padding: '0.5rem 0.75rem',
                        borderRadius: '0.5rem',
                        border: '1px solid #cbd5f5'
                      }}
                    />
                  </div>
                  {filteredOutOfStockItems.length === 0 ? (
                    <p style={{ color: '#64748b', fontSize: '0.9rem', marginTop: '1rem' }}>
                      No hay resultados que coincidan con la búsqueda actual.
                    </p>
                  ) : (
                    <div className="table-wrapper" style={{ marginTop: '1rem' }}>
                      <table>
                        <thead>
                          <tr>
                            <th>Código</th>
                            <th>Descripción</th>
                            <th>Grupo</th>
                            <th>Stock</th>
                            <th>Última actualización</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredOutOfStockItems.map(item => (
                            <tr key={item.id}>
                              <td>{item.code}</td>
                              <td>{item.description}</td>
                              <td>{item.group?.name || 'Sin grupo'}</td>
                              <td>{formatQuantity(item.total)}</td>
                              <td>{formatUpdatedAt(item.updatedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
