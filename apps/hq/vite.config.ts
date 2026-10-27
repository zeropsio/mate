import "vite-plus/test/config";
import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";
import { readMigrations } from "./src/migrationFiles.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      globalSetup: ["../../scripts/test-postgres.setup.ts"],
      // Lazy database migrations, Core startup and real Git I/O run inside cases. Their wall
      // time under contention is not an assertion; CI's 10-minute job guard owns hangs.
      testTimeout: 660_000,
      hookTimeout: 660_000,
    },
    pack: {
      entry: ["src/main.ts"],
      outDir: "dist",
      clean: true,
      define: {
        // Whoever builds names the build (the rig's deploy script stamps sha and time), so two
        // deploys of one tree stay distinguishable in /health.
        __HQ_BUILD__: JSON.stringify(process.env["HQ_BUILD"] ?? "unstamped"),
        // The bundle has no `src/` to read `migrations/*.sql` from: they ride inside it.
        __HQ_MIGRATIONS__: JSON.stringify(readMigrations(`${import.meta.dirname}/src/migrations`)),
      },
      // The deploy runs no `npm install`: every dependency is inlined, and `onlyImport: []` fails
      // the build if the bundle still imports anything but a Node builtin.
      deps: {
        alwaysBundle: (id: string) => !id.startsWith("node:"),
        // ws's optional native accelerators: left out, ws falls back to its JS paths.
        neverBundle: ["bufferutil", "utf-8-validate"],
        onlyBundle: false,
        onlyImport: [],
      },
    },
  }),
);
