import type { ExportResponse } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { buildUserExport } from "../read-models/user-export.js";

export default function exportRoutes(app: FastifyInstance): void {
  // Perimeter-only (Tailscale), like every non-device route -- no device-auth
  // hook.
  //
  // NO QUERY PARAMETERS AT ALL, which is the contract rather than an omission:
  // an export is the whole user-authored core or it is nothing, so there is no
  // filter to get wrong and no page to forget to turn. See
  // ExportResponseSchema. That includes archived rows of every entity --
  // since Checkpoint 9.3 (migration 0017) inbox items have an archive axis
  // too, and GET /inbox's default exclusion deliberately does not reach here.
  //
  // Returns JSON with no Content-Disposition. This is a read endpoint, not a
  // file handoff: the caller decides whether the bytes become a file, and the
  // server creates nothing, stores nothing and sends nothing anywhere. ADR-024
  // is untouched -- this is not a backup system.
  //
  // CSV is deliberately not offered. Four entities with four different column
  // sets cannot share one flat table without either four separate files (an
  // archive format, which this checkpoint does not build) or a lowest-common-
  // denominator shape that would silently drop most of the content.
  app.get("/export", async (): Promise<ExportResponse> => {
    // One instant for the whole document, captured here so every count and row
    // set in the response is stamped with the same generation time.
    return buildUserExport(app.db, new Date());
  });
}
