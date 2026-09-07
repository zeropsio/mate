import { expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { buildCheckpointDiffTargets } from "./queryTargets";

it("uses the individual turn endpoint for a first-run per-service comparison", () => {
  const targets = buildCheckpointDiffTargets({
    environmentId: EnvironmentId.make("env"),
    threadId: ThreadId.make("thread"),
    fromTurnCount: 0,
    toTurnCount: 1,
    ignoreWhitespace: true,
    rootId: "api",
    runId: "run-1",
    cacheScope: "run-1",
  });
  expect(targets.fullThread).toBeNull();
  expect(targets.turn).toMatchObject({
    cacheScope: "run-1",
    input: { fromTurnCount: 0, toTurnCount: 1, rootId: "api", runId: "run-1" },
  });
});
it("keeps the legacy full-thread endpoint readable without a run guard", () => {
  const targets = buildCheckpointDiffTargets({
    environmentId: EnvironmentId.make("env"),
    threadId: ThreadId.make("thread"),
    fromTurnCount: 0,
    toTurnCount: 1,
    ignoreWhitespace: false,
  });
  expect(targets.turn).toBeNull();
  expect(targets.fullThread?.input).not.toHaveProperty("runId");
});
