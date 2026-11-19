import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Unit tests: `npm test`. Pure: no database, no network, no Next runtime.
// Colocated with the code they prove (src/**/foo.test.ts, scripts/**/foo.test.ts).
// Anything that needs Postgres belongs in tests/integration (`npm run test:int`).

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
      // A pure module may still `import "server-only"`; the stub is the integration suite's.
      "server-only": resolve(import.meta.dirname, "tests/integration/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["**/node_modules/**", "src/generated/**"],
  },
});
