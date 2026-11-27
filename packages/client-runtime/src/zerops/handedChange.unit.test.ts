import { expect, it } from "vite-plus/test";
import { handedChangeOfCall } from "./model/handedChange.ts";

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
