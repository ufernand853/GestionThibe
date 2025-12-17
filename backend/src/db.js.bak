const mongoose = require('mongoose');
const config = require('./config');

mongoose.set('strictQuery', true);

async function connectDatabase() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }
  const connectionOptions = {
    autoIndex: true
  };

  if (config.mongo) {
    const {
      dbName,
      user,
      password,
      authSource,
      authMechanism,
      tls,
      tlsCAFile
    } = config.mongo;

    if (dbName) {
      connectionOptions.dbName = dbName;
    }
    if (user) {
      connectionOptions.user = user;
    }
    if (password) {
      connectionOptions.pass = password;
    }
    if (authSource) {
      connectionOptions.authSource = authSource;
    }
    if (authMechanism) {
      connectionOptions.authMechanism = authMechanism;
    }
    if (typeof tls === 'boolean') {
      connectionOptions.tls = tls;
    }
    if (tlsCAFile) {
      connectionOptions.tlsCAFile = tlsCAFile;
    }
  }

  try {
    await mongoose.connect(config.mongo?.uri || config.mongoUri, connectionOptions);
  } catch (error) {
    if (error?.codeName === 'AuthenticationFailed') {
      console.error(
        'MongoDB rechazó las credenciales proporcionadas. Revisa las variables MONGO_USER, MONGO_PASSWORD y MONGO_AUTH_SOURCE o '
          +
          'ajusta la cadena MONGO_URI. También verifica que el usuario exista y tenga permisos sobre la base configurada.'
      );
    }
    throw error;
  }
  return mongoose.connection;
}

module.exports = { connectDatabase };
