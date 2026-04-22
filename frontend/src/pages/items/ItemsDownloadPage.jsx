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

const EAN13_LEFT_PARITY_BY_FIRST_DIGIT = {
  0: 'LLLLLL',
  1: 'LLGLGG',
  2: 'LLGGLG',
  3: 'LLGGGL',
  4: 'LGLLGG',
  5: 'LGGLLG',
  6: 'LGGGLL',
  7: 'LGLGLG',
  8: 'LGLGGL',
  9: 'LGGLGL'
};

const EAN13_L_PATTERNS = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const EAN13_G_PATTERNS = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const EAN13_R_PATTERNS = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];

function sanitizeEan13(ean) {
  if (typeof ean !== 'string') {
    return '';
  }
  const digits = ean.replace(/\D/g, '');
  return digits.length === 13 ? digits : '';
}

function buildEan13Binary(ean13) {
  const sanitized = sanitizeEan13(ean13);
  if (!sanitized) {
    return null;
  }
  const firstDigit = Number(sanitized[0]);
  const parity = EAN13_LEFT_PARITY_BY_FIRST_DIGIT[firstDigit];
  if (!parity) {
    return null;
  }

  let binary = '101';
  for (let index = 1; index <= 6; index += 1) {
    const digit = Number(sanitized[index]);
    binary += parity[index - 1] === 'L' ? EAN13_L_PATTERNS[digit] : EAN13_G_PATTERNS[digit];
  }
  binary += '01010';
  for (let index = 7; index <= 12; index += 1) {
    const digit = Number(sanitized[index]);
    binary += EAN13_R_PATTERNS[digit];
  }
  binary += '101';
  return binary;
}

function buildEan13SvgMarkup(ean13) {
  const binary = buildEan13Binary(ean13);
  if (!binary) {
    return `<div class="barcode-error">EAN inválido</div>`;
  }
  const moduleWidth = 1;
  const quietZoneModules = 9;
  const totalModules = binary.length + quietZoneModules * 2;
  const guardBarHeight = 62;
  const normalBarHeight = 56;
  const viewBoxHeight = 68;
  let currentX = quietZoneModules;
  let rects = '';

  for (let index = 0; index < binary.length; index += 1) {
    if (binary[index] !== '1') {
      currentX += moduleWidth;
      continue;
    }
    const runStart = currentX;
    let runLength = 0;
    while (index < binary.length && binary[index] === '1') {
      runLength += 1;
      currentX += moduleWidth;
      index += 1;
    }
    index -= 1;

    const isGuardZone = index < 3 || (index >= 45 && index < 50) || index >= 92;
    const barHeight = isGuardZone ? guardBarHeight : normalBarHeight;
    rects += `<rect x="${runStart}" y="0" width="${runLength}" height="${barHeight}" fill="#000"></rect>`;
  }

  return `
    <svg class="barcode-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalModules} ${viewBoxHeight}" role="img" aria-label="Código EAN ${escapeHtml(ean13)}">
      ${rects}
    </svg>
  `;
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

  const handlePrintLabelsA4 = async itemsToPrint => {
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
      const collectedItems = Array.isArray(itemsToPrint) ? [...itemsToPrint] : [...selectedItemsList];
      if (collectedItems.length === 0) {
        throw new Error('Seleccioná al menos un artículo para generar etiquetas.');
      }

      const printedAt = new Date().toLocaleString('es-AR', {
        dateStyle: 'short',
        timeStyle: 'short'
      });

      const labelCards = collectedItems
        .map(item => {
          return `
            <article class="label-card">
              <div class="barcode-wrap">
                ${buildEan13SvgMarkup(item.ean13)}
              </div>
              <p class="ean-text">${escapeHtml(item.ean13 || '-')}</p>
            </article>
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
              .labels-grid {
                display: grid;
                grid-template-columns: repeat(3, 63mm);
                grid-auto-rows: 33.9mm;
                gap: 2mm;
                align-content: start;
              }
              .label-card {
                border: 1px dashed #cbd5e1;
                border-radius: 2mm;
                padding: 2mm;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                overflow: hidden;
              }
              .barcode-wrap { width: 100%; }
              .barcode-svg {
                display: block;
                width: 100%;
                max-height: 22mm;
              }
              .ean-text {
                margin: 1.8mm 0 0;
                letter-spacing: 0.5px;
                font-size: 12px;
                color: #0f172a;
                font-weight: 600;
              }
              .barcode-error {
                width: 100%;
                border: 1px solid #fca5a5;
                background: #fef2f2;
                color: #991b1b;
                font-size: 12px;
                text-align: center;
                border-radius: 4px;
                padding: 8px;
              }
              @media print {
                @page { size: A4 portrait; margin: 10mm; }
                body { margin: 0; }
                .label-card {
                  break-inside: avoid;
                  page-break-inside: avoid;
                }
              }
            </style>
          </head>
          <body>
            <h1>Listado de artículos seleccionados</h1>
            <div class="meta">
              <p><strong>Total:</strong> ${collectedItems.length}</p>
              <p><strong>Fecha de impresión:</strong> ${escapeHtml(printedAt)}</p>
            </div>
            <section class="labels-grid">
              ${
                labelCards ||
                '<div class="barcode-error">No hay artículos seleccionados para imprimir.</div>'
              }
            </section>
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

  const handlePrintConfirm = useCallback(
    itemsToPrint => {
      const selectedCount = Array.isArray(itemsToPrint) ? itemsToPrint.length : 0;
      if (selectedCount === 0) {
        setError(new Error('Seleccioná al menos un artículo para generar etiquetas.'));
        return;
      }
      const confirmed = window.confirm(
        `Se imprimirán ${selectedCount} etiqueta(s) en formato A4.\n\n¿Deseás continuar?`
      );
      if (!confirmed) {
        return;
      }
      handlePrintLabelsA4(itemsToPrint);
    },
    [handlePrintLabelsA4]
  );

  const handlePrintSingleLabel = useCallback(
    item => {
      if (!item?.id) return;
      const singleItemPayload = {
        id: item.id,
        sku: item.sku || '-',
        ean13: buildItemEan13(item.sku, item.unitsPerBox),
        code: item.code || '-',
        description: item.description || '-'
      };
      setSelectedItemsForPrint(prev => ({ ...prev, [item.id]: singleItemPayload }));
      handlePrintConfirm([singleItemPayload]);
    },
    [handlePrintConfirm]
  );

  const handleDownloadSelectedPdf = async () => {
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
          <title>Preparando PDF…</title>
        </head>
        <body>
          <h1>Preparando PDF…</h1>
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

      printWindow.document.open();
      printWindow.document.write(`
        <!doctype html>
        <html lang="es">
          <head>
            <meta charset="utf-8" />
            <title>Listado de artículos seleccionados</title>
            <style>
              body { font-family: Arial, sans-serif; margin: 24px; color: #0f172a; }
              h1 { margin: 0 0 8px; font-size: 22px; }
              p { margin: 0 0 6px; color: #334155; }
              .meta { margin-bottom: 14px; }
              table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12px; }
              th, td { border: 1px solid #cbd5e1; padding: 8px; text-align: left; vertical-align: top; }
              th { background: #f8fafc; }
              @media print {
                @page { size: A4 portrait; margin: 12mm; }
                body { margin: 0; }
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
                ${tableRows}
              </tbody>
            </table>
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    } catch (err) {
      setError(err);
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
          <div className="inline-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={handleDownloadSelectedPdf}
              disabled={printing || selectedItemsList.length === 0}
              title={selectedItemsList.length === 0 ? 'Seleccioná artículos para habilitar la descarga.' : undefined}
            >
              {printing ? 'Preparando impresión…' : 'Descargar PDF'}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => handlePrintConfirm(selectedItemsList)}
              disabled={printing || selectedItemsList.length === 0}
              title={selectedItemsList.length === 0 ? 'Seleccioná artículos para habilitar la descarga.' : undefined}
            >
              {printing ? 'Preparando impresión…' : 'Imprimir etiquetas A4'}
            </button>
          </div>
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
                  <th>Etiqueta</th>
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
                      <td>
                        <button type="button" className="secondary-button" onClick={() => handlePrintSingleLabel(item)}>
                          Imprimir etiqueta
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {items.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '1.5rem 0' }}>
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
