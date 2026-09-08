// Test runner config (used by `npm test`): makes "@/..." imports work in tests
// and stubs out "server-only" so server files can be unit-tested.
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      // Match the Next.js "@/..." import alias.
      "@": path.resolve(__dirname, "src"),
      // `server-only` throws unless it's bundled by a framework. In unit tests
      // we swap it for a harmless empty module so we can test server helpers.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
