/**
 * The Git tab lists every runtime the project has, and asks each one's status at
 * `/var/www/<host>`. A runtime with no checkout mounted there (a service nobody mounted, a
 * runtime that is no dev service) has no repository to read: git says so, never a refusal a
 * reader would wait on for good.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/process";

import { ServerConfig } from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { makeGitVcsDriverCore } from "../vcs/GitVcsDriverCore.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import { makeZeropsGitSpawner } from "./ZeropsGitSpawner.ts";
import type { ZeropsRepositories } from "./ZeropsRepositorySource.ts";

const mounted: ZeropsRepositories = {
  _tag: "available",
  repositories: [{ host: "appdev", mountPath: "/var/www/appdev", remotePath: "/var/www" }],
};

describe("a runtime with no checkout mounted", () => {
  it.effect("reads as no repository, to the repository check and to the status alike", () =>
    Effect.gen(function* () {
      const platform = yield* ChildProcessSpawner.ChildProcessSpawner;
      const spawner = makeZeropsGitSpawner({
        enabled: true,
        repositories: Effect.succeed(mounted),
        refresh: Effect.succeed(mounted),
        inner: platform,
      });
      const withSpawner = Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner);

      const repository = yield* GitVcsDriver.makeVcsDriver.pipe(
        Effect.flatMap((driver) => driver.detectRepository("/var/www/imgrun")),
        Effect.provide(VcsProcess.layer),
        withSpawner,
      );
      const status = yield* makeGitVcsDriverCore().pipe(
        Effect.flatMap((driver) => driver.statusDetailsLocal("/var/www/imgrun")),
        withSpawner,
      );

      assert.isNull(repository);
      assert.isFalse(status.isRepo);
    }).pipe(
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "mate-unmounted-config-" }).pipe(
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
  );
});
