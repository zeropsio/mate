import type { HqChange } from "@t3tools/shared/hqChanges";
import { expect, it } from "vite-plus/test";
import { changeState, flowChange } from "../../zerops/projectFlow.ts";
import { changeReview } from "../../zerops/reviewVerdict.ts";

// witness: packages/client-runtime/src/zerops/reviewVerdict.ts | pull.mergeRoute?.awaits === "pull_request" → pull.mergeRoute?.awaits === undefined
it("PJ90: A change whose repository merges through GitHub and that GitHub does not have yet offers no Merge and reads as arriving on GitHub in its review and on its row, and the same change in a repository HQ merges itself offers Merge; breaks: a person presses a Merge HQ refuses with github_no_pull.", () => {
  const arriving: HqChange = {
    appId: "merge-lab",
    repo: "api",
    number: 15,
    mateProjectId: "mate",
    branch: "health-check",
    title: "Add a health check",
    body: "Report whether the application is ready.",
    state: "open",
    head: "a".repeat(40),
    mergedSha: null,
    landedHead: null,
    openedAt: "2026-11-19T11:19:00Z",
    mergedAt: null,
    closedAt: null,
    updatedAt: "2026-11-19T11:20:00Z",
    mergeability: "clean",
    behind: false,
    ready: true,
    comments: 0,
    receipt: null,
    mergeRoute: { via: "github", awaits: "pull_request" },
  };
  const central: HqChange = { ...arriving, mergeRoute: { via: "hq" } };

  function project(change: HqChange) {
    const pull = flowChange(change, "https://hq.example");
    const review = changeReview({
      pull,
      mateName: "Nova",
      readout: "read",
      downstream: { production: false, stage: false },
      offered: { merge: true, close: true },
      now: 0,
    });
    return { review, row: changeState(pull) };
  }

  const waiting = project(arriving);
  const ready = project(central);
  expect(waiting.review.primary?.enabled).toBe(false);
  expect(waiting.review.verdict.state).toBe("github-handoff");
  expect(ready.review.primary?.enabled).toBe(true);
  expect(ready.review.verdict.state).toBe("ready");
  expect(waiting.row?.tone).toBe("busy");
  expect(waiting.row?.word).toBe(waiting.review.verdict.title);
  expect(waiting.row?.word).not.toBe(ready.row?.word);
});
