import { describe, expect, it } from "vite-plus/test";
import {
  checkpointDetailState,
  legacyCheckpointDiffNotice,
  checkpointHistoryNotice,
  checkpointRootResponseError,
} from "./checkpointHistory.ts";

describe("checkpoint review coverage", () => {
  it("never treats an empty legacy response as proven no changes", () => {
    expect(checkpointDetailState({ diff: "" }, null, false)).toEqual({
      kind: "unavailable",
      message: "No recorded patch. Coverage of this older history is unknown.",
    });
  });
  it("reports an empty result only when comparison succeeded completely", () => {
    expect(checkpointDetailState({ diff: "", coverage: "complete" }, null, false).kind).toBe(
      "empty",
    );
    expect(checkpointDetailState({ diff: "", coverage: "partial" }, null, false).kind).toBe(
      "unavailable",
    );
  });
  it("keeps useful changes visible while another service fails", () => {
    expect(checkpointDetailState({ diff: "patch", coverage: "partial" }, null, false).kind).toBe(
      "changes",
    );
  });
  it("shows the terminal error rather than a loading placeholder", () => {
    expect(checkpointDetailState(null, "Disconnected", true)).toEqual({
      kind: "unavailable",
      message: "Disconnected",
    });
  });
  it("labels unknown and partial summaries without inventing totals", () => {
    expect(checkpointHistoryNotice(undefined)).toBe("Coverage of this older history is unknown.");
    expect(checkpointHistoryNotice({ coverage: "partial" })).toBe(
      "History is incomplete. Recorded file counts cover available snapshots only.",
    );
  });
});

it("rejects aggregate legacy detail for a per-service request", () => {
  expect(checkpointRootResponseError({}, "api")).not.toBeNull();
  expect(checkpointRootResponseError({}, undefined)).toBeNull();
  expect(
    checkpointRootResponseError(
      { roots: [{ rootId: "web", label: "web", pathPrefix: "web/", status: "available" }] },
      "api",
    ),
  ).not.toBeNull();
});

it("explains inferred legacy membership and each missing service without discarding available changes", () => {
  const result = {
    diff: "application patch",
    coverage: "unknown" as const,
    roots: [
      { rootId: "app", label: "Application", pathPrefix: "app/", status: "available" as const },
      {
        rootId: "api",
        label: "API",
        pathPrefix: "api/",
        status: "missing-objects" as const,
        reason: "The saved snapshot is absent.",
      },
    ],
  };
  expect(legacyCheckpointDiffNotice(result)).toContain("membership");
  expect(legacyCheckpointDiffNotice(result)).toContain("coverage is unknown");
  expect(legacyCheckpointDiffNotice(result)).toContain("API: The saved snapshot is absent.");
  expect(checkpointDetailState(result, null, false).kind).toBe("changes");
  expect(checkpointDetailState({ ...result, diff: "" }, null, false).kind).toBe("unavailable");
});
