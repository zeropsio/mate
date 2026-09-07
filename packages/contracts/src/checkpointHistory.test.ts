import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";
import { OrchestrationCheckpointSummary, ThreadTurnDiff } from "./orchestration.ts";

const decodeCheckpoint = Schema.decodeUnknownSync(OrchestrationCheckpointSummary);
const decodeDiff = Schema.decodeUnknownSync(ThreadTurnDiff);

const checkpoint = {
  turnId: "turn-1",
  checkpointTurnCount: 1,
  checkpointRef: "refs/mate/run-1/after",
  status: "ready",
  files: [],
  assistantMessageId: null,
  completedAt: "2026-09-07T10:00:00.000Z",
};

describe("checkpoint history wire compatibility", () => {
  it("keeps legacy summaries readable without claiming complete coverage", () => {
    const decoded = decodeCheckpoint(checkpoint);
    expect(decoded).not.toHaveProperty("history");
  });
  it("preserves incomplete roots even when no files were recorded", () => {
    const history = {
      runId: "run-1",
      coverage: "partial",
      semantics: "observed-workspace",
      representation: "git-normalized",
      policyVersion: "git-v1",
      roots: [
        {
          root: { rootId: "root-1", label: "api", remotePath: "/var/www", pathPrefix: "api/" },
          before: { status: "missing-baseline", reason: "First observed during the run." },
          after: { status: "unavailable", reason: "Service cannot be reached." },
        },
      ],
    };
    expect(decodeCheckpoint({ ...checkpoint, history })).toEqual({ ...checkpoint, history });
  });
  it("preserves available detail alongside an independently missing source", () => {
    const result = {
      threadId: "thread-1",
      fromTurnCount: 0,
      toTurnCount: 1,
      diff: "available patch",
      coverage: "partial",
      roots: [
        { rootId: "root-1", label: "api", pathPrefix: "api/", status: "available" },
        {
          rootId: "root-2",
          label: "web",
          pathPrefix: "web/",
          status: "missing-objects",
          reason: "Snapshot objects are absent.",
        },
      ],
    };
    expect(decodeDiff(result)).toEqual(result);
  });
});
