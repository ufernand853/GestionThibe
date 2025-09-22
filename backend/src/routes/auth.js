const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const asyncHandler = require('../utils/asyncHandler');
const { HttpError } = require('../utils/errors');
const config = require('../config');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');

function serializeUser(userDoc) {
  const role = userDoc.role;
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
    lastLoginAt: userDoc.lastLoginAt
  };
}

const router = express.Router();

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      throw new HttpError(400, 'Debe indicar email y password');
    }
    const user = await User.findOne({ email }).populate('role');
    if (!user || user.status !== 'active') {
      throw new HttpError(401, 'Credenciales inválidas');
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new HttpError(401, 'Credenciales inválidas');
    }
    user.lastLoginAt = new Date();
    await user.save();

    const payload = {
      sub: user.id,
      role: user.role ? user.role.name : null,
      permissions: user.role ? user.role.permissions : []
    };
    const accessToken = jwt.sign(payload, config.jwtSecret, {
      expiresIn: config.accessTokenTtl
    });
    const refreshTokenValue = crypto.randomBytes(48).toString('hex');
    const refreshToken = await RefreshToken.create({
      token: refreshTokenValue,
      user: user.id,
      expiresAt: new Date(Date.now() + config.refreshTokenTtl * 1000)
    });

    res.json({
      accessToken,
      refreshToken: refreshToken.token,
      expiresIn: config.accessTokenTtl,
      user: serializeUser(user)
    });
  })
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body || {};
    if (!refreshToken) {
      throw new HttpError(400, 'Debe indicar refreshToken');
    }
    const stored = await RefreshToken.findOne({ token: refreshToken });
    if (!stored) {
      throw new HttpError(401, 'Refresh token inválido');
    }
    if (stored.expiresAt.getTime() < Date.now()) {
      await stored.deleteOne();
      throw new HttpError(401, 'Refresh token expirado');
    }
    const user = await User.findById(stored.user).populate('role');
    if (!user || user.status !== 'active') {
      await stored.deleteOne();
      throw new HttpError(401, 'Usuario no disponible');
    }
    const payload = {
      sub: user.id,
      role: user.role ? user.role.name : null,
      permissions: user.role ? user.role.permissions : []
    };
    const accessToken = jwt.sign(payload, config.jwtSecret, {
      expiresIn: config.accessTokenTtl
    });
    res.json({
      accessToken,
      expiresIn: config.accessTokenTtl,
      user: serializeUser(user)
    });
  })
);

router.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body || {};
    if (refreshToken) {
      await RefreshToken.deleteOne({ token: refreshToken });
    }
    res.json({ success: true });
  })
);

module.exports = router;
