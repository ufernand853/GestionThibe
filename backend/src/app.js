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
const customersRoutes = require('./routes/customers');
const stockRoutes = require('./routes/stock');
const logsRoutes = require('./routes/logs');
const reportsRoutes = require('./routes/reports');
const rolesRoutes = require('./routes/roles');

const app = express();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
app.use(authenticate);

app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/items', itemsRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/logs', logsRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/roles', rolesRoutes);

app.use((req, res, next) => {
  next(new HttpError(404, 'Ruta no encontrada'));
});

app.use(errorHandler);

module.exports = app;
