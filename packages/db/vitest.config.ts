import { defineConfig } from "vitest/config";

// The constraints tests all run against one real test database and clean up
// with `delete from …` in afterEach. Since Checkpoint 10.9 two files touch
// the same tables (action-constraints and agent-constraints both write
// action_requests and agents), so vitest's default file parallelism would let
// one file's afterEach delete the row the other just inserted. Serialize,
// exactly as apps/api and apps/worker do.
export default defineConfig({
  test: {
    exclude: ["dist/**", "node_modules/**"],
    fileParallelism: false,
  },
});
