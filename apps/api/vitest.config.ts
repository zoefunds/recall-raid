import { defineConfig } from "vitest/config";

// Unit tests exercise pure logic (signature verification, the tx-status
// state machine) and never open a real database connection — but
// src/lib/config.ts still validates DATABASE_URL eagerly on import (a
// deliberate fail-fast for the real server), so tests need a placeholder
// value present before any src/lib module is imported.
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
