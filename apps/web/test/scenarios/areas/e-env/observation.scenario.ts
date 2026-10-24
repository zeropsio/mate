import { inProcessCore } from "../../harness/hqCore.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { tempPostgresLayer } from "../../../../../hq/test/harness/tempPostgres.ts";
import { environmentFixture } from "./fake.ts";
import { environmentActions } from "./dsl.ts";

describe("E: deploy observation and the person's next action", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a pending build names the next action and Run again starts an explicit new operation",
      () =>
        Effect.gen(function* () {
          const f = yield* environmentFixture;
          const a = environmentActions(f);
          const answerBuilds = f.unansweredBuilds();
          yield* f.s.given.signedIn;
          yield* a.when.open("stage");
          const sha = yield* f.merge();
          yield* a.then.text("Waiting for Zerops to start the build.");
          yield* a.then.text("Check it in Zerops, or run it again.");
          const before = yield* inProcessCore(f.s.drivers.core).sql<{
            id: string;
          }>`SELECT id::text AS id FROM hq_deploy_job WHERE project_id = ${"Shop-stage"} AND sha = ${sha}`;
          expect(before).toHaveLength(1);
          answerBuilds();
          yield* Effect.promise(() =>
            f.s.page
              .locator(
                '[data-zerops-surface="stop-service-job"] ::-p-aria(Run again[role="button"])',
              )
              .click(),
          );
          yield* a.then.text(`Building ${sha.slice(0, 7)}`);
          const after = yield* inProcessCore(f.s.drivers.core).sql<{
            id: string;
            state: string;
            cause: string;
          }>`SELECT j.id::text AS id, j.state, r.cause FROM hq_deploy_job j JOIN hq_rollout r ON r.id = j.rollout_id WHERE j.project_id = ${"Shop-stage"} AND j.sha = ${sha}`;
          expect(after).toHaveLength(2);
          const previous = after.find((job) => job.id === before[0]!.id);
          const successor = after.find((job) => job.id !== before[0]!.id);
          expect(previous?.state).toBe("superseded");
          expect(successor?.id).not.toBe(before[0]!.id);
          expect(successor?.cause).toBe("run_again");
          expect(successor?.state).toBe("building");
          yield* a.when.finish("stage");
          yield* a.then.text("Deployed");
        }),
    );
  });
});
