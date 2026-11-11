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

function principalArticleCode(model) {
  return model.principal?.code || (model.variants.length === 1 ? model.variants[0].item?.code : null);
}

async function openPrincipal(api, model, item) {
  const variants = await api.get(`${endpoint}/items/${item.id}/opening`);
  return {
    ...model,
    principal: item,
    code: item.sku,
    title: model.title || item.description,
    variants: variants.map(row => ({ ...row, item }))
  };
}

function OptionField({ variant, field, onChange }) {
  const label = field === 'color' ? 'Color' : 'Talle';
  return (
    <input
      aria-label={`${label} para ${variant.item?.sku || 'el artículo'}`}
      placeholder={`Sin ${label.toLowerCase()} cargado`}
      value={variant[field]}
      readOnly={Boolean(variant.sourceItemId)}
      onChange={event => onChange(event.target.value)}
      required
    />
  );
}

function VariantEditor({ model, models, update, disabled }) {
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

  const choosingProduct = !model.id && !model.principal;

  async function chooseProduct(item) {
    setError('');
    setSearching(true);
    try {
      const existing = models.find(saved => saved.principal?.id === item.id || saved.variants.some(row => row.itemId === item.id));
      const opening = existing || await openPrincipal(api, model, item);
      update(current => current === model ? opening : current);
      setSearch('');
      setItems([]);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }

  async function expandRow(row) {
    setError('');
    if (model.boxes.some(box => box.quantities.some(quantity => quantity.itemId === row.itemId && quantity.units))) {
      setError('Antes de generar las variantes, dejá en 0 las unidades del SKU principal. Después podés repartirlas entre las variantes.');
      return;
    }
    setSearching(true);
    try {
      const options = new URLSearchParams({ color: row.color, size: row.size });
      const variants = await api.get(`${endpoint}/items/${row.itemId}/opening?${options}`);
      update(current => current === model ? ({
        ...current,
        principal: row.item,
        code: row.item.sku,
        variants: current.variants.flatMap(variant => variant.itemId === row.itemId
          ? variants.map(generated => ({ ...generated, item: row.item })) : [variant]),
        boxes: current.boxes.map(box => ({
          ...box, quantities: box.quantities.filter(quantity => quantity.itemId !== row.itemId)
        }))
      }) : current);
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
        .filter(box => !box.sourceKey || current.variants.some(row => row.itemId !== itemId &&
          box.sourceKey.startsWith((row.sourceItemId || row.itemId) + ':')))
        .map(box => ({ ...box, quantities: box.quantities.filter(row => row.itemId !== itemId) }))
    }));
  }

  return (
    <section>
      <h3 id="catalogo-variantes">{choosingProduct ? 'Elegí un producto' : 'Variantes del producto'}</h3>
      {error && <ErrorMessage error={error} />}
      {choosingProduct ? (
        <>
          <p className="muted-text">Buscá el producto que querés preparar. Podés trabajar con otro después de guardar o cerrar este.</p>
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
          {items.length > 0 && (
            <ul>
              {items.map(item => (
                <li key={item.id}>
                  <strong>SKU {item.sku}</strong> · Código {item.code} · {item.description}{' '}
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={disabled || searching}
                    onClick={() => chooseProduct(item)}
                  >
                    {item.linked ? 'Editar para Shopify' : 'Elegir producto'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="muted-text">Revisá los colores y talles de este producto. Si falta un dato, completalo acá. Quitá las combinaciones que no existen.</p>
      )}
      {!choosingProduct && <div className="table-wrapper">
        <table>
          <thead><tr><th>SKU</th><th>Artículo</th><th>Color</th><th>Talle</th><th>Acción</th></tr></thead>
          <tbody>
            {model.variants.map(row => (
              <tr key={row.itemId}>
                <td>{row.sku || 'Artículo inexistente'}{row.sourceItemId ? ' (generado)' : ''}</td>
                <td>{row.item?.description}{row.item?.deleted ? ' (eliminado)' : ''}</td>
                <td><OptionField variant={row} field="color" onChange={value => changeVariant(row.itemId, 'color', value)} /></td>
                <td><OptionField variant={row} field="size" onChange={value => changeVariant(row.itemId, 'size', value)} /></td>
                <td>
                  <div className="inline-actions">
                    {row.item && !row.sourceItemId && (model.principal?.id === row.itemId || (!model.principal && model.variants.length === 1)) &&
                      row.color.trim() && row.size.trim() && [row.color, row.size].some(value => splitOptions(value).length > 1) && (
                        <button type="button" className="secondary-button" onClick={() => expandRow(row)} disabled={searching}>Generar variantes</button>
                    )}
                    <button type="button" className="secondary-button" onClick={() => removeVariant(row.itemId)}>Quitar</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </section>
  );
}

function colorsFor(variants) {
  const colors = new Map();
  for (const { color } of variants) {
    for (const part of splitOptions(color)) {
      if (!colors.has(colorKey(part))) colors.set(colorKey(part), part);
    }
  }
  return colors;
}

function GalleryEditor({ model, update, onReading }) {
  const [error, setError] = useState('');
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
      <p className="muted-text">Si un artículo dice Blanco/Negro o Blanco-Negro, vas a ver una tarjeta para Blanco y otra para Negro. Elegí una foto en cada tarjeta. Los talles del mismo color comparten esa foto.</p>
      {error && <ErrorMessage error={error} />}
      <div className="image-preview-grid">
        {[...colorsFor(model.variants)].map(([key, color]) => {
          const photo = model.galleries.find(row => colorKey(row.color) === key)?.images[0];
          const choices = [...new Set(model.variants
            .filter(row => splitOptions(row.color).some(part => colorKey(part) === key))
            .flatMap(row => row.item?.images || []))]
            .filter(image => /^https:\/\//i.test(image) || /^\/?uploads\/items\//i.test(image));
          return (
            <div key={key} className="image-preview-item catalog-color-photo">
              <strong>{color}</strong>
              {photo ? <img src={photoUrl(photo)} alt={`Foto del color ${color}`} /> : <span>Sin foto</span>}
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
            </div>
          );
        })}
      </div>
    </section>
  );
}

const maxBoxUnits = 1000000;

function ExistingBoxes({ model, update }) {
  const stockSources = new Map(model.variants.map(variant => [variant.sourceItemId || variant.itemId, variant]));
  const rows = [...stockSources.entries()].flatMap(([sourceId, variant]) => (variant.item?.boxStock || []).map(stock => {
    const sourceKey = sourceId + ':' + stock.locationId;
    const attributes = variant.item.attributes;
    const hasMixedAttributes = [variant.size, variant.color, attributes?.size, attributes?.color].some(value => splitOptions(value).length > 1);
    const estimate = stock.boxes * stock.unitsPerBox;
    const units = !variant.sourceItemId && !hasMixedAttributes && stock.unitsPerBox && estimate <= maxBoxUnits ? estimate : null;
    return { variant, stock, sourceId, sourceKey, units };
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
              box.quantities.some(quantity => quantity.units > 0 && model.variants.some(variant => variant.itemId === quantity.itemId && (variant.sourceItemId || variant.itemId) === row.sourceId)));
            return (
              <tr key={row.sourceKey}>
                <td>{row.variant.item.sku}</td>
                <td>{row.stock.locationName}</td>
                <td>{row.stock.boxes}</td>
                <td>{row.stock.unitsPerBox ?? 'Sin dato'}</td>
                <td>
                  {imported ? 'Traídas al modelo' : hasManualCount ? 'Revisá el conteo manual de este SKU antes de traer las cajas' : (
                    <button type="button" className="secondary-button" onClick={() => importBoxes(row)}>
                      {row.units === null ? 'Traer y repartir unidades' : 'Traer cajas'}
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
  const missingOptions = model.variants.some(row => !row.color.trim() || !row.size.trim());
  const assigned = model.boxes.reduce((total, box) => total + box.quantities.reduce((sum, row) => sum + row.units, 0), 0);
  const hasSourceBoxes = model.variants.some(row => row.item?.boxStock?.length);
  const hasManualCount = model.boxes.some(box => !box.sourceKey);
  const importedSources = new Set(model.boxes.filter(box => box.sourceKey).map(box => box.sourceKey.split(':')[0]));
  const manualVariants = model.variants.filter(row =>
    !importedSources.has(row.sourceItemId || row.itemId) &&
    (!row.sourceItemId || !row.item?.unitsPerBox || row.item?.boxStock?.length)
  );
  const canCountManually = manualVariants.length > 0;

  function changeUnits(index, itemId, value) {
    update(current => ({
      ...current,
      boxes: current.boxes.map((box, position) => position === index ? {
        ...box,
        quantities: [...box.quantities.filter(row => row.itemId !== itemId), { itemId, units: Number(value) }]
      } : box)
    }));
  }

  function addManualCount() {
    update(current => {
      if (current.boxes.some(box => !box.sourceKey)) return current;
      return { ...current, boxes: [...current.boxes, { label: 'Conteo manual', opened: false, quantities: [] }] };
    });
  }

  return (
    <section className="catalog-stock">
      <h3>Stock para la tienda online</h3>
      <p><strong>Solo cambia el saldo online.</strong> El stock de Artículos y de las sucursales queda igual.</p>
      {missingOptions ? (
        <p><a href="#catalogo-variantes">Completá el color o el talle que falta arriba</a> para poder guardar el modelo.</p>
      ) : null}
      {hasSourceBoxes ? (
        <>
          <h4>Cajas registradas en GestionThibe</h4>
          <p className="muted-text">Elegí la ubicación que querés usar como respaldo y traé sus cajas al modelo.</p>
          <ExistingBoxes model={model} update={update} />
        </>
      ) : model.variants.length > 0 && (
        <p className="muted-text">
          Estos SKU no tienen cajas registradas. Podés guardar el modelo con stock cero.{' '}
          {canCountManually ? 'Si ya contaste unidades para la web, usá Cargar unidades contadas.' : 'Para asignar unidades a estas variantes, primero registrá las cajas del SKU principal en GestionThibe.'}
        </p>
      )}

      <h4>Unidades asignadas a la web · {assigned}</h4>
      {model.boxes.length > 0 && <p className="muted-text">Ingresá el total de unidades que querés ofrecer de cada variante. Si trajiste dos cajas de 12 y quedan 18 unidades, ingresá 18. Dejá 0 para las variantes que estén agotadas.</p>}
      {model.boxes.map((box, index) => {
        const variants = box.sourceKey
          ? model.variants.filter(row => box.sourceKey.startsWith((row.sourceItemId || row.itemId) + ':'))
          : model.variants.filter(row => manualVariants.includes(row) || box.quantities.some(quantity => quantity.itemId === row.itemId && quantity.units > 0));
        return (
          <fieldset key={box.sourceKey || index}>
            <legend>{box.label}{box.sourceKey ? ` · ${box.sourceBoxes} caja(s) registradas` : ''}</legend>
            <div className="table-responsive">
              <table className="data-table">
                <thead><tr><th>SKU</th><th>Color</th><th>Talle</th><th>Unidades para la web</th></tr></thead>
                <tbody>
                  {variants.map(row => (
                    <tr key={row.itemId}>
                      <td>{row.sku}</td>
                      <td>{row.color || 'Falta completar'}</td>
                      <td>{row.size || 'Falta completar'}</td>
                      <td>
                        <input
                          type="number"
                          className="quantity-input"
                          min="0"
                          max={maxBoxUnits}
                          step="1"
                          placeholder="0"
                          aria-label={`Unidades para la web de ${row.sku} en ${box.label}`}
                          value={box.quantities.find(quantity => quantity.itemId === row.itemId)?.units ?? ''}
                          onChange={event => changeUnits(index, row.itemId, event.target.value)}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(box.sourceKey || box.opened) && (
              <details>
                <summary>Detalles de las cajas</summary>
                <label>
                  <input type="checkbox" checked={box.opened} onChange={event => {
                    const opened = event.target.checked;
                    update(current => ({
                      ...current, boxes: current.boxes.map((entry, position) => position === index ? { ...entry, opened } : entry)
                    }));
                  }} />
                  Marcar como abiertas o incompletas
                </label>
                <p className="muted-text">Esta marca es informativa. Para cambiar el saldo, editá las unidades de la tabla.</p>
              </details>
            )}
            <button type="button" className="secondary-button" onClick={() => update(current => ({ ...current, boxes: current.boxes.filter((_, position) => position !== index) }))}>
              Quitar del saldo online
            </button>
          </fieldset>
        );
      })}
      {canCountManually && !hasManualCount && (
        <button type="button" className="secondary-button" onClick={addManualCount}>Cargar unidades contadas</button>
      )}
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
                  {row.sku} · {row.color} · {row.size} · {row.available} disponibles
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
  const [expandedModelId, setExpandedModelId] = useState(null);
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
        const existing = saved.find(model => model.principal?.id === itemId || model.variants.some(row => row.itemId === itemId));
        if (existing) {
          setEditing(existing);
          return;
        }
        const [item] = await api.get(`${endpoint}/items?id=${encodeURIComponent(itemId)}`);
        if (!current) return;
        if (!item) {
          setError('El artículo no está disponible para el catálogo.');
          return;
        }
        const opening = await openPrincipal(api, emptyModel, item);
        if (current) setEditing(opening);
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
      for (const variant of editing.variants) {
        if (variant.color.trim()) colors.set(colorKey(variant.color), variant.color.trim());
      }
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
        principalItemId: editing.principal?.id,
        variants: editing.variants.map(({ itemId, sourceItemId, color, size }) => ({ itemId, sourceItemId, color, size })),
        galleries
      };
      const model = editing.id
        ? await api.put(`${endpoint}/models/${editing.id}`, payload)
        : await api.post(`${endpoint}/models`, payload);
      replaceModel(model);
      setEditing(null);
      setExpandedModelId(model.id);
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

  async function deleteDraft(model) {
    if (!window.confirm(`¿Eliminar el borrador de «${model.title}» del catálogo online de GestionThibe? Esta acción no se puede deshacer.`)) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await api.delete(`${endpoint}/models/${model.id}?revision=${model.revision}`);
      setModels(current => current.filter(row => row.id !== model.id));
      setExpandedModelId(null);
      setMessage('Borrador eliminado del catálogo online.');
    } catch (err) {
      setError(err.message);
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
        <p className="muted-text">Prepará un producto por vez. Revisá sus variantes, fotos y unidades antes de enviarlo como borrador a Shopify.</p>
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
          <p className="muted-text">Acá aparecen los SKU del catálogo online cuyo saldo llegó a cero. Al reponer unidades o cancelar una reserva de prueba, el aviso se resuelve.</p>
          {alerts.length === 0 ? <p>No hay variantes sin stock.</p> : (
            <ul>
              {alerts.map(({ model, variant }) => (
                <li key={variant.itemId}>{model.title} · {variant.color} · {variant.size} · {variant.sku} · {modelStatus(model)}</li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          {canWrite && !editing && <button type="button" onClick={() => setEditing({ ...emptyModel })} disabled={busy}>Nuevo modelo</button>}
          {editing && canWrite && (
            <form onSubmit={save}>
              <fieldset disabled={busy || readingPhoto}>
                <legend>{editing.id ? 'Editar modelo' : 'Nuevo modelo'}</legend>
                {(editing.principal || editing.id) && (
                  <div className="inline-actions">
                    <label>SKU principal <input required maxLength={60} readOnly={Boolean(editing.principal)} value={editing.code} onChange={event => setEditing({ ...editing, code: event.target.value })} /></label>
                    {principalArticleCode(editing) && (
                      <label>Código de artículo <input readOnly value={principalArticleCode(editing)} /></label>
                    )}
                    <label>Nombre en Shopify <input required maxLength={150} value={editing.title} onChange={event => setEditing({ ...editing, title: event.target.value })} /></label>
                  </div>
                )}
                {editing.principal?.linked && (
                  <p className="muted-text">Este SKU ya tiene una ficha en Shopify. Podés editarlo acá. Al enviar los cambios, se usa esa misma ficha si está en borrador.</p>
                )}
                <VariantEditor model={editing} models={models} update={setEditing} disabled={busy} />
                {(editing.principal || editing.id) && <GalleryEditor model={editing} update={setEditing} onReading={setReadingPhoto} />}
                {(editing.principal || editing.id) && <BoxEditor model={editing} update={setEditing} />}
                {(editing.principal || editing.id) && <p className="muted-text">Guardá el producto para poder enviarlo como borrador a Shopify.</p>}
                <div className="inline-actions">
                  <button type="submit" disabled={!editing.variants.length}>Guardar modelo</button>
                  <button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cerrar</button>
                </div>
              </fieldset>
            </form>
          )}
          {!editing && models.length > 0 && <h3>Envío a Shopify</h3>}
          {!editing && models.map(model => (
            <details key={model.id} open={expandedModelId === model.id}>
              <summary onClick={event => {
                event.preventDefault();
                setExpandedModelId(current => current === model.id ? null : model.id);
              }}>
                SKU principal {model.principal?.sku || model.code}{principalArticleCode(model) && ` · Código ${principalArticleCode(model)}`} · {model.title} · {model.variants.length} variante(s)
              </summary>
              <p>{modelStatus(model)}{model.syncError ? ` · ${model.syncError}` : ''}</p>
              <div className="table-wrapper">
                <table>
                  <thead><tr><th>SKU</th><th>Color</th><th>Talle</th><th>Disponibles para la web</th></tr></thead>
                  <tbody>
                    {model.variants.map(row => (
                      <tr key={row.itemId}><td>{row.sku || 'Artículo inexistente'}{row.sourceItemId ? ' (generado)' : ''}</td><td>{row.color}</td><td>{row.size}</td><td>{row.available || 'Agotado'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {canWrite && (
                <div className="inline-actions">
                  <button type="button" className="secondary-button" onClick={() => setEditing(model)} disabled={busy}>Editar</button>
                  <button type="button" onClick={() => syncDraft(model)} disabled={busy || Boolean(editing)}>Enviar borrador a Shopify</button>
                  {model.pending && !model.productId && !model.syncedAt && !model.syncError && (
                    <button type="button" className="danger-button" onClick={() => deleteDraft(model)} disabled={busy}>Eliminar borrador</button>
                  )}
                </div>
              )}
            </details>
          ))}
        </>
      )}
    </div>
  );
}
