import { assert } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { makeArchivedCore } from "./preExpandCore.ts";

// 0054's oldest supported writer; unmodified git archive with the loader's recorded paths.
export const WRITER_FLOOR_SHA = "e28fc0b57309bcb2ea4fbc770b4be38cc7587cc9";
const ARCHIVE = "apps/hq/test/fixtures/core-e28fc0b573.tar.gz";
const DIGEST = "a9f0d6cdcf42dc2a7c728b7268acb92ae039eaf0c61ccebfd7a7c125467efa7c";

export const writerFloorCore = makeArchivedCore(ARCHIVE, DIGEST).pipe(
  Effect.tap((core) =>
    Effect.sync(() => {
      const migrations = core.oldMigrations.treeMigrations().map((file) => file.name);
      assert.include(migrations, "0052_environment_identity.sql");
      assert.notInclude(migrations, "0054_git_targets_expand.sql");
    }),
  ),
);
