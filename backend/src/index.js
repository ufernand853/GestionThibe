const app = require('./app');
const config = require('./config');
const { connectDatabase } = require('./db');
const seed = require('./seed');
const { purgeExpiredItems } = require('./services/itemTrashService');



async function start() {
  try {
    await connectDatabase();
    await seed();
    await purgeExpiredItems();
    const purgeTimer = setInterval(() => {
      purgeExpiredItems().catch(error => console.error('No se pudo purgar la papelera', error));
    }, 60 * 60 * 1000);
    purgeTimer.unref();
    app.listen(config.port, () => {
      console.log(`Servidor escuchando en http://localhost:${config.port}`);
    });
  } catch (error) {
    console.error('No se pudo iniciar el servidor', error);
    process.exit(1);
  }
}

start();
