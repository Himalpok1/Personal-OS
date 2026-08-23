import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Client, types } from "pg";
import { parsePgDateArrayIdentity } from "../src/client.js";

// packages/db has no vitest.config.ts (unlike apps/api/apps/worker) --
// journal.test.ts never needed database connectivity. This is the first
// test in this package that does, so it loads the root .env itself,
// mirroring the exact `process.loadEnvFile` pattern already used by
// apps/api/vitest.config.ts and apps/worker/vitest.config.ts.
process.loadEnvFile(path.resolve(import.meta.dirname, "../../../.env"));

const connectionString =
  process.env["TEST_MIGRATIONS_DATABASE_URL"] ?? process.env["TEST_DATABASE_URL"];

// This file only ever connects to whichever of the two TEST_* URLs above is
// set -- never DATABASE_URL/MIGRATIONS_DATABASE_URL (dev) and never a
// production connection string. Refuse to proceed if the resolved URL
// doesn't even look like a test database, as a defense-in-depth guard
// against a misconfigured environment silently pointing this test at dev.
if (connectionString && !/test/i.test(connectionString)) {
  throw new Error(
    "date-type-parser.test.ts resolved a connection string that does not look like a test database -- refusing to run against it",
  );
}

// ---------------------------------------------------------------------
// Regression coverage for the Checkpoint 5.5 audit finding: pg's default
// `date` (oid 1082) / `date[]` (oid 1182) parsing silently corrupts a
// stored calendar date by one day in any process whose OS timezone has a
// POSITIVE UTC offset (Asia/Kolkata, Australia/Sydney, Pacific/Kiritimati,
// ...). Full mechanism and empirical evidence are documented in the long
// comment above the fix in ../src/client.ts. Importing that module above
// registers the identity type parsers as a side effect; every test below
// would fail if that registration were removed.
// ---------------------------------------------------------------------

describe("parsePgDateArrayIdentity (pure -- no DB, no timezone dependency)", () => {
  it("splits an ordinary date[] wire string into raw YYYY-MM-DD strings", () => {
    expect(parsePgDateArrayIdentity("{2026-08-22,2025-01-01}")).toEqual([
      "2026-08-22",
      "2025-01-01",
    ]);
  });

  it("maps the Postgres NULL literal to a real null, not the string 'NULL'", () => {
    expect(parsePgDateArrayIdentity("{2026-08-22,NULL,2025-01-01}")).toEqual([
      "2026-08-22",
      null,
      "2025-01-01",
    ]);
  });

  it("returns [] for Postgres's empty-array wire format '{}'", () => {
    expect(parsePgDateArrayIdentity("{}")).toEqual([]);
  });

  it("handles a single-element array correctly", () => {
    expect(parsePgDateArrayIdentity("{2026-08-22}")).toEqual(["2026-08-22"]);
  });

  it("handles an all-NULL array", () => {
    expect(parsePgDateArrayIdentity("{NULL,NULL}")).toEqual([null, null]);
  });
});

describe("pg type-parser registration (deterministic -- no live DB or timezone dependency)", () => {
  // These two tests prove the fix is active by inspecting pg's own global
  // type-parser registry directly. They need no database and no forced
  // timezone: pg-types' *default* date parser always returns a `Date`
  // object regardless of the host's timezone, so simply asserting the
  // registered parser returns a `string` is enough to fail deterministically
  // if the registration in ../src/client.ts is ever removed or reverted.

  // pg-types' own `getTypeParser` return type is `any`; cast to a concrete
  // signature immediately so the rest of each test is fully type-checked.
  it("registers an identity parser for oid 1082 (date)", () => {
    const parse = types.getTypeParser(types.builtins.DATE) as (value: string) => unknown;
    const result = parse("2026-08-22");
    expect(typeof result).toBe("string");
    expect(result).toBe("2026-08-22");
  });

  it("registers parsePgDateArrayIdentity for oid 1182 (date[], Postgres builtin _date)", () => {
    const parse = types.getTypeParser(1182 as never) as (value: string) => unknown;
    const result = parse("{2026-08-22,2025-01-01}");
    expect(result).toEqual(["2026-08-22", "2025-01-01"]);
  });
});

describe.runIf(Boolean(connectionString))(
  "live round-trip through the real pg driver + Postgres (Checkpoint 5.5 audit fix)",
  () => {
    // Casts to string are safe here: this whole describe block is gated by
    // `describe.runIf(Boolean(connectionString))` above.
    const testConnectionString = connectionString as string;
    let client: Client;

    beforeAll(async () => {
      client = new Client({ connectionString: testConnectionString });
      await client.connect();
    });

    afterAll(async () => {
      await client.end();
    });

    // Forces the exact class of process timezone (a POSITIVE UTC offset)
    // that silently corrupted stored dates before this fix -- see the
    // empirical before/after table in ../src/client.ts. This makes the
    // test deterministic regardless of the host machine's own ambient
    // timezone: Node re-reads `process.env.TZ` for every subsequent `Date`
    // computation (confirmed directly while building this fix -- mutating
    // it mid-process, with no respawn, changes `new Date(...).toString()`
    // immediately). Restored after each test so it cannot leak into any
    // other test in this file or process.
    const ORIGINAL_TZ = process.env["TZ"];
    afterEach(() => {
      if (ORIGINAL_TZ === undefined) delete process.env["TZ"];
      else process.env["TZ"] = ORIGINAL_TZ;
    });

    it("round-trips a stored date column to the identical string under TZ=Asia/Kolkata", async () => {
      process.env["TZ"] = "Asia/Kolkata";

      await client.query("BEGIN");
      try {
        await client.query(
          "CREATE TEMP TABLE date_type_parser_regression (d date NOT NULL) ON COMMIT DROP",
        );
        await client.query("INSERT INTO date_type_parser_regression (d) VALUES ($1)", [
          "2026-08-22",
        ]);
        const result = await client.query<{ d: unknown }>(
          "SELECT d FROM date_type_parser_regression",
        );
        const value = result.rows[0]?.d;

        expect(typeof value).toBe("string");
        expect(value).toBe("2026-08-22");
      } finally {
        // Never committed -- this test never persists anything to the
        // test database, matching the throwaway-repro discipline used to
        // find this bug in the first place.
        await client.query("ROLLBACK");
      }
    });

    it("round-trips a stored date[] column to identical strings under TZ=Australia/Sydney", async () => {
      process.env["TZ"] = "Australia/Sydney";

      await client.query("BEGIN");
      try {
        await client.query(
          "CREATE TEMP TABLE date_array_type_parser_regression (d date[] NOT NULL) ON COMMIT DROP",
        );
        await client.query("INSERT INTO date_array_type_parser_regression (d) VALUES ($1)", [
          ["2026-08-22", "2025-01-01"],
        ]);
        const result = await client.query<{ d: unknown }>(
          "SELECT d FROM date_array_type_parser_regression",
        );
        const value = result.rows[0]?.d;

        expect(value).toEqual(["2026-08-22", "2025-01-01"]);
      } finally {
        await client.query("ROLLBACK");
      }
    });
  },
);
