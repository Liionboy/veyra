import { buildApp } from "./app.js";
import { config } from "./config.js";

const app = buildApp();

try {
  await app.listen({ host: config.VEYRA_HOST, port: config.VEYRA_PORT });
  if (!process.env.VEYRA_SECRET && !process.env.VEYRA_SECRET_FILE) {
    app.log.warn(
      "Using an ephemeral development secret. Set VEYRA_SECRET before production use.",
    );
  }
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
