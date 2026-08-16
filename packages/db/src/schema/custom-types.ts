import { customType } from "drizzle-orm/pg-core";

// drizzle-orm/pg-core has no first-class bytea helper; this is the
// documented customType pattern for it. Used for encrypted AI-provider
// API key material (see ai-provider-connections.ts).
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});
