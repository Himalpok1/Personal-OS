import { buildServer } from "./server.js";
import { env } from "./env.js";

const app = buildServer();

app.listen({ port: env.PORT, host: "0.0.0.0" }).catch((err: unknown) => {
  app.log.error(err);
  process.exit(1);
});
