const express = require('express');
const path = require('path');
const cors = require('cors');
const morgan = require('morgan');
const { authenticate } = require('./middlewares/auth');
const errorHandler = require('./middlewares/errorHandler');
const { HttpError } = require('./utils/errors');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const groupsRoutes = require('./routes/groups');
const itemsRoutes = require('./routes/items');
const locationsRoutes = require('./routes/locations');
const stockRoutes = require('./routes/stock');
const logsRoutes = require('./routes/logs');
const reportsRoutes = require('./routes/reports');
const rolesRoutes = require('./routes/roles');
const preferencesRoutes = require('./routes/preferences');
const shopifyRoutes = require('./routes/shopify');
const localSalesRoutes = require('./routes/localSales');
const { verifyShopifyWebhook, parseWebhookBody, applyInventoryLevelUpdate } = require('./services/shopifyWebhookService');

const app = express();

app.use(cors());

app.post('/api/shopify/webhooks/inventory-levels-update', express.raw({ type: 'application/json', limit: '2mb' }), async (req, res, next) => {
  try {
    const verification = verifyShopifyWebhook(req.body, req.get('X-Shopify-Hmac-Sha256'));
    if (!verification.ok) {
      throw new HttpError(401, verification.reason);
    }
    const payload = parseWebhookBody(req.body);
    if (!payload) {
      throw new HttpError(400, 'Payload Shopify inválido.');
    }
    const result = await applyInventoryLevelUpdate(payload);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.use(express.json({ limit: '75mb', strict: false }));
app.use(morgan('dev'));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use(authenticate);

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/items', itemsRoutes);
app.use('/api/locations', locationsRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api/preferences', preferencesRoutes);
app.use('/api/shopify', shopifyRoutes);
app.use('/api/local-sales', localSalesRoutes);

app.use((req, res, next) => {
  next(new HttpError(404, 'Ruta no encontrada'));
});

app.use(errorHandler);

module.exports = app;
