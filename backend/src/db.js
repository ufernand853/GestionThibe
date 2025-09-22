const mongoose = require('mongoose');
const config = require('./config');

mongoose.set('strictQuery', true);

async function connectDatabase() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }
  await mongoose.connect(config.mongoUri, {
    autoIndex: true
  });
  return mongoose.connection;
}

module.exports = { connectDatabase };
