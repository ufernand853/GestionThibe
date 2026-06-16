import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import LoadingIndicator from '../../components/LoadingIndicator.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';
import { buildItemEan13, buildLegacyItemEan13 } from '../../utils/ean13.js';

const SCAN_MODE_OPTIONS = [
  { value: 'boxes', label: 'Cajas' },
  { value: 'units', label: 'Unidades' }
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
  const canReceive = permissions.includes('stock.approve');

  const scannerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState([]);
  const [originLocationId, setOriginLocationId] = useState('');
  const [destinationLocationId, setDestinationLocationId] = useState('');
  const [scanMode, setScanMode] = useState('boxes');
  const [scanValue, setScanValue] = useState('');
  const [lines, setLines] = useState([]);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [scanMessage, setScanMessage] = useState('');
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);

  const activeOrigins = useMemo(
    () => locations.filter(location => location.type === 'externalOrigin' && location.status !== 'inactive'),
    [locations]
  );
  const activeWarehouses = useMemo(
    () => locations.filter(location => location.type === 'warehouse' && location.status !== 'inactive'),
    [locations]
  );

  const focusScanner = useCallback(() => {
    window.setTimeout(() => scannerRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    let active = true;
    const loadLocations = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await api.get('/locations');
        if (!active) return;
        const normalized = Array.isArray(response)
          ? response.map(normalizeLocation).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
          : [];
        setLocations(normalized);
        const firstOrigin = normalized.find(location => location.type === 'externalOrigin' && location.status !== 'inactive');
        const firstWarehouse = normalized.find(location => location.type === 'warehouse' && location.status !== 'inactive');
        setOriginLocationId(firstOrigin?.id || '');
        setDestinationLocationId(firstWarehouse?.id || '');
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
  }, [api]);

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
              scans: 1
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
                scans: (Number(line.scans) || 0) + 1
              }
            : line
        );
      });
      setSuccessMessage('');
      setScanMessage(`${normalizedItem.code} agregado: +1 ${scanMode === 'boxes' ? 'caja' : 'unidad'}.`);
    },
    [scanMode]
  );

  const handleScan = useCallback(async () => {
    const normalizedCode = normalizeBarcodeValue(scanValue);
    if (!normalizedCode || scanning) {
      return;
    }
    setScanning(true);
    setError(null);
    setScanMessage('');
    try {
      const response = await api.get('/stock/items', { query: { search: normalizedCode, limit: 10 } });
      const matches = Array.isArray(response) ? response : [];
      const scanned = normalizedCode.toLowerCase();
      const getMatchScore = item => {
        const code = normalizeBarcodeValue(item.code).toLowerCase();
        const sku = normalizeBarcodeValue(item.sku).toLowerCase();
        const currentInternalBarcode = normalizeBarcodeValue(item.internalBarcode || buildItemEan13(item.sku)).toLowerCase();
        const legacyInternalBarcode = normalizeBarcodeValue(buildLegacyItemEan13(item.sku)).toLowerCase();
        const returnedBarcodes = (Array.isArray(item.internalBarcodes) ? item.internalBarcodes : [])
          .map(value => normalizeBarcodeValue(value).toLowerCase());
        if (code === scanned || sku === scanned) return 4;
        if (legacyInternalBarcode === scanned) return 3;
        if (currentInternalBarcode === scanned) return 2;
        if (returnedBarcodes.includes(scanned)) return 1;
        return 0;
      };
      const exactMatch = matches
        .map(item => ({ item, score: getMatchScore(item) }))
        .filter(match => match.score > 0)
        .sort((a, b) => b.score - a.score)[0]?.item;
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
  }, [addScannedItem, api, focusScanner, scanValue, scanning]);

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

  const handleConfirm = async () => {
    if (!canReceive || saving) return;
    if (!originLocationId || !destinationLocationId) {
      setError(new Error('Seleccioná un origen externo y un depósito destino.'));
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
      const response = await api.post('/stock/barcode-reception', {
        fromLocation: originLocationId,
        toLocation: destinationLocationId,
        lines: payloadLines
      });
      setSuccessMessage(`Recepción confirmada: ${response.lines?.length || payloadLines.length} artículo(s) ingresados.`);
      setLines([]);
      setScanValue('');
      setScanMessage('Listo para escanear la próxima recepción.');
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

  if (!canReceive) {
    return (
      <div className="section-card">
        <h2>Recepción por códigos de barra</h2>
        <ErrorMessage error="Necesitás permiso de aprobación de stock para confirmar recepciones." />
      </div>
    );
  }

  return (
    <div className="barcode-reception-page">
      <div className="flex-between">
        <div>
          <h2>Recepción por códigos de barra</h2>
          <p style={{ color: '#475569', marginTop: '-0.4rem' }}>
            Seleccioná el depósito destino y escaneá cajas o unidades. Cada lectura suma 1 al artículo encontrado.
          </p>
        </div>
        <span className="badge">Lecturas: {totalScans}</span>
      </div>

      {error && <ErrorMessage error={error} />}
      {successMessage && <div className="success-message">{successMessage}</div>}

      <div className="section-card">
        <div className="form-grid form-grid--spaced">
          <div className="input-group">
            <label htmlFor="originLocationId">Origen</label>
            <select id="originLocationId" value={originLocationId} onChange={event => setOriginLocationId(event.target.value)}>
              <option value="">Seleccionar origen</option>
              {activeOrigins.map(location => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
            <p className="input-helper">Usá una ubicación de tipo “Origen externo”.</p>
          </div>
          <div className="input-group">
            <label htmlFor="destinationLocationId">Depósito destino</label>
            <select id="destinationLocationId" value={destinationLocationId} onChange={event => setDestinationLocationId(event.target.value)}>
              <option value="">Seleccionar depósito</option>
              {activeWarehouses.map(location => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
          </div>
          <div className="input-group">
            <label htmlFor="scanMode">Cada lectura suma</label>
            <select id="scanMode" value={scanMode} onChange={event => setScanMode(event.target.value)}>
              {SCAN_MODE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="section-card barcode-scan-card">
        <div className="input-group barcode-scan-input">
          <label htmlFor="barcodeScan">Código escaneado</label>
          <input
            id="barcodeScan"
            ref={scannerRef}
            value={scanValue}
            onChange={event => setScanValue(event.target.value)}
            onKeyDown={handleScannerKeyDown}
            autoComplete="off"
            inputMode="none"
            placeholder="Escaneá y presioná Enter"
            disabled={scanning || saving}
          />
          <p className="input-helper">La lectora Bluetooth debe estar configurada como teclado y enviar Enter al finalizar.</p>
        </div>
        <div className="inline-actions">
          <button type="button" onClick={handleScan} disabled={scanning || saving || !scanValue.trim()}>
            {scanning ? 'Buscando…' : 'Agregar lectura'}
          </button>
          <button type="button" className="secondary-button" onClick={focusScanner}>Enfocar lector</button>
        </div>
        {scanMessage && <p className="barcode-scan-message">{scanMessage}</p>}
      </div>

      <div className="section-card">
        <div className="flex-between">
          <h3>Resumen de recepción</h3>
          <div className="inline-actions">
            <button type="button" className="secondary-button" disabled={lines.length === 0 || saving} onClick={() => setLines([])}>
              Vaciar
            </button>
            <button type="button" disabled={lines.length === 0 || saving} onClick={handleConfirm}>
              {saving ? 'Confirmando…' : 'Confirmar ingreso'}
            </button>
          </div>
        </div>
        {lines.length === 0 ? (
          <p style={{ color: '#64748b' }}>Todavía no hay artículos escaneados.</p>
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
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {lines.map(line => (
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
