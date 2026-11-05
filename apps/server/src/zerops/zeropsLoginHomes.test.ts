import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";

import { manualFileWatch } from "./testing/manualFileWatch.ts";
import { makeLoginHomes } from "./zeropsLoginHomes.ts";

// The test clock stands still: nothing here moves but the file and its watch.
it.layer(NodeServices.layer)(
  "A file another process writes is read at its change; no loop re-reads it on a timer, and each wait keeps only its deadline",
  (it) => {
    it.effect(
      "a credential the sign-in writes after its success is moved at its write, never at a later look",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const home = yield* fs.makeTempDirectoryScoped();
            const changes = yield* manualFileWatch;
            const looked = yield* Deferred.make<void>();
            const homes = yield* makeLoginHomes(home, { watch: () => changes.watch }).pipe(
              Effect.provideService(FileSystem.FileSystem, {
                ...fs,
                exists: (path) =>
                  fs
                    .exists(path)
                    .pipe(
                      Effect.tap((present) =>
                        present ? Effect.void : Deferred.succeed(looked, undefined),
                      ),
                    ),
              }),
            );
            const target = { agentId: "codex", key: "codex" } as const;
            yield* homes.prepare(target);

            const commit = yield* homes.commit(target).pipe(Effect.forkChild);
            yield* Deferred.await(looked);
            yield* fs.writeFileString(`${home}/.mate/pending/codex/auth.json`, "new");
            yield* changes.change;
            yield* Fiber.join(commit);

            assert.equal(yield* fs.readFileString(`${home}/.codex/auth.json`), "new");
          }),
        ),
      { timeout: 10_000 },
    );
  },
);
