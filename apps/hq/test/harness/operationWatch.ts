/** The old fake advances builds on reads. Sampling is confined to this test fixture. */
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import type { OperationWatch } from "../../src/operationWatch.ts";
import { fakeZeropsDeploy, type FakeWorld } from "./zeropsFake.ts";

export const fakeOperationWatch = (world: FakeWorld): OperationWatch => ({
  watch: (target) =>
    Stream.tick(20).pipe(
      Stream.mapEffect(() =>
        Effect.gen(function* () {
          const token =
            [...world.tokens].find(([, token]) =>
              token.projects.some((project) => project.projectId === target.projectId),
            )?.[0] ?? "org-key";
          const api = fakeZeropsDeploy(world);
          const processes = yield* Effect.forEach(target.processIds, (id) =>
            api
              .process(id)(Redacted.make(token))
              .pipe(
                Effect.map((process) => ({
                  id,
                  status: process.status,
                  error: { message: process.failure },
                })),
              ),
          );
          const version =
            target.versionId === null
              ? null
              : {
                  id: target.versionId,
                  ...(yield* api.appVersion(target.versionId)(Redacted.make(token))),
                };
          return { phase: "live" as const, processes, version };
        }).pipe(
          Effect.catchTag("ZeropsUnavailable", () =>
            Effect.succeed({ phase: "recovering" as const, processes: [], version: null }),
          ),
        ),
      ),
    ),
});
