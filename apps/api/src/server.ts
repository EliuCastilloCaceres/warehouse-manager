import { buildApp } from './app.js';
import { type AppConfig, loadConfig } from './core/config.js';

let config: AppConfig;
try {
  config = loadConfig(process.env);
} catch (error) {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
}

const app = await buildApp(config);

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
