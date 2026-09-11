// Re-export shim (Checkpoint 8.6B).
//
// The real implementation moved to `@personal-os/core/logging/logger` so
// `apps/api` can share the identical guarantee for the Ask lane -- `apps/api`
// may never import from `apps/worker`, so "one copy, two consumers" means the
// copy has to live somewhere both can reach. See that module for the full
// rationale and the field-name denylist. This file exists only so every
// existing `../logger.js` / `./logger.js` import in apps/worker keeps working
// unchanged.
export * from "@personal-os/core/logging/logger";
