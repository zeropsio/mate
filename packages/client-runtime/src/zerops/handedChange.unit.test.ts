import { expect, it } from "vite-plus/test";
import { changesLeftIn, handedChangeOfCall } from "./model/handedChange.ts";
import type { ZeropsCallStatus, ZeropsTimelineEntry } from "./model/types.ts";

const answer = (pullRequest: unknown, repo = "site") =>
  JSON.stringify({
    service: "apppool-6",
    branch: "home-thanks-line",
    pullRequest,
    pullRequestUrl: `https://hq.example.invalid/changes/app-1/${repo}/7`,
  });

// witness: packages/client-runtime/src/zerops/model/handedChange.ts | const HANDOVER_ACTIONS: ReadonlySet<string> = new Set(["open-change", "describe-change"]); → const HANDOVER_ACTIONS: ReadonlySet<string> = new Set(["open-change", "describe-change", "close-change"]);
it("ZV217: The change a call hands the person is the one zcp's answer to its open-change or describe-change names, by the repository its address names and the number it answers, and none for its close-change, an unfinished or failed call, or another tool's; breaks: a finishing message's Open draft opens a closed change, or another change than the one its turn handed over", () => {
  const call = (
    action: string,
    resultText: string | undefined,
    over: { toolName?: string; completed?: boolean } = {},
  ) =>
    handedChangeOfCall({
      toolName: over.toolName ?? "zerops_workflow",
      input: { action },
      completed: over.completed ?? true,
      resultText,
    });
  const seven = { repository: "site", number: 7 };
  expect(call("open-change", answer(7))).toEqual(seven);
  expect(call("describe-change", answer(7))).toEqual(seven);
  expect(call("open-change", answer(7, "my%20site"))).toEqual({ repository: "my site", number: 7 });
  expect(call("close-change", answer(7))).toBeNull();
  expect(call("open-change", answer(8))).toBeNull();
  expect(call("open-change", answer(7), { completed: false })).toBeNull();
  expect(call("open-change", undefined)).toBeNull();
  expect(call("open-change", "Change #7 is open.")).toBeNull();
  expect(call("open-change", answer(7), { toolName: "zerops_deploy" })).toBeNull();
});

const callEntry = (
  id: string,
  action: string,
  status: ZeropsCallStatus,
  resultText: string | undefined,
): ZeropsTimelineEntry => ({
  kind: "generic-call",
  key: id,
  anchorAt: "2026-11-27T22:31:00.000Z",
  anchorActivityId: id,
  call: {
    id,
    turnId: "turn-1",
    toolName: "zerops_workflow",
    input: { action },
    status,
    ...(resultText === undefined ? {} : { resultText }),
    truncated: false,
    startedAt: "2026-11-27T22:31:00.000Z",
    anchorActivityId: id,
    rowIds: new Set([id]),
    agentInternal: false,
  },
});

// witness: packages/client-runtime/src/zerops/model/handedChange.ts | completed: entry.call.status === "completed", → completed: entry.call.status !== "completed",
it("ZV+1: A conversation's own changes are each one its runs pushed or a finished zcp handover named, though no message links it, and never one a call is still opening or closes; breaks: after Add to your app the conversation draws no row saying the app has the change", () => {
  expect([
    ...changesLeftIn([
      callEntry("a", "open-change", "completed", answer(7)),
      callEntry("b", "open-change", "inProgress", undefined),
      callEntry("c", "close-change", "completed", answer(7, "api")),
    ]),
  ]).toEqual(["site#7"]);
});
