const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middlewares/auth');
const Role = require('../models/Role');

const router = express.Router();

router.get(
  '/',
  requirePermission('users.read'),
  asyncHandler(async (req, res) => {
    const roles = await Role.find().sort({ name: 1 });
    res.json(
      roles.map(role => ({
        id: role.id,
        name: role.name,
        permissions: role.permissions
      }))
    );
  })
);

module.exports = router;
