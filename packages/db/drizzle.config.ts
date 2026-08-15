import { defineConfig } from "drizzle-kit";

// Migrations always run as the migrator role (DDL rights), never the
// least-privilege runtime role the API/worker connect with.
export default defineConfig({
  schema: "./src/schema",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["MIGRATIONS_DATABASE_URL"] ?? "",
  },
});
