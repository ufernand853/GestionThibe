const express = require('express');
const bcrypt = require('bcryptjs');
const asyncHandler = require('../utils/asyncHandler');
const { HttpError } = require('../utils/errors');
const { requirePermission } = require('../middlewares/auth');
const User = require('../models/User');
const Role = require('../models/Role');
const Location = require('../models/Location');

function serializeUser(userDoc) {
  const role = userDoc.role;
  const preferences = userDoc.preferences;
  return {
    id: userDoc.id,
    username: userDoc.username,
    email: userDoc.email,
    roleId: role ? role.id : userDoc.role,
    role: role ? role.name : null,
    permissions: role ? role.permissions : [],
    status: userDoc.status,
    createdAt: userDoc.createdAt,
    updatedAt: userDoc.updatedAt,
    lastLoginAt: userDoc.lastLoginAt,
    preferences: preferences && typeof preferences.toObject === 'function' ? preferences.toObject() : preferences || {},
    localSaleEnabled: Boolean(userDoc.localSaleEnabled),
    localSaleAllLocations: Boolean(userDoc.localSaleAllLocations),
    localSaleLocation: userDoc.localSaleLocation
      ? { id: userDoc.localSaleLocation.id, name: userDoc.localSaleLocation.name }
      : null
  };
}

const router = express.Router();

router.get(
  '/',
  requirePermission('users.read'),
  asyncHandler(async (req, res) => {
    const users = await User.find().populate('role').populate('localSaleLocation');
    res.json(users.map(serializeUser));
  })
);

router.post(
  '/',
  requirePermission('users.write'),
  asyncHandler(async (req, res) => {
    const { username, email, password, roleId, status, localSaleEnabled, localSaleAllLocations, localSaleLocationId } = req.body || {};
    if (!username || !email || !password || !roleId) {
      throw new HttpError(400, 'username, email, password y roleId son obligatorios');
    }
    const existing = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { username }]
    });
    if (existing) {
      throw new HttpError(400, 'El usuario ya existe');
    }
    const role = await Role.findById(roleId);
    if (!role) {
      throw new HttpError(400, 'Rol inválido');
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const allLocations = Boolean(localSaleEnabled && localSaleAllLocations);
    const saleLocation = localSaleEnabled && !allLocations ? await Location.findById(localSaleLocationId) : null;
    if (localSaleEnabled && !allLocations && (!saleLocation || !saleLocation.isLocal || saleLocation.status !== 'active')) {
      throw new HttpError(400, 'Debe seleccionar un local activo para habilitar Venta desde Local');
    }
    const user = await User.create({
      username,
      email,
      passwordHash,
      role: role.id,
      status: status || 'active',
      localSaleEnabled: Boolean(localSaleEnabled),
      localSaleAllLocations: allLocations,
      localSaleLocation: saleLocation?.id || null
    });
    const created = await user.populate(['role', 'localSaleLocation']);
    res.status(201).json(serializeUser(created));
  })
);

router.put(
  '/:id',
  requirePermission('users.write'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) {
      throw new HttpError(404, 'Usuario no encontrado');
    }
    const { username, email, password, roleId, status, localSaleEnabled, localSaleAllLocations, localSaleLocationId } = req.body || {};
    if (username && username !== user.username) {
      const existing = await User.findOne({ username });
      if (existing && existing.id !== user.id) {
        throw new HttpError(400, 'El nombre de usuario ya está en uso');
      }
      user.username = username;
    }
    if (email && email !== user.email) {
      const existingEmail = await User.findOne({ email: email.toLowerCase() });
      if (existingEmail && existingEmail.id !== user.id) {
        throw new HttpError(400, 'El email ya está en uso');
      }
      user.email = email;
    }
    if (password) {
      user.passwordHash = await bcrypt.hash(password, 12);
    }
    if (roleId) {
      const role = await Role.findById(roleId);
      if (!role) {
        throw new HttpError(400, 'Rol inválido');
      }
      user.role = role.id;
    }
    if (status) {
      if (!['active', 'disabled'].includes(status)) {
        throw new HttpError(400, 'Estado inválido');
      }
      user.status = status;
    }
    if (localSaleEnabled !== undefined || localSaleAllLocations !== undefined || localSaleLocationId !== undefined) {
      const enabled = localSaleEnabled === undefined ? user.localSaleEnabled : Boolean(localSaleEnabled);
      const allLocations = enabled && (localSaleAllLocations === undefined ? user.localSaleAllLocations : Boolean(localSaleAllLocations));
      const locationId = localSaleLocationId === undefined ? user.localSaleLocation : localSaleLocationId;
      const saleLocation = enabled && !allLocations ? await Location.findById(locationId) : null;
      if (enabled && !allLocations && (!saleLocation || !saleLocation.isLocal || saleLocation.status !== 'active')) {
        throw new HttpError(400, 'Debe seleccionar un local activo para habilitar Venta desde Local');
      }
      user.localSaleEnabled = enabled;
      user.localSaleAllLocations = allLocations;
      user.localSaleLocation = saleLocation?.id || null;
    }
    await user.save();
    const populated = await user.populate(['role', 'localSaleLocation']);
    res.json(serializeUser(populated));
  })
);

router.delete(
  '/:id/permanent',
  requirePermission('users.write'),
  asyncHandler(async (req, res) => {
    if (req.user?.role !== 'Administrador') {
      throw new HttpError(403, 'Solo un administrador puede eliminar usuarios');
    }
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) {
      throw new HttpError(404, 'Usuario no encontrado');
    }
    if (req.user?.id && String(req.user.id) === String(user.id)) {
      throw new HttpError(400, 'No puede eliminar su propia cuenta');
    }
    await user.deleteOne();
    res.status(204).send();
  })
);

router.delete(
  '/:id',
  requirePermission('users.write'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const user = await User.findById(id);
    if (!user) {
      throw new HttpError(404, 'Usuario no encontrado');
    }
    user.status = 'disabled';
    await user.save();
    res.json({ success: true });
  })
);

module.exports = router;
