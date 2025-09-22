const app = require('./app');
const config = require('./config');
const { connectDatabase } = require('./db');
const seed = require('./seed');

async function start() {
  try {
    await connectDatabase();
    await seed();
    app.listen(config.port, () => {
      console.log(`Servidor escuchando en http://localhost:${config.port}`);
    });
  } catch (error) {
    console.error('No se pudo iniciar el servidor', error);
    process.exit(1);
  }
}

start();
