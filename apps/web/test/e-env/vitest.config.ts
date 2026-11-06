import { defineConfig } from "vite-plus/test/config";
import * as NodeURL from "node:url";

export default defineConfig({
  root: NodeURL.fileURLToPath(new URL("../../", import.meta.url)),
  resolve: {
    alias: { "~": NodeURL.fileURLToPath(new URL("../../src", import.meta.url)) },
    dedupe: ["react", "react-dom"],
  },
  test: {
    include: ["test/scenarios/areas/e-env/environmentSources.test.tsx"],
    environment: "node",
    globalSetup: ["../../scripts/test-postgres.setup.ts"],
    setupFiles: ["../../packages/shared/src/testing/longTempDir.ts"],
    hookTimeout: 180_000,
    testTimeout: 180_000,
    fileParallelism: false,
  },
});
