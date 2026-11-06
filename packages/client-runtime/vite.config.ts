import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Share the contract and Effect graphs; tests clean up their own state between files.
    isolate: false,
    globalSetup: ["../shared/src/testing/longTempDir.ts"],
    // Tables declare tests through `it.each(rows)("$title", …)`: the title is the row's whole sentence.
    taskTitleValueFormatTruncate: Number.MAX_SAFE_INTEGER,
  },
});
