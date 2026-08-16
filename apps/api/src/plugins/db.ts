import { createDbClient, type Db } from "@personal-os/db";
import type { FastifyInstance } from "fastify";
import { env } from "../env.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
  }
}

// createDbClient is lazy (no connection at import time) -- decorating here
// keeps that property: the app can still boot and serve /health even if
// Postgres is unreachable (see packages/db/src/client.ts).
export function registerDb(app: FastifyInstance): void {
  app.decorate("db", createDbClient(env.DATABASE_URL));
}
