import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';
import { buildItemEan13, buildLegacyItemEan13 } from '../../utils/ean13.js';
import { ensureQuantity, formatQuantity } from '../../utils/quantity.js';
import { MOVEMENT_TYPE_BADGE_CLASS, MOVEMENT_TYPE_LABELS, resolveMovementType, locationTypeSuffix } from '../../utils/movements.js';

const SCAN_MODE_OPTIONS = [
  { value: 'boxes', label: 'Cajas' },
  { value: 'units', label: 'Unidades' }
];

const ORIGIN_PRIORITY = [
  'Guadalupe',
  'Justicia',
  'Arnavia',
  'Flex',
  'Sobrestock Arenal Import',
  'Sobrestock Thibe',
  'Sobrestock General',
  'Sobrestock Thibe Kids'
];

function normalizeLocation(location) {
  const rawId = location?.id || location?._id;
  return {
    id: rawId && typeof rawId === 'object' && typeof rawId.toString === 'function' ? rawId.toString() : rawId || '',
    name: location?.name || '',
    type: location?.type || 'warehouse',
    status: location?.status || 'active'
  };
}

function normalizeBarcodeValue(value) {
  return typeof value === 'string' ? value.replace(/\s+/g, '').trim() : '';
}

function getBarcodeSearchValues(value) {
  const normalized = normalizeBarcodeValue(value);
  if (!normalized) {
    return [];
  }
  const digits = normalized.replace(/\D/g, '');
  return Array.from(
    new Set([
      normalized,
      digits.length === 12 ? `0${digits}` : null
    ].filter(Boolean))
  );
}

function normalizeItem(item) {
  return {
    id: item?.id || item?._id || '',
    code: item?.code || '',
    sku: item?.sku || '',
    internalBarcode: item?.internalBarcode || buildItemEan13(item?.sku),
    internalBarcodes: Array.isArray(item?.internalBarcodes)
      ? item.internalBarcodes
      : [item?.internalBarcode, buildItemEan13(item?.sku), buildLegacyItemEan13(item?.sku)].filter(Boolean),
    description: item?.description || '',
    stock: item?.stock || {}
  };
}

function compareLocationsByRequestPriority(a, b) {
  const priorityMap = new Map(ORIGIN_PRIORITY.map((name, index) => [name.toLowerCase(), index]));
  const aName = (a.name || '').toLowerCase();
  const bName = (b.name || '').toLowerCase();
  const aPriority = priorityMap.has(aName) ? priorityMap.get(aName) : Number.MAX_SAFE_INTEGER;
  const bPriority = priorityMap.has(bName) ? priorityMap.get(bName) : Number.MAX_SAFE_INTEGER;
  if (aPriority !== bPriority) {
    return aPriority - bPriority;
  }
  return (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' });
}

function getWarehouseStockEntries(item, locations) {
  if (!item?.stock || !Array.isArray(locations)) {
    return [];
  }
  const locationMap = new Map(locations.map(location => [String(location.id), location]));
  return Object.entries(item.stock)
    .map(([locationId, quantity]) => {
      const normalized = ensureQuantity(quantity);
      if (normalized.boxes === 0 && normalized.units === 0) return null;
      const location = locationMap.get(String(locationId));
      if (location?.type && location.type !== 'warehouse') return null;
      return {
        locationId,
        locationName: location?.name || `Depósito ${String(locationId).slice(-4)}`,
        locationType: location?.type || null,
        quantity: normalized
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.locationName.localeCompare(b.locationName, 'es', { sensitivity: 'base' }));
}

function quantityLabel(quantity = {}) {
  const boxes = Number(quantity.boxes) || 0;
  const units = Number(quantity.units) || 0;
  const parts = [];
  if (boxes > 0) parts.push(`${boxes} caja${boxes === 1 ? '' : 's'}`);
  if (units > 0) parts.push(`${units} unidad${units === 1 ? '' : 'es'}`);
  return parts.length > 0 ? parts.join(' y ') : 'Sin cantidad';
}

export default function BarcodeReceptionPage() {
  const api = useApi();
  const { user } = useAuth();
  const permissions = useMemo(() => user?.permissions || [], [user]);
  const canRequest = permissions.includes('stock.request');
  const hasRestrictedRequesterRole = ['Operador', 'Supervisor'].includes(user?.role);
  const hasRequesterRestrictions = hasRestrictedRequesterRole && canRequest;

  const scannerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState([]);
  const [originLocationId, setOriginLocationId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [scanMode, setScanMode] = useState('boxes');
  const [scanValue, setScanValue] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState([]);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [scanMessage, setScanMessage] = useState('');
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [lineSearchTerm, setLineSearchTerm] = useState('');
  const [lineItemFilter, setLineItemFilter] = useState('');

  const activeLocations = useMemo(
    () => locations.filter(location => location.status !== 'inactive'),
    [locations]
  );
  const requestOrigins = useMemo(
    () => activeLocations
      .filter(location => (hasRequesterRestrictions ? location.type === 'warehouse' : ['warehouse', 'externalOrigin'].includes(location.type)))
      .slice()
      .sort(compareLocationsByRequestPriority),
    [activeLocations, hasRequesterRestrictions]
  );
  const requestDestinations = useMemo(
    () => activeLocations.filter(location => ['warehouse', 'external'].includes(location.type)),
    [activeLocations]
  );
  const selectedOrigin = useMemo(() => locations.find(location => location.id === originLocationId), [locations, originLocationId]);
  const selectedDestination = useMemo(() => locations.find(location => location.id === destinationLocationId), [locations, destinationLocationId]);
  const currentMovementType = useMemo(() => {
    if (!selectedOrigin || !selectedDestination) return null;
    return resolveMovementType({ fromType: selectedOrigin.type, toType: selectedDestination.type });
  }, [selectedDestination, selectedOrigin]);

  useEffect(() => {
    const originOptions = requestOrigins;
    const destinationOptions = requestDestinations;
    if (originOptions.length > 0 && !originOptions.some(location => location.id === originLocationId)) {
      setOriginLocationId(originOptions[0].id);
    }
    if (destinationOptions.length > 0 && !destinationOptions.some(location => location.id === destinationLocationId)) {
      setDestinationLocationId(destinationOptions[0].id);
    }
  }, [destinationLocationId, originLocationId, requestDestinations, requestOrigins]);

  const focusScanner = useCallback(() => {
    window.setTimeout(() => scannerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    let active = true;
    const loadLocations = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await api.get('/stock/locations');
        if (!active) return;
        const normalized = Array.isArray(response)
          ? response.map(normalizeLocation).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
          : [];
        setLocations(normalized);
        const activeNormalized = normalized.filter(location => location.status !== 'inactive');
        const firstOrigin = activeNormalized
          .filter(location => (hasRequesterRestrictions ? location.type === 'warehouse' : ['warehouse', 'externalOrigin'].includes(location.type)))
          .sort(compareLocationsByRequestPriority)[0];
        const firstDestination = activeNormalized.find(location => ['warehouse', 'external'].includes(location.type));
        setOriginLocationId(firstOrigin?.id || '');
        setDestinationLocationId(firstDestination?.id || '');
      } catch (err) {
        if (active) setError(err);
      } finally {
        if (active) setLoading(false);
      }
    };
    loadLocations();
    return () => {
      active = false;
    };
  }, [api, hasRequesterRestrictions]);

  useEffect(() => {
    if (!loading) {
      focusScanner();
    }
  }, [focusScanner, loading]);

  const addScannedItem = useCallback(
    item => {
      const normalizedItem = normalizeItem(item);
      const quantityIncrement = scanMode === 'boxes' ? { boxes: 1, units: 0 } : { boxes: 0, units: 1 };
      setLines(prev => {
        const existingIndex = prev.findIndex(line => line.itemId === normalizedItem.id);
        if (existingIndex === -1) {
          return [
            {
              itemId: normalizedItem.id,
              code: normalizedItem.code,
              description: normalizedItem.description,
              quantity: quantityIncrement,
              scans: 1,
              stock: normalizedItem.stock
            },
            ...prev
          ];
        }
        return prev.map((line, index) =>
          index === existingIndex
            ? {
                ...line,
                quantity: {
                  boxes: (Number(line.quantity.boxes) || 0) + quantityIncrement.boxes,
                  units: (Number(line.quantity.units) || 0) + quantityIncrement.units
                },
                scans: (Number(line.scans) || 0) + 1,
                stock: normalizedItem.stock || line.stock
              }
            : line
        );
      });
      setSuccessMessage('');
      setScanMessage(`${normalizedItem.code} agregado: +1 ${scanMode === 'boxes' ? 'caja' : 'unidad'}.`);
    },
    [scanMode]
  );

  const findItemByBarcode = useCallback(async barcode => {
    const searchValues = getBarcodeSearchValues(barcode);
    const responses = await Promise.all(searchValues.map(value => api.get('/stock/items', { query: { search: value, limit: 10 } })));
    const matches = responses.flatMap(response => (Array.isArray(response) ? response : []));
    const scannedValues = searchValues.map(value => value.toLowerCase());
    const getMatchScore = item => {
      const code = normalizeBarcodeValue(item.code).toLowerCase();
      const sku = normalizeBarcodeValue(item.sku).toLowerCase();
      const currentInternalBarcode = normalizeBarcodeValue(item.internalBarcode || buildItemEan13(item.sku)).toLowerCase();
      const legacyInternalBarcode = normalizeBarcodeValue(buildLegacyItemEan13(item.sku)).toLowerCase();
      const returnedBarcodes = (Array.isArray(item.internalBarcodes) ? item.internalBarcodes : [])
        .map(value => normalizeBarcodeValue(value).toLowerCase());
      if (scannedValues.includes(code) || scannedValues.includes(sku)) return 4;
      if (scannedValues.includes(legacyInternalBarcode)) return 3;
      if (scannedValues.includes(currentInternalBarcode)) return 2;
      if (returnedBarcodes.some(barcodeValue => scannedValues.includes(barcodeValue))) return 1;
      return 0;
    };
    return matches
      .map(item => ({ item, score: getMatchScore(item) }))
      .filter(match => match.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.item || null;
  }, [api]);

  const handleScan = useCallback(async () => {
    const normalizedCode = normalizeBarcodeValue(scanValue);
    if (!normalizedCode || scanning) {
      return;
    }
    setScanning(true);
    setError(null);
    setScanMessage('');
    try {
      const exactMatch = await findItemByBarcode(normalizedCode);
      if (!exactMatch) {
        setScanMessage(`No se encontró un artículo activo con el código ${normalizedCode}.`);
        return;
      }
      addScannedItem(exactMatch);
    } catch (err) {
      setError(err);
    } finally {
      setScanValue('');
      setScanning(false);
      focusScanner();
    }
  }, [addScannedItem, findItemByBarcode, focusScanner, scanValue, scanning]);

  const handleScannerKeyDown = event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleScan();
    }
  };


  const handleQuantityChange = (itemId, field, value) => {
    if (value !== '') {
      const numeric = Number(value);
      if (!Number.isFinite(numeric) || numeric < 0) return;
    }
    setLines(prev =>
      prev.map(line =>
        line.itemId === itemId
          ? { ...line, quantity: { ...line.quantity, [field]: value === '' ? '' : Math.trunc(Number(value)) } }
          : line
      )
    );
  };

  const handleRemoveLine = itemId => {
    setLines(prev => prev.filter(line => line.itemId !== itemId));
    focusScanner();
  };

  const totalScans = useMemo(() => lines.reduce((sum, line) => sum + (Number(line.scans) || 0), 0), [lines]);
  const filteredLineOptions = useMemo(() => {
    const search = lineSearchTerm.trim().toLowerCase();
    return lines.filter(line => {
      if (!search) return true;
      return [line.code, line.description].some(value => String(value || '').toLowerCase().includes(search));
    });
  }, [lineSearchTerm, lines]);
  const visibleLines = useMemo(
    () => filteredLineOptions.filter(line => !lineItemFilter || line.itemId === lineItemFilter),
    [filteredLineOptions, lineItemFilter]
  );


  const handleConfirm = async () => {
    if (saving) return;
    if (!canRequest) return;
    if (!originLocationId || !destinationLocationId) {
      setError(new Error('Seleccioná un origen externo y un destino.'));
      return;
    }
    const payloadLines = lines
      .map(line => ({
        itemId: line.itemId,
        quantity: {
          boxes: Number(line.quantity.boxes) || 0,
          units: Number(line.quantity.units) || 0
        }
      }))
      .filter(line => line.quantity.boxes > 0 || line.quantity.units > 0);
    if (payloadLines.length === 0) {
      setError(new Error('Escaneá al menos un artículo con cantidad mayor a cero.'));
      return;
    }
    setSaving(true);
    setError(null);
    setSuccessMessage('');
    try {
      if (originLocationId === destinationLocationId) {
        throw new Error('La ubicación de origen y destino no pueden ser la misma.');
      }
      if (hasRequesterRestrictions) {
        const isFromWarehouse = selectedOrigin?.type === 'warehouse';
        const isToAllowed = ['warehouse', 'external'].includes(selectedDestination?.type);
        if (!isFromWarehouse || !isToAllowed) {
          throw new Error('Como operador o supervisor solo puede solicitar desde depósitos internos hacia depósitos internos o externos.');
        }
      }
      await Promise.all(payloadLines.map(line => api.post('/stock/request', {
        itemId: line.itemId,
        fromLocation: originLocationId,
        toLocation: destinationLocationId,
        quantity: line.quantity,
        reason
      })));
      setSuccessMessage(`Solicitudes registradas: ${payloadLines.length} artículo(s).`);
      setLines([]);
      setLineSearchTerm('');
      setLineItemFilter('');
      setScanValue('');
      setReason('');
      setScanMessage('Listo para escanear la próxima operación.');
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
      focusScanner();
    }
  };

  if (loading) {
    return <LoadingIndicator message="Cargando recepción por códigos…" />;
  }

  if (!canRequest) {
    return (
      <div className="section-card">
        <h2>Movimientos por códigos de barra</h2>
        <ErrorMessage error="Necesitás permiso de solicitud de stock para operar con códigos de barra." />
      </div>
    );
  }

  return (
    <div className="barcode-reception-page">
      <div className="flex-between">
        <div>
          <h2>Movimientos por códigos de barra</h2>
          <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
            Seleccioná el destino y escaneá cajas o unidades. Cada lectura suma 1 al artículo encontrado.
          </p>
        </div>
        <span className="badge">Lecturas: {totalScans}</span>
      </div>

      {error && <ErrorMessage error={error} />}
      {successMessage && <div className="success-message">{successMessage}</div>}

      <div className="section-card">
        <h3>Nueva solicitud por código</h3>
        <div className="form-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          <div className="input-group">
            <label htmlFor="barcodeScan">Código de barra *</label>
            <input
              id="barcodeScan"
              ref={scannerRef}
              value={scanValue}
              onChange={event => setScanValue(event.target.value)}
              onKeyDown={handleScannerKeyDown}
              autoComplete="off"
              inputMode="none"
              placeholder="Escaneá o ingresá el código"
              disabled={scanning || saving}
              style={{ marginBottom: '0.5rem' }}
            />
            <div className="inline-actions" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
              <button type="button" className="secondary-button" onClick={handleScan} disabled={scanning || saving || !scanValue.trim()}>
                {scanning ? 'Buscando…' : 'Agregar lectura'}
              </button>
              <button type="button" className="secondary-button" onClick={focusScanner}>Enfocar lector</button>
            </div>
            <p className="input-helper">La lectora debe enviar Enter al finalizar; cada lectura suma 1 caja o unidad.</p>
            {scanMessage && <p className="barcode-scan-message">{scanMessage}</p>}
          </div>
          <div className="input-group">
            <label htmlFor="originLocationId">Ubicación origen *</label>
            <select id="originLocationId" value={originLocationId} onChange={event => setOriginLocationId(event.target.value)}>
              <option value="">Seleccione origen</option>
              {requestOrigins.map(location => (
                <option key={location.id} value={location.id}>{location.name}{locationTypeSuffix(location.type)}</option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="destinationLocationId">Ubicación destino *</label>
            <select id="destinationLocationId" value={destinationLocationId} onChange={event => setDestinationLocationId(event.target.value)}>
              <option value="">Seleccione destino</option>
              {requestDestinations.map(location => (
                <option key={location.id} value={location.id}>{location.name}{locationTypeSuffix(location.type)}</option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="scanMode">Cada lectura suma</label>
            <div className="quantity-with-flag">
              <select id="scanMode" value={scanMode} onChange={event => setScanMode(event.target.value)}>
                {SCAN_MODE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {currentMovementType && (
                <span className={`badge ${MOVEMENT_TYPE_BADGE_CLASS[currentMovementType] || MOVEMENT_TYPE_BADGE_CLASS.transfer}`}>
                  {MOVEMENT_TYPE_LABELS[currentMovementType]}
                </span>
              )}
            </div>
          </div>
          <div className="input-group" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="reason">Motivo</label>
            <textarea id="reason" value={reason} onChange={event => setReason(event.target.value)} rows={2} placeholder="Opcional" />
          </div>
          <div className="inline-actions" style={{ gridColumn: '1 / -1' }}>
            <button type="button" disabled={lines.length === 0 || saving} onClick={handleConfirm}>
              {saving ? 'Confirmando…' : 'Registrar solicitudes'}
            </button>
            <button type="button" className="secondary-button" disabled={lines.length === 0 || saving} onClick={() => setLines([])}>
              Vaciar lecturas
            </button>
          </div>
        </div>
      </div>

      <div className="section-card">
        <div className="flex-between">
          <h3>Solicitudes registradas</h3>
          <div className="inline-actions" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
            <div className="input-group" style={{ minWidth: '220px' }}>
              <label htmlFor="lineFilterSearch">Buscar artículo</label>
              <input
                id="lineFilterSearch"
                type="search"
                placeholder="Código o descripción"
                value={lineSearchTerm}
                onChange={event => {
                  setLineSearchTerm(event.target.value);
                  setLineItemFilter('');
                }}
              />
            </div>
            <div className="input-group" style={{ minWidth: '220px' }}>
              <label htmlFor="lineItemFilter">Artículo</label>
              <select id="lineItemFilter" value={lineItemFilter} onChange={event => setLineItemFilter(event.target.value)}>
                <option value="">Todos</option>
                {filteredLineOptions.map(line => (
                  <option key={line.itemId} value={line.itemId}>
                    {line.code} · {line.description}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        {lines.length === 0 ? (
          <p style={{ color: '#64748b' }}>Todavía no hay artículos escaneados.</p>
        ) : visibleLines.length === 0 ? (
          <p style={{ color: '#64748b' }}>No hay lecturas registradas con el filtro seleccionado.</p>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Artículo</th>
                  <th>Cajas</th>
                  <th>Unidades</th>
                  <th>Lecturas</th>
                  <th>Stock disponible</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibleLines.map(line => (
                  <tr key={line.itemId}>
                    <td>{line.code}</td>
                    <td>{line.description}</td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        value={line.quantity.boxes}
                        onChange={event => handleQuantityChange(line.itemId, 'boxes', event.target.value)}
                        style={{ maxWidth: '90px' }}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        value={line.quantity.units}
                        onChange={event => handleQuantityChange(line.itemId, 'units', event.target.value)}
                        style={{ maxWidth: '90px' }}
                      />
                    </td>
                    <td>{line.scans}</td>
                    <td>
                      {getWarehouseStockEntries(line, locations).length > 0 ? (
                        <ul className="stock-summary-list stock-summary-list--compact">
                          {getWarehouseStockEntries(line, locations).map(entry => (
                            <li key={entry.locationId} className="stock-summary-item">
                              <span className="stock-summary-location">
                                {entry.locationName}
                                {locationTypeSuffix(entry.locationType)}
                              </span>
                              <span className="stock-summary-quantity">{formatQuantity(entry.quantity)}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>Sin stock registrado</span>
                      )}
                    </td>
                    <td>
                      <div className="inline-actions">
                        <span className="badge">{quantityLabel(line.quantity)}</span>
                        <button type="button" className="danger-button" onClick={() => handleRemoveLine(line.itemId)}>Quitar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
