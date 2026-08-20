import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "./env.js";
import { buildServer } from "./server.js";

const REQUIRED_METHODS = ["GET", "HEAD", "POST", "PATCH", "DELETE"];

function advertisedMethods(header: string | undefined): Set<string> {
  return new Set(
    (header ?? "")
      .split(",")
      .map((method) => method.trim().toUpperCase())
      .filter(Boolean),
  );
}

describe("CORS", () => {
  let app: FastifyInstance;
  const approvedOrigin = env.WEB_APP_ORIGIN[0]!;

  beforeAll(async () => {
    app = await buildServer();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(["PATCH", "DELETE"])(
    "permits %s preflight from the approved web origin",
    async (method) => {
      const response = await app.inject({
        method: "OPTIONS",
        url: "/events/00000000-0000-0000-0000-000000000000",
        headers: {
          origin: approvedOrigin,
          "access-control-request-method": method,
        },
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe(approvedOrigin);

      const methods = advertisedMethods(response.headers["access-control-allow-methods"]);
      for (const requiredMethod of REQUIRED_METHODS) {
        expect(methods).toContain(requiredMethod);
      }
    },
  );

  it("does not advertise unsupported methods", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/events/00000000-0000-0000-0000-000000000000",
      headers: {
        origin: approvedOrigin,
        "access-control-request-method": "PUT",
      },
    });

    const methods = advertisedMethods(response.headers["access-control-allow-methods"]);
    expect(methods).not.toContain("PUT");
  });

  it("does not authorize browser access from an unapproved origin", async () => {
    const response = await app.inject({
      method: "OPTIONS",
      url: "/events/00000000-0000-0000-0000-000000000000",
      headers: {
        origin: "https://unapproved.example",
        "access-control-request-method": "PATCH",
      },
    });

    // Browser denial is the security property. The response status itself is
    // intentionally not constrained: without a usable ACAO value, the
    // browser will not grant the requesting origin access.
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("leaves ordinary non-browser requests unaffected", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(response.json()).toMatchObject({ status: "ok", db: "connected" });
  });
});
