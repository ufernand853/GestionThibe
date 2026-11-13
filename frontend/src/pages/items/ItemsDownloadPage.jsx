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


function shouldPrintInCurrentDocumentOnMobile() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return false;
  }
  const userAgent = navigator.userAgent || '';
  return /Android|iPhone|iPad|iPod/i.test(userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth <= 900);
}

function printHtmlInCurrentDocument(html) {
  return new Promise((resolve, reject) => {
    try {
      const parser = new DOMParser();
      const printableDocument = parser.parseFromString(html, 'text/html');
      const printRoot = document.createElement('div');
      const printStyle = document.createElement('style');

      printRoot.className = 'mobile-label-print-root';
      printRoot.setAttribute('aria-hidden', 'true');
      printRoot.innerHTML = printableDocument.body.innerHTML;
      printStyle.textContent = `
        ${Array.from(printableDocument.querySelectorAll('style')).map(style => style.textContent).join('\n')}
        @media screen { .mobile-label-print-root { display: none !important; } }
        @media print {
          body > *:not(.mobile-label-print-root) { display: none !important; }
          .mobile-label-print-root { display: block !important; }
        }
      `;

      const cleanup = () => {
        printRoot.remove();
        printStyle.remove();
      };

      window.addEventListener('afterprint', cleanup, { once: true });
      document.head.appendChild(printStyle);
      document.body.appendChild(printRoot);
      window.setTimeout(cleanup, 60000);
      window.setTimeout(() => {
        window.print();
        resolve();
      }, 100);
    } catch (error) {
      reject(error);
    }
  });
}

function printHtmlInHiddenFrame(html) {
  if (shouldPrintInCurrentDocumentOnMobile()) {
    return printHtmlInCurrentDocument(html);
  }

  return new Promise((resolve, reject) => {
    const printFrame = document.createElement('iframe');
    printFrame.setAttribute('aria-hidden', 'true');
    printFrame.style.position = 'fixed';
    printFrame.style.left = '-10000px';
    printFrame.style.top = '0';
    printFrame.style.width = '100mm';
    printFrame.style.height = '100mm';
    printFrame.style.border = '0';
    printFrame.style.opacity = '0';

    const removeFrame = () => {
      if (printFrame.parentNode) {
        printFrame.parentNode.removeChild(printFrame);
      }
    };

    printFrame.onload = () => {
      try {
        const frameWindow = printFrame.contentWindow;
        if (!frameWindow) {
          throw new Error('No se pudo preparar el documento de impresión.');
        }
        frameWindow.addEventListener('afterprint', removeFrame, { once: true });
        frameWindow.focus();
        frameWindow.print();
        window.setTimeout(removeFrame, 60000);
        resolve();
      } catch (error) {
        removeFrame();
        reject(error);
      }
    };

    printFrame.srcdoc = html;
    document.body.appendChild(printFrame);
  });
}

function buildLabels100x100Document(itemsToPrint) {
  const labelCards = itemsToPrint
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

  return `
    <!doctype html>
    <html lang="es">
      <head>
        <meta charset="utf-8" />
        <title>Etiquetas 10 × 10 cm</title>
        <style>
          @page { size: 100mm 100mm; margin: 0; }
          * { box-sizing: border-box; }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: 100mm;
            font-family: Arial, sans-serif;
            color: #000;
            background: #fff;
          }
          .label-card {
            width: 99mm;
            height: 99mm;
            margin: 0;
            padding: 0;
            transform: translate(0.5mm, 0.5mm);
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            overflow: hidden;
            background: #fff;
            break-after: page;
            page-break-after: always;
            break-inside: avoid;
            page-break-inside: avoid;
          }
          .label-card:last-child {
            break-after: auto;
            page-break-after: auto;
          }
          .barcode-wrap {
            width: 60mm;
            height: 30mm;
            display: flex;
            justify-content: center;
            align-items: center;
            flex: 0 0 auto;
          }
          .barcode-svg {
            display: block;
            width: 60mm;
            height: 30mm;
          }
          .ean-text {
            margin: 2.8mm 0 0;
            color: #000;
            font-size: 12.6pt;
            font-weight: 700;
            letter-spacing: 0.84mm;
            line-height: 1;
            text-align: center;
            flex: 0 0 auto;
          }
          .barcode-error {
            width: 60mm;
            min-height: 30mm;
            display: flex;
            justify-content: center;
            align-items: center;
            border: 0.5mm solid #000;
            color: #000;
            font-size: 12.6pt;
            font-weight: 700;
            text-align: center;
            padding: 4mm;
          }
        </style>
      </head>
      <body>
        ${labelCards}
      </body>
    </html>
  `;
}

export default function ItemsDownloadPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const canRead = permissions.includes('items.read');
  const isDownloadRestrictedRole = ['Operador', 'Supervisor'].includes(user?.role);
  const canUseDownloadPage = canRead && !isDownloadRestrictedRole;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [groups, setGroups] = useState([]);
  const [sizeFilterOptions, setSizeFilterOptions] = useState(DEFAULT_SIZE_FILTER_OPTIONS);
  const [colorFilterOptions, setColorFilterOptions] = useState(DEFAULT_COLOR_FILTER_OPTIONS);
  const [filters, setFilters] = useState({ search: '', groupId: '', gender: '', size: '', color: '' });
  const [printing, setPrinting] = useState(false);
  const [selectedItemsForPrint, setSelectedItemsForPrint] = useState({});
  const [includeSkuInPdf, setIncludeSkuInPdf] = useState(false);

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
      if (!canUseDownloadPage) {
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
  }, [api, canUseDownloadPage, filters.color, filters.gender, filters.groupId, filters.search, filters.size, page, pageSize, updateAttributeOptionsFromItems]);

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
          ean13: buildItemEan13(item.sku, item.unitsPerBox),
          code: item.code || '-',
          sku: item.sku || '-',
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
          ean13: buildItemEan13(item.sku, item.unitsPerBox),
          code: item.code || '-',
          sku: item.sku || '-',
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

  const handlePrintLabels100x100 = async itemsToPrint => {
    if (printing) return;

    setPrinting(true);
    setError(null);
    try {
      const collectedItems = Array.isArray(itemsToPrint) ? [...itemsToPrint] : [...selectedItemsList];
      if (collectedItems.length === 0) {
        throw new Error('Seleccioná al menos un artículo para generar etiquetas.');
      }

      await printHtmlInHiddenFrame(buildLabels100x100Document(collectedItems));
    } catch (err) {
      setError(err);
    } finally {
      setPrinting(false);
    }
  };

  const handleDownloadSelectedLabelsPdf = async () => {
    if (printing) return;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      setError(new Error('No se pudo abrir la ventana para descargar etiquetas. Verificá si el navegador bloqueó la ventana emergente.'));
      return;
    }

    setPrinting(true);
    setError(null);
    try {
      const collectedItems = [...selectedItemsList];
      if (collectedItems.length === 0) {
        throw new Error('Seleccioná al menos un artículo para generar etiquetas.');
      }

      printWindow.document.open();
      printWindow.document.write(buildLabels100x100Document(collectedItems));
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    } catch (err) {
      printWindow.close();
      setError(err);
    } finally {
      setPrinting(false);
    }
  };

  const handlePrintSelectedLabels = useCallback(() => {
    handlePrintLabels100x100(selectedItemsList);
  }, [handlePrintLabels100x100, selectedItemsList]);

  const handlePrintSingleLabel = useCallback(
    item => {
      if (!item?.id) return;
      const singleItemPayload = {
        id: item.id,
        ean13: buildItemEan13(item.sku, item.unitsPerBox),
        code: item.code || '-',
        sku: item.sku || '-',
        description: item.description || '-'
      };
      setSelectedItemsForPrint(prev => ({ ...prev, [item.id]: singleItemPayload }));
      handlePrintLabels100x100([singleItemPayload]);
    },
    [handlePrintLabels100x100]
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
              <td>${escapeHtml(item.ean13 || '-')}</td>
              <td>${escapeHtml(item.code || '-')}</td>
              ${includeSkuInPdf ? `<td>${escapeHtml(item.sku || '-')}</td>` : ''}
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
                  <th>EAN13</th>
                  <th>Artículo</th>
                  ${includeSkuInPdf ? '<th>SKU</th>' : ''}
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

  if (!canUseDownloadPage) {
    return <ErrorMessage error={new Error('No tenés permisos para ver esta sección.')} />;
  }

  return (
    <div>
      <div className="flex-between">
        <div>
          <h2>Descarga de artículos</h2>
          <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
            Seleccioná artículos para descargar el PDF o imprimir etiquetas de código de barras de 10 × 10 cm.
          </p>
        </div>
        <div>
          <span className="badge">Total: {total}</span>
        </div>
      </div>

      {error && <ErrorMessage error={error} />}

      <div className="section-card">
        <div className="flex-between">
          <h2>Buscar artículos para descarga o impresión</h2>
          <div className="inline-actions">
            <label style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center', color: '#475569', fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={includeSkuInPdf}
                onChange={event => setIncludeSkuInPdf(event.target.checked)}
              />
              Mostrar SKU en PDF
            </label>
            <button
              type="button"
              className="secondary-button"
              onClick={handleDownloadSelectedPdf}
              disabled={printing || selectedItemsList.length === 0}
              title={selectedItemsList.length === 0 ? 'Seleccioná artículos para habilitar la descarga.' : undefined}
            >
              {printing ? 'Preparando impresión…' : 'Descargar Lista PDF'}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={handlePrintSelectedLabels}
              disabled={printing || selectedItemsList.length === 0}
              title={selectedItemsList.length === 0 ? 'Seleccioná artículos para habilitar la impresión.' : 'Imprime una etiqueta de 10 × 10 cm por cada artículo seleccionado.'}
            >
              {printing ? 'Preparando impresión…' : 'Imprimir etiquetas 10 × 10'}
            </button>
          </div>
        </div>
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
              Seleccionados: <strong>{selectedItemsList.length}</strong>
            </span>
            <p style={{ margin: '0.15rem 0 0', color: '#64748b', fontSize: '0.78rem' }}>
              Podés marcar uno o varios artículos para descargar el PDF o imprimir etiquetas de forma normal.
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
                  <th>Seleccionar</th>
                  <th>EAN13</th>
                  <th>Artículo</th>
                  {includeSkuInPdf && <th>SKU</th>}
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
                          title="Seleccionar esta línea para PDF o impresión"
                          aria-label={`Seleccionar ${item.code || 'artículo'} para PDF o impresión`}
                        />
                      </td>
                      <td>{buildItemEan13(item.sku, item.unitsPerBox) || '-'}</td>
                      <td>{item.code}</td>
                      {includeSkuInPdf && <td>{item.sku || '-'}</td>}
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
                    <td colSpan={includeSkuInPdf ? 6 : 5} style={{ textAlign: 'center', padding: '1.5rem 0' }}>
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
