import { buildApp } from "./app.js";
import { env } from "./lib/env.js";

async function main() {
  const app = await buildApp();
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info(`Nexus Science API listening on ${env.HOST}:${env.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
