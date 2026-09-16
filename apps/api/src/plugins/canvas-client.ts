import { createCanvasClient, type CanvasClient } from "@personal-os/canvas-providers";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    canvasClient: CanvasClient;
  }
}

// Decorated rather than constructed inline inside canvas-connections.ts, so
// route tests can inject a scripted FakeCanvasClient through buildTestApp's
// options and never make a real call to a Canvas instance from an
// `.inject()` suite. Exactly the seam registerGmailClient and
// registerGoogleHealthClient establish for their own providers.
//
// Unlike those two, CanvasClient carries no server-level configuration to
// close over -- `baseUrl` and `token` are per-call arguments (ADR-068 §2:
// Canvas is self-hosted per institution, so there is no single origin this
// package could bake in), so `createCanvasClient()` needs nothing from `env`
// at construction time.
export function registerCanvasClient(app: FastifyInstance, client?: CanvasClient): void {
  app.decorate("canvasClient", client ?? createCanvasClient());
}
