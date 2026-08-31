import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Same "@/" alias the Next app uses, so app modules can be tested
      // without rewriting their imports.
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/web/src/**/*.test.ts",
      "proxy/test/**/*.test.ts",
    ],
  },
});
