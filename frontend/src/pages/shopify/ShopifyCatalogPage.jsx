import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import useApi from '../../hooks/useApi.js';
import { useAuth } from '../../context/AuthContext.jsx';
import ErrorMessage from '../../components/ErrorMessage.jsx';
import { API_ROOT_URL } from '../../utils/apiConfig.js';
import { fileToDataUrl } from '../../utils/fileToDataUrl.js';

const endpoint = '/shopify/catalog';
const emptyModel = { code: '', title: '', variants: [], galleries: [], boxes: [] };
const colorKey = color => color.normalize('NFC').trim().toLocaleLowerCase('es');
const splitOptions = value => [...new Map(
  String(value || '').split(/[/\-–—]/).map(value => value.trim()).filter(Boolean).map(value => [colorKey(value), value])
).values()];
const photoUrl = source => /^(?:data:image\/|https:\/\/)/i.test(source) ? source : API_ROOT_URL + '/' + source.replace(/^\/+/, '');
const modelStatus = model => model.syncError ? 'Error de sincronización' : model.pending ? 'Pendiente de enviar' : 'Borrador sincronizado';

function itemVariant(item) {
  const colors = splitOptions(item.attributes?.color);
  const sizes = splitOptions(item.attributes?.size);
  return {
    itemId: item.id,
    item,
    color: colors.length === 1 ? colors[0] : '',
    size: sizes.length === 1 ? sizes[0] : ''
  };
}

function OptionField({ variant, field, onChange }) {
  const suggestions = splitOptions(variant.item?.attributes?.[field]);
  const listId = `${variant.itemId}-${field}`;
  return (
    <>
      <input
        aria-label={`${field === 'color' ? 'Color' : 'Talle'} para ${variant.item?.sku || 'el artículo'}`}
        list={listId}
        value={variant[field]}
        onChange={event => onChange(event.target.value)}
        required
      />
      <datalist id={listId}>
        {suggestions.map(value => <option key={value} value={value} />)}
      </datalist>
    </>
  );
}

function VariantEditor({ model, update, disabled }) {
  const api = useApi();
  const [search, setSearch] = useState('');
  const [items, setItems] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  async function findItems() {
    setSearching(true);
    setError('');
    try {
      setItems(await api.get(`${endpoint}/items?search=${encodeURIComponent(search.trim())}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }

  function changeVariant(itemId, field, value) {
    update(current => ({
      ...current,
      variants: current.variants.map(row => row.itemId === itemId ? { ...row, [field]: value } : row)
    }));
  }

  function removeVariant(itemId) {
    update(current => ({
      ...current,
      variants: current.variants.filter(row => row.itemId !== itemId),
      boxes: current.boxes
        .filter(box => !box.sourceKey?.startsWith(itemId + ':'))
        .map(box => ({ ...box, quantities: box.quantities.filter(row => row.itemId !== itemId) }))
    }));
  }

  return (
    <section>
      <h3>Variantes por color y talle</h3>
      <p className="muted-text">Vinculá un artículo existente por combinación. Si el artículo tiene talles o colores separados con / o -, elegí el valor que corresponde a ese SKU.</p>
      <div className="inline-actions">
        <label>
          Buscar por código, SKU o descripción
          <input value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            if (search.trim() && !searching) findItems();
          }} />
        </label>
        <button type="button" className="secondary-button" onClick={findItems} disabled={!search.trim() || searching}>Buscar</button>
      </div>
      {error && <ErrorMessage error={error} />}
      {items.length > 0 && (
        <ul>
          {items.map(item => (
            <li key={item.id}>
              {item.sku} · {item.description}{' '}
              <button
                type="button"
                className="secondary-button"
                disabled={disabled || item.linked || model.variants.some(row => row.itemId === item.id)}
                onClick={() => update(current => ({ ...current, variants: [...current.variants, itemVariant(item)] }))}
              >
                {item.linked ? 'Vinculado a una ficha individual' : 'Agregar SKU'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="table-wrapper">
        <table>
          <thead><tr><th>SKU</th><th>Artículo</th><th>Color</th><th>Talle</th><th>Acción</th></tr></thead>
          <tbody>
            {model.variants.map(row => (
              <tr key={row.itemId}>
                <td>{row.item?.sku || 'Artículo inexistente'}</td>
                <td>{row.item?.description}{row.item?.deleted ? ' (eliminado)' : ''}</td>
                <td><OptionField variant={row} field="color" onChange={value => changeVariant(row.itemId, 'color', value)} /></td>
                <td><OptionField variant={row} field="size" onChange={value => changeVariant(row.itemId, 'size', value)} /></td>
                <td><button type="button" className="secondary-button" onClick={() => removeVariant(row.itemId)}>Quitar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function colorsFor(variants) {
  const colors = new Map();
  for (const { color } of variants) {
    if (color.trim() && !colors.has(colorKey(color))) colors.set(colorKey(color), color.trim());
  }
  return colors;
}

function GalleryEditor({ model, update, onReading }) {
  const [error, setError] = useState('');
  const confirmed = colorsFor(model.variants);
  const suggested = new Map(confirmed);
  for (const variant of model.variants) {
    for (const color of splitOptions(variant.item?.attributes?.color)) {
      if (!suggested.has(colorKey(color))) suggested.set(colorKey(color), color);
    }
  }

  function setPhoto(color, image) {
    update(current => ({
      ...current,
      galleries: [
        ...current.galleries.filter(gallery => colorKey(gallery.color) !== colorKey(color)),
        ...(image ? [{ color, images: [image] }] : [])
      ]
    }));
  }

  async function selectPhoto(color, event) {
    const [file] = event.target.files || [];
    event.target.value = '';
    if (!file) return;
    setError('');
    if (file.size > 5 * 1024 * 1024 || !/^image\/(?:jpeg|png|webp|gif)$/i.test(file.type)) {
      setError('Seleccioná una foto JPG, PNG, WebP o GIF de hasta 5 MB.');
      return;
    }
    onReading(true);
    try {
      setPhoto(color, await fileToDataUrl(file));
    } catch (err) {
      setError(err.message);
    } finally {
      onReading(false);
    }
  }

  return (
    <section>
      <h3>Fotos por color</h3>
      <p className="muted-text">Seleccioná una foto por color. Todos los talles de ese color usan la misma imagen.</p>
      {error && <ErrorMessage error={error} />}
      <div className="image-preview-grid">
        {[...suggested].map(([key, color]) => {
          const photo = model.galleries.find(row => colorKey(row.color) === key)?.images[0];
          const choices = [...new Set(model.variants
            .filter(row => colorKey(row.color) === key)
            .flatMap(row => row.item?.images || []))]
            .filter(image => /^https:\/\//i.test(image) || /^\/?uploads\/items\//i.test(image));
          return (
            <div key={key} className="image-preview-item catalog-color-photo">
              <strong>{color}</strong>
              {photo ? <img src={photoUrl(photo)} alt={`Foto del color ${color}`} /> : <span>Sin foto</span>}
              {confirmed.has(key) ? (
                <>
                  <label>
                    Seleccionar foto
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => selectPhoto(color, event)} />
                  </label>
                  {choices.length > 0 && (
                    <label>
                      Fotos del artículo
                      <select value="" onChange={event => setPhoto(color, event.target.value)}>
                        <option value="">Elegir foto existente</option>
                        {choices.map((image, index) => <option key={image} value={image}>Foto {index + 1}</option>)}
                      </select>
                    </label>
                  )}
                  {photo && <button type="button" className="secondary-button" onClick={() => setPhoto(color, null)}>Quitar foto</button>}
                </>
              ) : <span className="muted-text">Confirmá este color en una variante para cargar su foto.</span>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const maxBoxUnits = 1000000;

function ExistingBoxes({ model, update }) {
  const rows = model.variants.flatMap(variant => (variant.item?.boxStock || []).map(stock => {
    const sourceKey = variant.itemId + ':' + stock.locationId;
    const attributes = variant.item.attributes;
    const hasMixedAttributes = [attributes?.size, attributes?.color].some(value => splitOptions(value).length > 1);
    const estimate = stock.boxes * stock.unitsPerBox;
    const units = !hasMixedAttributes && stock.unitsPerBox && estimate <= maxBoxUnits ? estimate : null;
    return { variant, stock, sourceKey, units };
  }));

  function importBoxes({ variant, stock, sourceKey, units }) {
    update(current => {
      if (current.boxes.some(box => box.sourceKey === sourceKey)) return current;
      return {
        ...current,
        boxes: [...current.boxes, {
          label: (variant.item.sku + ' · ' + stock.locationName).slice(0, 100),
          opened: false,
          sourceKey,
          sourceBoxes: stock.boxes,
          quantities: units === null ? [] : [{ itemId: variant.itemId, units }]
        }]
      };
    });
  }

  if (!rows.length) return <p className="muted-text">Los SKU vinculados no tienen cajas registradas.</p>;
  return (
    <div className="table-responsive">
      <table className="data-table">
        <thead><tr><th>SKU</th><th>Ubicación</th><th>Cajas cargadas</th><th>Unidades por caja</th><th>Acción</th></tr></thead>
        <tbody>
          {rows.map(row => {
            const imported = model.boxes.some(box => box.sourceKey === row.sourceKey);
            const hasManualCount = model.boxes.some(box => !box.sourceKey &&
              box.quantities.some(quantity => quantity.itemId === row.variant.itemId && quantity.units > 0));
            return (
              <tr key={row.sourceKey}>
                <td>{row.variant.item.sku}</td>
                <td>{row.stock.locationName}</td>
                <td>{row.stock.boxes}</td>
                <td>{row.stock.unitsPerBox ?? 'Sin dato'}</td>
                <td>
                  {imported ? 'Traídas al modelo' : hasManualCount ? 'Revisá el conteo manual de este SKU antes de traer las cajas' : (
                    <button type="button" className="secondary-button" onClick={() => importBoxes(row)}>
                      {row.units === null ? 'Traer para confirmar unidades' : 'Traer cajas'}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BoxEditor({ model, update }) {
  const changeBox = (index, changes) => update(current => ({
    ...current,
    boxes: current.boxes.map((box, position) => position === index ? { ...box, ...changes } : box)
  }));
  const addBox = (quantities = []) => update(current => ({
    ...current,
    boxes: [...current.boxes, { label: '', opened: false, quantities }]
  }));

  return (
    <section>
      <h3>Cajas que respaldan el stock web</h3>
      <p className="muted-text">Podés traer las cajas registradas por SKU y ubicación. Revisá el saldo del piloto al hacer retiros o reposiciones. Si la caja es surtida, confirmá las unidades al contarla.</p>
      <ExistingBoxes model={model} update={update} />
      {model.boxes.map((box, index) => (
        <fieldset key={index}>
          <legend>{box.sourceKey ? `${box.sourceBoxes} caja(s) traídas` : `Caja ${index + 1}`}</legend>
          <div className="inline-actions">
            <label>Identificador <input required value={box.label} onChange={event => changeBox(index, { label: event.target.value })} /></label>
            <label><input type="checkbox" checked={box.opened} onChange={event => changeBox(index, { opened: event.target.checked })} /> Abierta o incompleta</label>
            {!box.sourceKey && <button type="button" className="secondary-button" onClick={() => addBox(box.quantities)}>Copiar composición</button>}
            <button type="button" className="secondary-button" onClick={() => update(current => ({ ...current, boxes: current.boxes.filter((_, position) => position !== index) }))}>Quitar caja</button>
          </div>
          {model.variants.filter(row => !box.sourceKey || box.sourceKey.startsWith(row.itemId + ':')).map(row => (
            <label key={row.itemId} className="form-field">
              {row.item?.sku} · {row.color || 'Color pendiente'} · {row.size || 'Talle pendiente'}
              <input
                type="number"
                min="0"
                max={maxBoxUnits}
                step="1"
                value={box.quantities.find(quantity => quantity.itemId === row.itemId)?.units ?? ''}
                onChange={event => changeBox(index, {
                  quantities: [
                    ...box.quantities.filter(quantity => quantity.itemId !== row.itemId),
                    { itemId: row.itemId, units: event.target.value === '' ? 0 : Number(event.target.value) }
                  ]
                })}
              />
            </label>
          ))}
        </fieldset>
      ))}
      <button type="button" className="secondary-button" onClick={() => addBox()}>Agregar caja</button>
    </section>
  );
}

function TestOrder({ order, boxes, disabled, resolve }) {
  const [source, setSource] = useState('office');
  const statusLabel = { reserved: 'Reservado', prepared: 'Preparado', cancelled: 'Cancelado' };
  return (
    <li>
      {order.sku} · {order.color} · {order.size} · {order.units} unidad(es) · {statusLabel[order.status]}
      {order.source && ` · ${order.source}`}
      {order.status === 'reserved' && (
        <div className="inline-actions">
          <label>
            Origen de prueba
            <select value={source} onChange={event => setSource(event.target.value)}>
              <option value="office">Sucursal de la oficina</option>
              <option value="branch">Otra sucursal</option>
              {boxes.map(box => <option key={box.label} value={`box:${box.label}`}>Caja {box.label}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => resolve('prepared', source)} disabled={disabled}>Confirmar preparación</button>
          <button type="button" className="secondary-button" onClick={() => resolve('cancelled')} disabled={disabled}>Cancelar reserva</button>
        </div>
      )}
    </li>
  );
}

function PilotOrders({ models, canWrite, busy, submit }) {
  const [modelId, setModelId] = useState('');
  const [itemId, setItemId] = useState('');
  const [units, setUnits] = useState('1');
  const model = models.find(row => row.id === modelId);
  const variant = model?.variants.find(row => row.itemId === itemId);

  return (
    <section>
      <h3>Pedidos online · Simulador</h3>
      <p className="muted-text">Probá reservas, preparación y cancelaciones. Elegir una caja descuenta del saldo del piloto. Una salida de sucursal se registra solo como origen de prueba.</p>
      {canWrite && models.length > 0 && (
        <form onSubmit={event => {
          event.preventDefault();
          submit(`/models/${model.id}/test-orders`, { itemId, units: Number(units), key: crypto.randomUUID() });
        }}>
          <fieldset disabled={busy}>
            <div className="inline-actions">
              <label>Modelo <select value={modelId} required onChange={event => { setModelId(event.target.value); setItemId(''); }}>
                <option value="">Seleccioná</option>
                {models.map(row => <option key={row.id} value={row.id}>{row.title}</option>)}
              </select></label>
              <label>Variante <select value={itemId} required onChange={event => setItemId(event.target.value)} disabled={!model}>
                <option value="">Seleccioná</option>
                {model?.variants.map(row => <option key={row.itemId} value={row.itemId} disabled={!row.available}>
                  {row.item?.sku} · {row.color} · {row.size} · {row.available} disponibles
                </option>)}
              </select></label>
              <label>Unidades <input type="number" min="1" max={variant?.available || 1} step="1" required value={units} onChange={event => setUnits(event.target.value)} /></label>
              <button type="submit" disabled={!variant?.available}>Reservar pedido de prueba</button>
            </div>
          </fieldset>
        </form>
      )}
      {models.filter(model => model.testOrders?.length).map(model => (
        <section key={model.id}>
          <h4>{model.title}</h4>
          <ul>
            {[...model.testOrders].reverse().map(order => (
              <TestOrder
                key={order.key}
                order={order}
                boxes={model.boxes}
                disabled={busy || !canWrite}
                resolve={(status, source) => submit(`/models/${model.id}/test-orders/${order.key}/resolve`, { status, source })}
              />
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}

export default function ShopifyCatalogPage() {
  const api = useApi();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const itemId = params.get('articulo');
  const tab = params.get('vista') || 'catalogo';
  const canWrite = user?.permissions?.includes('items.write');
  const [models, setModels] = useState([]);
  const [editing, setEditing] = useState(null);
  const [readingPhoto, setReadingPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let current = true;
    async function load() {
      setBusy(true);
      setError('');
      try {
        const saved = await api.get(`${endpoint}/models`);
        if (!current) return;
        setModels(saved);
        if (!itemId || !canWrite) return;
        const existing = saved.find(model => model.variants.some(row => row.itemId === itemId));
        if (existing) {
          setEditing(existing);
          return;
        }
        const [item] = await api.get(`${endpoint}/items?id=${encodeURIComponent(itemId)}`);
        if (!current) return;
        if (!item || item.linked) {
          setError('El artículo no está disponible para el catálogo o ya tiene una ficha individual en Shopify.');
          return;
        }
        setEditing({ ...emptyModel, title: item.description, variants: [itemVariant(item)] });
      } catch (err) {
        if (current) setError(err.message);
      } finally {
        if (current) setBusy(false);
      }
    }
    load();
    return () => { current = false; };
  }, [api, itemId, canWrite]);

  function replaceModel(model) {
    setModels(current => [...current.filter(row => row.id !== model.id), model]
      .sort((first, second) => first.title.localeCompare(second.title, 'es')));
  }

  async function save(event) {
    event.preventDefault();
    if (readingPhoto) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const colors = colorsFor(editing.variants);
      const galleries = [];
      for (const gallery of editing.galleries) {
        if (!colors.has(colorKey(gallery.color))) continue;
        const images = [];
        for (const image of gallery.images) {
          const stored = image.startsWith('data:image/')
            ? (await api.post(`${endpoint}/images`, { image })).path
            : image;
          images.push(stored);
        }
        galleries.push({ color: gallery.color, images });
      }
      const payload = {
        ...editing,
        variants: editing.variants.map(({ itemId, color, size }) => ({ itemId, color, size })),
        galleries
      };
      const model = editing.id
        ? await api.put(`${endpoint}/models/${editing.id}`, payload)
        : await api.post(`${endpoint}/models`, payload);
      replaceModel(model);
      setEditing(null);
      setMessage('Modelo guardado en GestionThibe.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function syncDraft(model) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      replaceModel(await api.post(`${endpoint}/models/${model.id}/sync-draft`, {}));
      setMessage('Borrador sincronizado en Shopify.');
    } catch (err) {
      setError(err.message);
      replaceModel({ ...model, pending: true, syncError: err.message });
    } finally {
      setBusy(false);
    }
  }

  async function submitTestOrder(path, payload) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      replaceModel(await api.post(endpoint + path, payload));
      setMessage('Pedido de prueba actualizado.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const alerts = models.flatMap(model => model.variants
    .filter(variant => variant.available === 0)
    .map(variant => ({ model, variant })));

  return (
    <div className="page-wrapper shopify-page">
      <header className="page-header">
        <h2>Shopify · Catálogo online</h2>
        <p className="muted-text">Piloto de modelos, fotos y cajas. El envío crea una ficha en borrador.</p>
        <nav className="inline-actions" aria-label="Shopify">
          <Link to="/shopify/catalogo">Catálogo online</Link>
          <Link to="/shopify/catalogo?vista=pedidos">Pedidos online</Link>
          <Link to="/shopify/catalogo?vista=alertas">Alertas de stock</Link>
          <Link to="/shopify">Integración Shopify</Link>
        </nav>
      </header>
      {error && <ErrorMessage error={error} />}
      {message && <p role="status">{message}</p>}
      {busy && <p role="status">Procesando…</p>}
      {tab === 'pedidos' ? (
        <PilotOrders models={models} canWrite={canWrite} busy={busy} submit={submitTestOrder} />
      ) : tab === 'alertas' ? (
        <section>
          <h3>Variantes del piloto sin stock</h3>
          <p className="muted-text">Disponibilidad calculada con las cajas registradas para el catálogo online.</p>
          {alerts.length === 0 ? <p>No hay variantes sin stock.</p> : (
            <ul>
              {alerts.map(({ model, variant }) => (
                <li key={variant.itemId}>{model.title} · {variant.color} · {variant.size} · {variant.item?.sku} · {modelStatus(model)}</li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          {canWrite && !editing && <button type="button" onClick={() => setEditing(emptyModel)} disabled={busy}>Nuevo modelo</button>}
          {editing && canWrite && (
            <form onSubmit={save}>
              <fieldset disabled={busy || readingPhoto}>
                <legend>{editing.id ? 'Editar modelo' : 'Nuevo modelo'}</legend>
                <div className="inline-actions">
                  <label>Código del modelo <input required maxLength={60} value={editing.code} onChange={event => setEditing({ ...editing, code: event.target.value })} /></label>
                  <label>Nombre <input required maxLength={150} value={editing.title} onChange={event => setEditing({ ...editing, title: event.target.value })} /></label>
                </div>
                <VariantEditor model={editing} update={setEditing} disabled={busy} />
                <GalleryEditor model={editing} update={setEditing} onReading={setReadingPhoto} />
                <BoxEditor model={editing} update={setEditing} />
                <div className="inline-actions">
                  <button type="submit" disabled={!editing.variants.length}>Guardar modelo</button>
                  <button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cerrar</button>
                </div>
              </fieldset>
            </form>
          )}
          {models.map(model => (
            <section key={model.id}>
              <h3>{model.code} · {model.title}</h3>
              <p>{modelStatus(model)}{model.syncError ? ` · ${model.syncError}` : ''}</p>
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>SKU</th><th>Color</th><th>Talle</th><th>Disponibles para la web</th></tr></thead>
                  <tbody>
                    {model.variants.map(row => (
                      <tr key={row.itemId}><td>{row.item?.sku || 'Artículo inexistente'}</td><td>{row.color}</td><td>{row.size}</td><td>{row.available || 'Agotado'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canWrite && (
                <div className="inline-actions">
                  <button type="button" className="secondary-button" onClick={() => setEditing(model)} disabled={busy}>Editar</button>
                  <button type="button" onClick={() => syncDraft(model)} disabled={busy || Boolean(editing)}>Enviar borrador a Shopify</button>
                </div>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
