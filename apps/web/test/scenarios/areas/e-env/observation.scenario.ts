import { scenarioSuite } from "../../harness/suite.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { environmentFixture } from "./fake.ts";
import { environmentActions, environmentJobs } from "./dsl.ts";

describe("E: deploy observation and the person's next action", () => {
  scenarioSuite((it) => {
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
          const before = (yield* environmentJobs(f, "stage", (jobs) =>
            jobs.some((job) => job.sha === sha),
          )).filter((job) => job.sha === sha);
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
          const after = (yield* environmentJobs(f, "stage", (jobs) =>
            jobs.some((job) => job.sha === sha && job.id !== before[0]!.id),
          )).filter((job) => job.sha === sha);
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
