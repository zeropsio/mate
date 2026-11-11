// Two projects as apps/web's: "shared" lets its files share one worker's modules and globals.
import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    maxWorkers: 1,
    projects: [
      { extends: true, test: { name: "shared", isolate: false, include: ["shared/*.case.mts"] } },
      { extends: true, test: { name: "own", include: ["own/*.case.mts"] } },
    ],
  },
});
