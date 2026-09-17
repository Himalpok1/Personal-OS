import { MEMORY_SETTINGS_SINGLETON_ID, memorySettings } from "@personal-os/db";
import { MemorySettingsUpdateSchema } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { getMemorySettings } from "../read-models/memories.js";

// The Personal Memory layer's global switch (Checkpoint 10.7, ADR-077 §7).
//
// A CHECKed singleton row (`id = 'singleton'`) that is materialised lazily:
// GET answers `enabled: true` when no row exists (the layer ships ON), and
// PATCH upserts the one row. The switch gates USE -- suggestions here, Focus
// Now / the briefing on the client -- never storage: every CRUD, list, export
// and delete route stays available when it is off, so turning memory off can
// never trap the owner's own data.
export default function memorySettingsRoutes(app: FastifyInstance): void {
  app.get("/memory-settings", async () => getMemorySettings(app.db));

  app.patch("/memory-settings", async (request) => {
    const body = MemorySettingsUpdateSchema.parse(request.body);
    await app.db
      .insert(memorySettings)
      .values({ id: MEMORY_SETTINGS_SINGLETON_ID, enabled: body.enabled })
      .onConflictDoUpdate({
        target: memorySettings.id,
        set: { enabled: body.enabled, updatedAt: new Date() },
      });
    return getMemorySettings(app.db);
  });
}
