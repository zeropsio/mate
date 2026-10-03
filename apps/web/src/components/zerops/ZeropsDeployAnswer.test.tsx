import type { ReviewPress } from "@t3tools/client-runtime/zerops";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { answeredDeploys } from "./ZeropsDeployAnswer";

const ANSWER: HqDeployAnswer = {
  jobs: [
    {
      environment: "stage",
      kind: "deploy",
      service: "web",
      sha: "5c3ea18b00000000000000000000000000000000",
      job: "3",
      state: "queued",
      processId: null,
      behind: "2",
      reason: null,
    },
  ],
  note: "the production tier could not be read",
};

// A merge's review, a release's: what the press asked for is said under its verdict once done.
describe("answeredDeploys — a press's deploys, where HQ answered them", () => {
  it("says each environment's jobs and HQ's note once the press is done", () => {
    const markup = renderToStaticMarkup(<>{answeredDeploys({ kind: "done", deploys: ANSWER })}</>);
    expect(markup).toContain("stage");
    expect(markup).toContain("web 5c3ea18 queued behind the build under way");
    expect(markup).toContain('data-zerops-job-state="queued"');
    expect(markup).toContain("the production tier could not be read");
  });

  it.each<[string, ReviewPress]>([
    ["idle", { kind: "idle" }],
    ["running", { kind: "running" }],
    ["refused", { kind: "refused", reason: "Main moved." }],
    ["done, its answer lost", { kind: "done" }],
  ])("says nothing while %s", (_name, press) => {
    expect(answeredDeploys(press)).toBeUndefined();
  });
});
