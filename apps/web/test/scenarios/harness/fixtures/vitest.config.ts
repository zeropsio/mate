import { defineConfig } from "vite-plus/test/config";
import * as NodeURL from "node:url";

// Isolated child runs prove suite failures without failing the parent regression suite.
export default defineConfig({
  root: NodeURL.fileURLToPath(new URL("../../../../", import.meta.url)),
  test: {
    include: ["test/scenarios/harness/fixtures/browserHealth.fixture.ts"],
    environment: "node",
    testTimeout: 10_000,
  },
});
