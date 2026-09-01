import { useRef, useState } from 'react';
import useApi from '../../hooks/useApi.js';
import ErrorMessage from '../../components/ErrorMessage.jsx';

export default function LocalSalePage() {
  const api = useApi();
  const searchRef = useRef(null);
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [authorization, setAuthorization] = useState(null);
  const [search, setSearch] = useState('');
  const [lines, setLines] = useState([]);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const authorize = async event => {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      const response = await api.post('/local-sales/authorize', credentials);
      setAuthorization(response); setCredentials({ username: '', password: '' });
      setTimeout(() => searchRef.current?.focus(), 0);
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  const addItem = async event => {
    event.preventDefault();
    const value = search.trim(); if (!value) return;
    setBusy(true); setError(null); setMessage('');
    try {
      const items = await api.get('/local-sales/items', { query: { search: value }, headers: { 'X-Local-Sale-Token': authorization.saleToken } });
      if (!items?.length) throw new Error('No se encontró un artículo con ese código o SKU.');
      const item = items[0];
      setLines(current => {
        const existing = current.find(line => line.itemId === item.id);
        return existing
          ? current.map(line => line.itemId === item.id ? { ...line, quantity: line.quantity + 1, availableUnits: item.availableUnits } : line)
          : [...current, { itemId: item.id, code: item.code, description: item.description, availableUnits: item.availableUnits, quantity: 1 }];
      });
      setSearch('');
    } catch (err) { setError(err); } finally { setBusy(false); searchRef.current?.focus(); }
  };

  const confirmSale = async () => {
    if (!lines.length) return;
    setBusy(true); setError(null); setMessage('');
    try {
      const result = await api.post('/local-sales', { saleToken: authorization.saleToken, lines: lines.map(({ itemId, quantity }) => ({ itemId, quantity })) });
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

  return <div>
    <div className="page-title-row"><div><h2>Venta desde Local</h2><p><strong>{authorization.location.name}</strong> · {authorization.user.username}</p></div><button className="secondary-button" onClick={() => { setAuthorization(null); setLines([]); }}>Cambiar usuario</button></div>
    {error && <ErrorMessage error={error} />}{message && <div className="success-message">{message}</div>}
    <div className="section-card">
      <form className="inline-actions" onSubmit={addItem}>
        <div className="input-group local-sale-search"><label htmlFor="sale-search">Código de barras, código de artículo o SKU</label><input id="sale-search" ref={searchRef} value={search} onChange={event => setSearch(event.target.value)} placeholder="Escaneá o escribí el código y presioná Enter" autoFocus /></div>
        <button disabled={busy}>Agregar</button>
      </form>
    </div>
    <div className="section-card"><h3>Artículos de la venta</h3><div className="table-wrapper"><table><thead><tr><th>Código</th><th>Artículo</th><th>Disponible</th><th>Cantidad</th><th></th></tr></thead><tbody>
      {lines.map(line => <tr key={line.itemId}><td>{line.code}</td><td>{line.description}</td><td>{line.availableUnits}</td><td><input className="quantity-input" type="number" min="1" max={line.availableUnits} value={line.quantity} onChange={event => setLines(current => current.map(value => value.itemId === line.itemId ? { ...value, quantity: Number(event.target.value) } : value))} /></td><td><button className="danger-button" onClick={() => setLines(current => current.filter(value => value.itemId !== line.itemId))}>Quitar</button></td></tr>)}
      {!lines.length && <tr><td colSpan="5" style={{ textAlign: 'center' }}>Todavía no agregaste artículos.</td></tr>}
    </tbody></table></div><div className="local-sale-confirm"><button disabled={busy || !lines.length || lines.some(line => line.quantity < 1 || line.quantity > line.availableUnits)} onClick={confirmSale}>{busy ? 'Procesando...' : 'Confirmar venta'}</button></div></div>
  </div>;
}
