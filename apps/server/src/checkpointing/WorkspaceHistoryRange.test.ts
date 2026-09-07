import { describe, expect, it } from "vite-plus/test";
import {
  CheckpointRef,
  TurnId,
  type CheckpointHistory,
  type OrchestrationCheckpointSummary,
} from "@t3tools/contracts";
import { workspaceHistoryRange } from "./WorkspaceHistoryRange.ts";

const checkpoint = (
  n: number,
  services: string[],
  policyVersion = "git-v1",
): OrchestrationCheckpointSummary => ({
  turnId: TurnId.make(`turn-${n}`),
  checkpointTurnCount: n,
  checkpointRef: CheckpointRef.make(`refs/test/${n}`),
  status: "ready",
  files: [],
  assistantMessageId: null,
  completedAt: "2026-09-07T10:00:00.000Z",
  history: {
    runId: `run-${n}`,
    coverage: "complete",
    semantics: "observed-workspace",
    representation: "git-normalized",
    policyVersion,
    roots: services.map((name) => ({
      root: { rootId: name, label: name, remotePath: "/var/www", pathPrefix: `${name}/` },
      before: {
        status: "captured",
        oid: `${n}-before-${name}`,
        ref: CheckpointRef.make(`refs/${n}/before`),
        startedAt: "2026-09-07T10:00:00.000Z",
        completedAt: "2026-09-07T10:00:00.000Z",
      },
      after: {
        status: "captured",
        oid: `${n}-after-${name}`,
        ref: CheckpointRef.make(`refs/${n}/after`),
        startedAt: "2026-09-07T10:01:00.000Z",
        completedAt: "2026-09-07T10:01:00.000Z",
      },
      files: [],
    })),
  } satisfies CheckpointHistory,
});

describe("workspaceHistoryRange", () => {
  it("one turn uses its actual before even when a previous turn exists", () => {
    const a = checkpoint(1, ["api"]),
      b = checkpoint(2, ["api"]);
    expect(workspaceHistoryRange([a, b], 1, 2)).toEqual(b.history);
  });
  it("whole conversation uses first before and final after by root identity", () => {
    const result = workspaceHistoryRange([checkpoint(1, ["api"]), checkpoint(2, ["api"])], 0, 2);
    expect(result?.roots[0]?.before).toMatchObject({ oid: "1-before-api" });
    expect(result?.roots[0]?.after).toMatchObject({ oid: "2-after-api" });
    expect(result?.coverage).toBe("complete");
  });
  it("a service added midway cannot be compared against another service or empty tree", () => {
    const result = workspaceHistoryRange(
      [checkpoint(1, ["api"]), checkpoint(2, ["api", "app"])],
      0,
      2,
    );
    expect(result?.roots[1]?.before.status).toBe("missing-baseline");
    expect(result?.coverage).toBe("partial");
  });
  it("a source absent at the final endpoint has no inferred end", () => {
    const result = workspaceHistoryRange(
      [checkpoint(1, ["api", "app"]), checkpoint(2, ["api"])],
      0,
      2,
    );
    expect(result?.roots.find((r) => r.root.rootId === "app")?.after.status).toBe("missing-end");
  });
  it("gaps in recorded runs are explicitly partial", () => {
    expect(
      workspaceHistoryRange([checkpoint(1, ["api"]), checkpoint(3, ["api"])], 0, 3)?.coverage,
    ).toBe("partial");
  });
  it("a policy change does not produce a misleading deletion diff", () => {
    const result = workspaceHistoryRange(
      [checkpoint(1, ["api"]), checkpoint(2, ["api"], "git-v2")],
      0,
      2,
    );
    expect(result?.roots[0]?.before.status).toBe("unsupported");
  });
});
