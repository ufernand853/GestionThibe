const bcrypt = require('bcryptjs');
const Role = require('./models/Role');
const User = require('./models/User');
const Group = require('./models/Group');
const config = require('./config');

const defaultRoles = [
  {
    name: 'Administrador',
    permissions: [
      'items.read',
      'items.write',
      'stock.request',
      'stock.approve',
      'stock.logs.read',
      'users.read',
      'users.write',
      'reports.read'
    ]
  },
  {
    name: 'Operador',
    permissions: ['items.read', 'items.write', 'stock.request', 'reports.read']
  },
  {
    name: 'Consulta',
    permissions: ['items.read', 'reports.read']
  }
];

const defaultGroups = [
  'MEDIAS',
  'ROPA INTERIOR',
  'MANIQUÍ',
  'BLANCOS',
  'ACCESORIOS',
  'JEAN HOMBRE',
  'JEAN DAMA',
  'JEAN NIÑO/A',
  'ROPA HOMBRE',
  'ROPA DAMA',
  'ROPA NIÑO/A',
  'CALZADO',
  'ELECTRÓNICOS Y BAZAR',
  'JUGUETES',
  'ESCOLARES',
  'SOBRESTOCK GENERAL',
  'SOBRESTOCK THIBE',
  'SOBRESTOCK ARENAL IMPORT',
  'CLIENTES'
];

async function seedRoles() {
  for (const role of defaultRoles) {
    const existing = await Role.findOne({ name: role.name });
    if (!existing) {
      await Role.create(role);
    }
  }
}

async function seedGroups() {
  for (const name of defaultGroups) {
    const existing = await Group.findOne({ name });
    if (!existing) {
      await Group.create({ name });
    }
  }
}

async function seedAdminUser() {
  const adminEmail = config.adminEmail;
  let admin = await User.findOne({ email: adminEmail }).populate('role');
  if (!admin) {
    const adminRole = await Role.findOne({ name: 'Administrador' });
    const passwordHash = await bcrypt.hash(config.adminPassword, 12);
    admin = await User.create({
      username: 'admin',
      email: adminEmail,
      passwordHash,
      role: adminRole.id,
      status: 'active'
    });
    console.log(`Usuario administrador creado con email ${adminEmail}`);
  }
}

async function seed() {
  await seedRoles();
  await seedGroups();
  await seedAdminUser();
}

module.exports = seed;
