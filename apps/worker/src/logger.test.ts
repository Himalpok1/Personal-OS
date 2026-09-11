import { describe, expect, it } from "vitest";
import * as core from "@personal-os/core/logging/logger";
import * as shim from "./logger.js";

// The real test coverage lives in packages/core/src/logging/logger.test.ts,
// against the module both processes now share (Checkpoint 8.6B). This file
// only pins that the re-export shim actually forwards every binding -- so a
// future edit that turns the shim back into a second implementation, or drops
// an export, fails here rather than silently diverging from the core module.
describe("apps/worker's logger re-export shim", () => {
  it("forwards every export from the shared core module unchanged", () => {
    expect(Object.keys(shim).sort()).toEqual(Object.keys(core).sort());
    expect(shim.log).toBe(core.log);
    expect(shim.errorToken).toBe(core.errorToken);
    expect(shim.buildLogRecord).toBe(core.buildLogRecord);
    expect(shim.setLogSink).toBe(core.setLogSink);
  });
});
