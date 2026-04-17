import { useCallback, useEffect, useMemo, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';
import { buildItemEan13 } from '../../utils/ean13.js';

const GENDER_FILTER_OPTIONS = ['Caballero', 'Dama', 'Niños', 'Unisex'];
const DEFAULT_COLOR_FILTER_OPTIONS = [
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
const DEFAULT_SIZE_FILTER_OPTIONS = [
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

function normalizeAttributeValue(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function extractAttributeValues(items, attributeKey) {
  if (!Array.isArray(items)) {
    return [];
  }
  const seen = new Set();
  const values = [];
  items.forEach(item => {
    const raw = item?.attributes?.[attributeKey];
    const normalized = normalizeAttributeValue(raw);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      values.push(normalized);
    }
  });
  return values;
}

function mergeAttributeOptions(currentOptions = [], discoveredValues = []) {
  const registry = new Map();
  const register = value => {
    const normalized = normalizeAttributeValue(value);
    if (!normalized) {
      return;
    }
    const key = normalized.toLowerCase();
    if (!registry.has(key)) {
      registry.set(key, normalized);
    }
  };

  currentOptions.forEach(register);
  discoveredValues.forEach(register);

  return Array.from(registry.values());
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export default function ItemsDownloadPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const canRead = permissions.includes('items.read');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [groups, setGroups] = useState([]);
  const [sizeFilterOptions, setSizeFilterOptions] = useState(DEFAULT_SIZE_FILTER_OPTIONS);
  const [colorFilterOptions, setColorFilterOptions] = useState(DEFAULT_COLOR_FILTER_OPTIONS);
  const [filters, setFilters] = useState({ search: '', sku: '', groupId: '', gender: '', size: '', color: '' });
  const [printing, setPrinting] = useState(false);
  const [selectedItemsForPrint, setSelectedItemsForPrint] = useState({});

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const updateAttributeOptionsFromItems = useCallback(itemsList => {
    const sizeValues = extractAttributeValues(itemsList, 'size');
    const colorValues = extractAttributeValues(itemsList, 'color');
    setSizeFilterOptions(prev => mergeAttributeOptions(prev, sizeValues));
    setColorFilterOptions(prev => mergeAttributeOptions(prev, colorValues));
  }, []);

  useEffect(() => {
    let active = true;
    const loadGroups = async () => {
      try {
        const groupsResponse = await api.get('/groups');
        if (!active) return;
        setGroups(Array.isArray(groupsResponse) ? [...groupsResponse].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })) : []);
      } catch (err) {
        console.warn('No se pudieron cargar grupos', err);
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
      if (!canRead) {
        setItems([]);
        setTotal(0);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const response = await api.get('/items', {
          query: {
            page,
            pageSize,
            search: filters.search,
            sku: filters.sku,
            groupId: filters.groupId,
            gender: filters.gender,
            size: filters.size,
            color: filters.color
          }
        });
        if (!active) return;
        const nextItems = Array.isArray(response?.items) ? response.items : [];
        setItems(nextItems);
        setTotal(response?.total || 0);
        updateAttributeOptionsFromItems(nextItems);
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
  }, [api, canRead, filters.color, filters.gender, filters.groupId, filters.search, filters.size, filters.sku, page, pageSize, updateAttributeOptionsFromItems]);

  const selectedItemsList = useMemo(() => Object.values(selectedItemsForPrint), [selectedItemsForPrint]);

  const isSelectedForPrint = useCallback(itemId => Boolean(selectedItemsForPrint[itemId]), [selectedItemsForPrint]);

  const toggleItemSelectionForPrint = useCallback(item => {
    if (!item?.id) return;
    setSelectedItemsForPrint(prev => {
      if (prev[item.id]) {
        const next = { ...prev };
        delete next[item.id];
        return next;
      }
      return {
        ...prev,
        [item.id]: {
          id: item.id,
          sku: item.sku || '-',
          ean13: buildItemEan13(item.sku, item.unitsPerBox),
          code: item.code || '-',
          description: item.description || '-'
        }
      };
    });
  }, []);

  const clearSelectionForPrint = useCallback(() => {
    setSelectedItemsForPrint({});
  }, []);

  const selectVisibleItemsForPrint = useCallback(() => {
    setSelectedItemsForPrint(prev => {
      const next = { ...prev };
      items.forEach(item => {
        if (!item?.id) return;
        next[item.id] = {
          id: item.id,
          sku: item.sku || '-',
          ean13: buildItemEan13(item.sku, item.unitsPerBox),
          code: item.code || '-',
          description: item.description || '-'
        };
      });
      return next;
    });
  }, [items]);

  const visibleSelectionState = useMemo(() => {
    const visibleIds = items.filter(item => item?.id).map(item => item.id);
    const selectedVisibleCount = visibleIds.filter(itemId => Boolean(selectedItemsForPrint[itemId])).length;
    const totalVisible = visibleIds.length;
    return {
      totalVisible,
      selectedVisibleCount,
      allSelected: totalVisible > 0 && selectedVisibleCount === totalVisible,
      someSelected: selectedVisibleCount > 0 && selectedVisibleCount < totalVisible
    };
  }, [items, selectedItemsForPrint]);

  const handleToggleVisibleSelection = useCallback(() => {
    if (visibleSelectionState.allSelected || visibleSelectionState.someSelected) {
      clearSelectionForPrint();
      return;
    }
    selectVisibleItemsForPrint();
  }, [clearSelectionForPrint, selectVisibleItemsForPrint, visibleSelectionState.allSelected, visibleSelectionState.someSelected]);

  const handlePrintFilteredItems = async () => {
    if (printing) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setError(new Error('No se pudo abrir la ventana de impresión. Verificá si el navegador bloqueó la ventana emergente.'));
      return;
    }

    printWindow.document.open();
    printWindow.document.write(`
      <!doctype html>
      <html lang="es">
        <head>
          <meta charset="utf-8" />
          <title>Preparando impresión…</title>
          <style>
            body { font-family: Arial, sans-serif; margin: 24px; color: #0f172a; }
            p { color: #334155; }
          </style>
        </head>
        <body>
          <h1>Preparando impresión…</h1>
          <p>Estamos generando el listado de artículos seleccionados. Este proceso puede tardar unos segundos.</p>
        </body>
      </html>
    `);
    printWindow.document.close();

    setPrinting(true);
    setError(null);
    try {
      const collectedItems = [...selectedItemsList];
      if (collectedItems.length === 0) {
        throw new Error('Seleccioná al menos un artículo para generar el PDF.');
      }

      const printedAt = new Date().toLocaleString('es-AR', {
        dateStyle: 'short',
        timeStyle: 'short'
      });

      const tableRows = collectedItems
        .map(item => {
          return `
            <tr>
              <td>${escapeHtml(item.sku || '-')}</td>
              <td>${escapeHtml(item.ean13 || '-')}</td>
              <td>${escapeHtml(item.code || '-')}</td>
              <td>${escapeHtml(item.description || '-')}</td>
            </tr>
          `;
        })
        .join('');

      const printableContent = `
        <!doctype html>
        <html lang="es">
          <head>
            <meta charset="utf-8" />
            <title>Artículos seleccionados</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 24px; color: #0f172a; }
              h1 { margin: 0 0 8px; font-size: 22px; }
              p { margin: 0 0 6px; color: #334155; }
              .meta { margin-bottom: 14px; }
              table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
              th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; vertical-align: top; }
              th { background: #f8fafc; }
              @media print {
                body { margin: 12mm; }
              }
            </style>
          </head>
          <body>
            <h1>Listado de artículos seleccionados</h1>
            <div class="meta">
              <p><strong>Total:</strong> ${collectedItems.length}</p>
              <p><strong>Fecha de impresión:</strong> ${escapeHtml(printedAt)}</p>
            </div>
            <table>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>EAN13</th>
                  <th>Artículo</th>
                  <th>Descripción</th>
                </tr>
              </thead>
              <tbody>
                ${
                  tableRows ||
                  '<tr><td colspan="4" style="text-align:center">No hay artículos seleccionados para imprimir.</td></tr>'
                }
              </tbody>
            </table>
          </body>
        </html>
      `;

      printWindow.document.open();
      printWindow.document.write(printableContent);
      printWindow.document.close();

      const triggerPrint = () => {
        printWindow.focus();
        printWindow.print();
      };

      if (printWindow.document.readyState === 'complete') {
        triggerPrint();
      } else {
        printWindow.onload = () => {
          triggerPrint();
        };
      }
    } catch (err) {
      setError(err);
      printWindow.document.open();
      printWindow.document.write(`
        <!doctype html>
        <html lang="es">
          <head>
            <meta charset="utf-8" />
            <title>Error al imprimir</title>
          </head>
          <body>
            <h1>No se pudo generar la impresión</h1>
            <p>${escapeHtml(err?.message || 'Ocurrió un error inesperado.')}</p>
          </body>
        </html>
      `);
      printWindow.document.close();
    } finally {
      setPrinting(false);
    }
  };

  if (!canRead) {
    return <ErrorMessage error={new Error('No tenés permisos para ver esta sección.')} />;
  }

  return (
    <div>
      <div className="flex-between">
        <div>
          <h2>Descarga de artículos</h2>
          <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
            Seleccioná artículos y generá el PDF desde esta pantalla específica.
          </p>
        </div>
        <div>
          <span className="badge">Total: {total}</span>
        </div>
      </div>

      {error && <ErrorMessage error={error} />}

      <div className="section-card">
        <div className="flex-between">
          <h2>Buscar artículos para descarga</h2>
          <button
            type="button"
            className="secondary-button"
            onClick={handlePrintFilteredItems}
            disabled={printing || selectedItemsList.length === 0}
            title={selectedItemsList.length === 0 ? 'Seleccioná artículos para habilitar la descarga.' : undefined}
          >
            {printing ? 'Preparando impresión…' : 'Descargar filtrados'}
          </button>
        </div>
        <form className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <div className="input-group">
            <label htmlFor="filterSku">SKU</label>
            <input
              id="filterSku"
              value={filters.sku}
              onChange={event => {
                setFilters(prev => ({ ...prev, sku: event.target.value }));
                setPage(1);
              }}
              placeholder="Filtrar por SKU"
            />
          </div>
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
                <option key={group.id || group._id || group.name} value={group.id || group._id || ''}>
                  {group.name}
                </option>
              ))}
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
              {sizeFilterOptions.map(option => (
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
              {colorFilterOptions.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </form>

        <div className="flex-between" style={{ marginTop: '0.75rem', gap: '0.75rem', alignItems: 'center' }}>
          <div>
            <span style={{ color: '#475569', fontSize: '0.9rem' }}>
              Seleccionados para descarga: <strong>{selectedItemsList.length}</strong>
            </span>
            <p style={{ margin: '0.15rem 0 0', color: '#64748b', fontSize: '0.78rem' }}>
              Podés marcar artículo por artículo con el check de cada línea (columna Descargar).
            </p>
          </div>
          <div className="inline-actions">
            <label style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center', color: '#475569', fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={visibleSelectionState.allSelected}
                onChange={handleToggleVisibleSelection}
                disabled={visibleSelectionState.totalVisible === 0}
                ref={input => {
                  if (input) {
                    input.indeterminate = visibleSelectionState.someSelected;
                  }
                }}
              />
              Check general (seleccionar visibles / resetear lista)
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={clearSelectionForPrint}
              disabled={selectedItemsList.length === 0}
            >
              Limpiar selección
            </button>
          </div>
        </div>

        {loading ? (
          <LoadingIndicator message="Cargando artículos..." />
        ) : (
          <div className="table-wrapper" style={{ marginTop: '1rem' }}>
            <table>
              <thead>
                <tr>
                  <th>Descargar</th>
                  <th>SKU</th>
                  <th>EAN13</th>
                  <th>Artículo</th>
                  <th>Descripción</th>
                </tr>
              </thead>
              <tbody>
                {items.map(item => {
                  return (
                    <tr key={item.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={isSelectedForPrint(item.id)}
                          onChange={() => toggleItemSelectionForPrint(item)}
                          title="Seleccionar esta línea para PDF"
                          aria-label={`Seleccionar ${item.code || item.sku || 'artículo'} para PDF`}
                        />
                      </td>
                      <td>{item.sku || '-'}</td>
                      <td>{buildItemEan13(item.sku, item.unitsPerBox) || '-'}</td>
                      <td>{item.code}</td>
                      <td>{item.description}</td>
                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ textAlign: 'center', padding: '1.5rem 0' }}>
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
              disabled={page >= totalPages}
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
