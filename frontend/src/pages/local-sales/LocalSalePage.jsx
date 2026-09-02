import { useRef, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import ErrorMessage from '../../components/ErrorMessage.jsx';

export default function LocalSalePage() {
  const api = useApi();
  const searchRef = useRef(null);
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [authorization, setAuthorization] = useState(null);
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState([]);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const hasInvalidQuantities = lines.some(line => {
    const quantity = Number(line.quantity);
    return line.quantity === '' || !Number.isInteger(quantity) || quantity < 1 || quantity > line.availableUnits;
  });

  const authorize = async event => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const response = await api.post('/local-sales/authorize', credentials);
      setAuthorization(response);
      setSelectedLocationId(response.location?.id || '');
      setCredentials({ username: '', password: '' });
      setTimeout(() => searchRef.current?.focus(), 0);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  const addItem = async event => {
    event.preventDefault();
    const value = search.trim(); if (!value) return;
    setBusy(true); setError(null); setMessage('');
    try {
      const items = await api.get('/local-sales/items', {
        query: { search: value, locationId: selectedLocationId },
        headers: { 'X-Local-Sale-Token': authorization.saleToken, 'X-Local-Sale-Location': selectedLocationId }
      });
      if (!items?.length) throw new Error('No se encontró un artículo con ese código o SKU.');
      const item = items[0];
      setLines(current => {
        const existing = current.find(line => line.itemId === item.id);
        return existing
          ? current.map(line => {
              if (line.itemId !== item.id) return line;
              const currentQuantity = Number(line.quantity);
              return {
                ...line,
                quantity: Number.isInteger(currentQuantity) && currentQuantity >= 1 ? currentQuantity + 1 : 1,
                availableUnits: item.availableUnits
              };
            })
          : [...current, { itemId: item.id, code: item.code, description: item.description, availableUnits: item.availableUnits, quantity: 1 }];
      });
      setSearch('');
    } catch (err) { setError(err); } finally { setBusy(false); searchRef.current?.focus(); }
  };

  const confirmSale = async () => {
    if (!lines.length) return;
    if (hasInvalidQuantities) {
      setError(new Error('Todas las cantidades son obligatorias y deben ser números enteros mayores a cero, sin superar el stock disponible.'));
      return;
    }
    setBusy(true); setError(null); setMessage('');
    try {
      const result = await api.post('/local-sales', { saleToken: authorization.saleToken, locationId: selectedLocationId, lines: lines.map(({ itemId, quantity }) => ({ itemId, quantity })) });
      const skipped = result.lines.filter(line => line.shopifyStatus !== 'synced').length;
      setMessage(skipped ? `Venta registrada. Stock interno actualizado; ${skipped} artículo(s) no se sincronizaron con Shopify.` : 'Venta registrada y sincronizada con Shopify.');
      setLines([]);
    } catch (err) {
      if (err.status === 401 || err.status === 403) setAuthorization(null);
      setError(err);
    } finally { setBusy(false); }
  };

  if (!authorization) return (
    <div className="section-card local-sale-login">
      <h2>Venta desde Local</h2>
      <p>Ingresá la credencial habilitada para identificar el local.</p>
      {error && <ErrorMessage error={error} />}
      <form className="form-grid" onSubmit={authorize}>
        <div className="input-group"><label htmlFor="sale-user">Usuario</label><input id="sale-user" value={credentials.username} onChange={event => setCredentials(value => ({ ...value, username: event.target.value }))} required autoFocus /></div>
        <div className="input-group"><label htmlFor="sale-password">Contraseña</label><input id="sale-password" type="password" value={credentials.password} onChange={event => setCredentials(value => ({ ...value, password: event.target.value }))} required /></div>
        <div><button disabled={busy}>{busy ? 'Validando...' : 'Ingresar'}</button></div>
      </form>
    </div>
  );

  if (!selectedLocationId) return (
    <div className="section-card local-sale-login">
      <h2>Seleccionar local</h2>
      <p>Esta credencial puede registrar ventas en todos los locales. Elegí desde cuál vas a operar.</p>
      <div className="input-group">
        <label htmlFor="sale-location">Local</label>
        <select id="sale-location" value={selectedLocationId} onChange={event => setSelectedLocationId(event.target.value)} autoFocus>
          <option value="">Seleccione local</option>
          {authorization.locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
      </div>
      <div className="inline-actions"><button className="secondary-button" onClick={() => setAuthorization(null)}>Volver</button></div>
    </div>
  );

  const selectedLocation = authorization.locations.find(location => location.id === selectedLocationId);

  return <div>
    <div className="page-title-row"><div><h2>Venta desde Local</h2><p><strong>{selectedLocation?.name}</strong> · {authorization.user.username}</p></div><div className="inline-actions">{authorization.allLocations && <button className="secondary-button" onClick={() => { setSelectedLocationId(''); setLines([]); }}>Cambiar local</button>}<button className="secondary-button" onClick={() => { setAuthorization(null); setSelectedLocationId(''); setLines([]); }}>Cambiar usuario</button></div></div>
    {error && <ErrorMessage error={error} />}{message && <div className="success-message">{message}</div>}
    <div className="section-card">
      <form className="inline-actions" onSubmit={addItem}>
        <div className="input-group local-sale-search"><label htmlFor="sale-search">Código de barras, código de artículo o SKU</label><input id="sale-search" ref={searchRef} value={search} onChange={event => setSearch(event.target.value)} placeholder="Escaneá o escribí el código y presioná Enter" autoFocus /></div>
        <button disabled={busy}>Agregar</button>
      </form>
    </div>
    <div className="section-card"><h3>Artículos de la venta</h3><div className="table-wrapper"><table><thead><tr><th>Código</th><th>Artículo</th><th>Disponible</th><th>Cantidad</th><th></th></tr></thead><tbody>
      {lines.map(line => <tr key={line.itemId}><td>{line.code}</td><td>{line.description}</td><td>{line.availableUnits}</td><td><input className="quantity-input" type="number" min="1" max={line.availableUnits} step="1" required value={line.quantity} placeholder="Cantidad" onChange={event => { const nextQuantity = event.target.value; setLines(current => current.map(value => value.itemId === line.itemId ? { ...value, quantity: nextQuantity === '' ? '' : Number(nextQuantity) } : value)); }} /></td><td><button className="danger-button" onClick={() => setLines(current => current.filter(value => value.itemId !== line.itemId))}>Quitar</button></td></tr>)}
      {!lines.length && <tr><td colSpan="5" style={{ textAlign: 'center' }}>Todavía no agregaste artículos.</td></tr>}
    </tbody></table></div><div className="local-sale-confirm"><button disabled={busy || !lines.length || hasInvalidQuantities} onClick={confirmSale}>{busy ? 'Procesando...' : 'Confirmar venta'}</button></div></div>
  </div>;
}
