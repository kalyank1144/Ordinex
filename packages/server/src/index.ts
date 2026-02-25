import 'dotenv/config';
import { loadConfig } from './config.js';
import { initDatabase } from './db/index.js';
import { buildApp } from './app.js';

async function main() {
  const config = loadConfig();
  const db = await initDatabase(config.dbPath);
  const app = await buildApp(config, db);

  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`Ordinex server running on http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
