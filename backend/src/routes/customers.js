const express = require('express');
const asyncHandler = require('../utils/asyncHandler');
const { HttpError } = require('../utils/errors');
const { requirePermission } = require('../middlewares/auth');
const Customer = require('../models/Customer');
const CustomerStock = require('../models/CustomerStock');
const { ensureCustomerExists } = require('../services/stockService');

const router = express.Router();

router.get(
  '/',
  requirePermission('items.read'),
  asyncHandler(async (req, res) => {
    const customers = await Customer.find().sort({ name: 1 });
    res.json(customers);
  })
);

router.post(
  '/',
  requirePermission('items.write'),
  asyncHandler(async (req, res) => {
    const { name, contactInfo, status } = req.body || {};
    if (!name) {
      throw new HttpError(400, 'El nombre es obligatorio');
    }
    const customer = await Customer.create({
      name,
      contactInfo: contactInfo || '',
      status: status || 'active'
    });
    res.status(201).json(customer);
  })
);

router.put(
  '/:id',
  requirePermission('items.write'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const customer = await Customer.findById(id);
    if (!customer) {
      throw new HttpError(404, 'Cliente no encontrado');
    }
    const { name, contactInfo, status } = req.body || {};
    if (name !== undefined) customer.name = name;
    if (contactInfo !== undefined) customer.contactInfo = contactInfo;
    if (status !== undefined) {
      if (!['active', 'inactive'].includes(status)) {
        throw new HttpError(400, 'Estado inválido');
      }
      customer.status = status;
    }
    await customer.save();
    res.json(customer);
  })
);

router.get(
  '/:id/stock',
  requirePermission('reports.read'),
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    await ensureCustomerExists(id);
    const stock = await CustomerStock.find({ customer: id }).populate('item');
    res.json(
      stock.map(record => ({
        id: record.id,
        customerId: record.customer,
        itemId: record.item ? record.item.id : record.item,
        item: record.item
          ? {
              id: record.item.id,
              code: record.item.code,
              description: record.item.description
            }
          : null,
        quantity: record.quantity,
        status: record.status,
        dateCreated: record.dateCreated,
        dateDelivered: record.dateDelivered
      }))
    );
  })
);

module.exports = router;
