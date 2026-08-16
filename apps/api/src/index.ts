import { env } from "./env.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  const app = await buildServer();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
