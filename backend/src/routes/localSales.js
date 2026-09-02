const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const asyncHandler = require('../utils/asyncHandler');
const { HttpError } = require('../utils/errors');
const { requireAuth } = require('../middlewares/auth');
const config = require('../config');
const User = require('../models/User');
const Item = require('../models/Item');
const Location = require('../models/Location');
const MovementRequest = require('../models/MovementRequest');
const LocalSale = require('../models/LocalSale');
const { executeMovement, normalizeStoredQuantity } = require('../services/stockService');
const { syncLocalSaleInventory } = require('../services/shopifyProductService');
const { recordAuditEvent } = require('../services/auditService');

const router = express.Router();
const TOKEN_TTL = '30m';

function escapeRegex(value) {
  return value.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function skuFromInternalBarcode(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 12) digits = `0${digits}`;
  if (!/^04\d{11}$/.test(digits)) return null;
  const base = digits.slice(0, 12);
  let sum = 0;
  for (let index = 0; index < base.length; index += 1) {
    sum += Number(base[index]) * ((index + 1) % 2 === 0 ? 3 : 1);
  }
  if (String((10 - (sum % 10)) % 10) !== digits[12]) return null;
  if (digits.slice(8, 12) === '0000') return digits.slice(2, 8).replace(/^0+(?=\d)/, '');
  if (digits.slice(9, 12) === '000') return digits.slice(2, 9).slice(-6).replace(/^0+(?=\d)/, '');
  return null;
}

function readSaleToken(req) {
  return req.get('X-Local-Sale-Token') || req.body?.saleToken || '';
}

async function authorizeSale(req) {
  let payload;
  try {
    payload = jwt.verify(readSaleToken(req), config.jwtSecret);
  } catch (error) {
    throw new HttpError(401, 'La autorización de Venta desde Local venció. Ingrese nuevamente.');
  }
  if (payload.purpose !== 'local-sale') throw new HttpError(401, 'Autorización de venta inválida');
  const user = await User.findById(payload.sub).populate('localSaleLocation');
  if (!user || user.status !== 'active' || !user.localSaleEnabled) {
    throw new HttpError(403, 'El usuario ya no está habilitado para Venta desde Local');
  }
  const requestedLocationId = req.get('X-Local-Sale-Location') || req.body?.locationId || req.query?.locationId;
  const locationId = user.localSaleAllLocations ? requestedLocationId : user.localSaleLocation?.id;
  if (!locationId || (!user.localSaleAllLocations && String(locationId) !== String(payload.locationId))) {
    throw new HttpError(403, 'El local autorizado no está disponible');
  }
  const location = await Location.findOne({ _id: locationId, type: 'warehouse', isLocal: true, status: 'active' });
  if (!location) throw new HttpError(403, 'El local autorizado no está disponible');
  return { user, location };
}

function serializeItem(item, locationId) {
  const stock = item.stock instanceof Map ? item.stock.get(String(locationId)) : item.stock?.[String(locationId)];
  return {
    id: item.id,
    code: item.code,
    sku: item.sku || null,
    description: item.description,
    availableUnits: normalizeStoredQuantity(stock).units
  };
}

router.post('/authorize', requireAuth, asyncHandler(async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const isSellerSession = req.user.role === 'Vendedor';
  if (!isSellerSession && (!username || !password)) throw new HttpError(400, 'Debe indicar usuario y contraseña');
  const user = isSellerSession
    ? await User.findById(req.user.id).populate('localSaleLocation')
    : await User.findOne({ $or: [{ username }, { email: username.toLowerCase() }] }).populate('localSaleLocation');
  const valid = user && user.status === 'active' && user.localSaleEnabled
    && (isSellerSession || await bcrypt.compare(password, user.passwordHash));
  if (!valid || (!user.localSaleAllLocations && (!user.localSaleLocation || user.localSaleLocation.status !== 'active'))) {
    throw new HttpError(401, 'Credenciales de Venta desde Local inválidas');
  }
  const saleToken = jwt.sign(
    { sub: user.id, purpose: 'local-sale', locationId: user.localSaleLocation?.id || null, allLocations: Boolean(user.localSaleAllLocations) },
    config.jwtSecret,
    { expiresIn: TOKEN_TTL }
  );
  const locations = user.localSaleAllLocations
    ? await Location.find({ type: 'warehouse', isLocal: true, status: 'active' }).sort({ name: 1 })
    : [user.localSaleLocation];
  res.json({
    saleToken,
    user: { id: user.id, username: user.username },
    allLocations: Boolean(user.localSaleAllLocations),
    locations: locations.map(location => ({ id: location.id, name: location.name })),
    location: user.localSaleAllLocations ? null : { id: user.localSaleLocation.id, name: user.localSaleLocation.name }
  });
}));

router.get('/items', requireAuth, asyncHandler(async (req, res) => {
  const { location } = await authorizeSale(req);
  const search = String(req.query?.search || '').trim();
  if (!search) return res.json([]);
  const matcher = new RegExp(`^${escapeRegex(search)}$`, 'i');
  const internalSku = skuFromInternalBarcode(search);
  const alternatives = [{ code: matcher }, { sku: matcher }];
  if (internalSku) alternatives.push({ sku: new RegExp(`^0*${escapeRegex(internalSku)}$`, 'i') });
  const items = await Item.find({ deletedAt: null, $or: alternatives }).limit(10);
  res.json(items.map(item => serializeItem(item, location.id)));
}));

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const { user: saleUser, location: saleLocation } = await authorizeSale(req);
  const rawLines = Array.isArray(req.body?.lines) ? req.body.lines : [];
  if (!rawLines.length || rawLines.length > 100) throw new HttpError(400, 'La venta debe tener entre 1 y 100 artículos');

  const quantities = new Map();
  rawLines.forEach(line => {
    const itemId = String(line.itemId || '');
    if (line.quantity === '' || line.quantity === null || line.quantity === undefined) {
      throw new HttpError(400, 'Ningún artículo puede tener la cantidad vacía');
    }
    const quantity = Number(line.quantity);
    if (!itemId || !Number.isInteger(quantity) || quantity <= 0) throw new HttpError(400, 'Las cantidades deben ser unidades enteras mayores a cero');
    quantities.set(itemId, (quantities.get(itemId) || 0) + quantity);
  });
  const items = await Item.find({ _id: { $in: [...quantities.keys()] }, deletedAt: null });
  if (items.length !== quantities.size) throw new HttpError(404, 'Uno o más artículos no están disponibles');
  items.forEach(item => {
    const available = serializeItem(item, saleLocation.id).availableUnits;
    if (available < quantities.get(item.id)) throw new HttpError(400, `Stock insuficiente para ${item.code}. Disponible: ${available}`);
  });

  let destination = await Location.findOne({ type: 'external', name: 'Ventas desde locales' });
  if (!destination) destination = await Location.create({ name: 'Ventas desde locales', type: 'external', description: 'Destino automático para ventas registradas desde locales' });

  const completedLines = [];
  for (const item of items) {
    const quantity = quantities.get(item.id);
    const movement = await MovementRequest.create({
      item: item.id, type: 'egress', fromLocation: saleLocation.id, toLocation: destination.id,
      quantity: { boxes: 0, units: quantity }, reason: 'Venta desde Local', requestedBy: saleUser.id,
      status: 'approved', approvedBy: saleUser.id, approvedAt: new Date()
    });
    await executeMovement(movement, saleUser.id, { operatedBy: req.user.username, channel: 'local-sale' });
    const updatedItem = await Item.findById(item.id);
    let shopifyStatus = 'pending';
    let shopifyError = null;
    try {
      ({ status: shopifyStatus } = await syncLocalSaleInventory(updatedItem, saleLocation));
    } catch (error) {
      shopifyError = String(error.message || 'Error desconocido').slice(0, 500);
    }
    completedLines.push({ item: item.id, code: item.code, description: item.description, quantity, movementRequest: movement.id, shopifyStatus, shopifyError });
  }

  const sale = await LocalSale.create({ location: saleLocation.id, authorizedBy: saleUser.id, operatedBy: req.user.id, lines: completedLines });
  await recordAuditEvent({ action: 'Venta desde Local', request: `${saleLocation.name}: ${completedLines.length} artículo(s)`, user: req.user.username, details: { saleId: sale.id, authorizedBy: saleUser.username } });
  res.status(201).json({ id: sale.id, location: { id: saleLocation.id, name: saleLocation.name }, lines: completedLines });
}));

module.exports = router;
