require('dotenv').config();

const normalizeBoolean = (value) => {
  if (typeof value !== 'string') {
    return undefined;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
};

const defaultMongoDbName = process.env.MONGO_URI ? undefined : 'gestionthibe';

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/gestionthibe',
  mongo: {
    uri: process.env.MONGO_URI,
    dbName: process.env.MONGO_DB_NAME || defaultMongoDbName,
    user: process.env.MONGO_USER || undefined,
    password: process.env.MONGO_PASSWORD || undefined,
    authSource: process.env.MONGO_AUTH_SOURCE || undefined,
    authMechanism: process.env.MONGO_AUTH_MECHANISM || undefined,
    tls: normalizeBoolean(process.env.MONGO_TLS),
    tlsCAFile: process.env.MONGO_TLS_CA_FILE || undefined
  },
  jwtSecret: process.env.JWT_SECRET || 'development-secret',
  accessTokenTtl: parseInt(process.env.ACCESS_TOKEN_TTL || '3600', 10),
  refreshTokenTtl: parseInt(process.env.REFRESH_TOKEN_TTL || '604800', 10),
  adminEmail: process.env.ADMIN_EMAIL || 'admin@example.com',
  adminPassword: process.env.ADMIN_PASSWORD || 'ChangeMe123!'
};

module.exports = config;
