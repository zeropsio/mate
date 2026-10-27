import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["../shared/src/testing/longTempDir.ts"],
    // Tables declare tests through `it.each(rows)("$title", …)`: the title is the row's whole sentence.
    taskTitleValueFormatTruncate: Number.MAX_SAFE_INTEGER,
  },
});
