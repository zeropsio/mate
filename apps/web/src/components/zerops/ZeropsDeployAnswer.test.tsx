import type { ReviewPress } from "@t3tools/client-runtime/zerops";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

/** HQ's navigation as the answer follows it: each application's environments with their jobs. */
const navigation = vi.hoisted(() => ({ environments: {} as Record<string, unknown> }));
vi.mock("~/zerops/activity/useProjectActivity", async (original) => {
  const activity = await original<typeof import("~/zerops/activity/useProjectActivity")>();
  return {
    ...activity,
    useProjectActivityRead: () => activity.EMPTY_PROJECT_ACTIVITY_SNAPSHOT,
  };
});
vi.mock("~/zerops/projectFlows", () => ({
  useEveryAppId: () => Object.keys(navigation.environments),
  useAppsEnvironments: () => navigation.environments,
}));

import { answeredDeploys, useReviewDeploys, ZeropsDeployAnswer } from "./ZeropsDeployAnswer";

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

// A merge's review, a release's: the answer replaces its service's deploy line once done.
describe("answeredDeploys — a press's deploys, where HQ answered them", () => {
  it("says each environment's jobs and HQ's note once the press is done", () => {
    const markup = renderToStaticMarkup(
      <ZeropsDeployAnswer answer={answeredDeploys({ kind: "done", deploys: ANSWER })} />,
    );
    expect(markup).not.toContain("stage");
    expect(markup).toContain("queued behind the build under way");
    expect(markup).toContain('data-zerops-job-state="queued"');
    expect(markup).toContain("the production tier could not be read");
  });

  it("replaces each answered service's plan and keeps environments, reasons and unanswered services", () => {
    const answer: HqDeployAnswer = {
      jobs: [
        { ...ANSWER.jobs[0]!, state: "refused", reason: "Zerops did not answer: timeout" },
        {
          ...ANSWER.jobs[0]!,
          environment: "production",
          state: "skipped",
          reason: "No recipe at this commit",
        },
      ],
      note: ANSWER.note,
    };
    const markup = renderToStaticMarkup(
      <ZeropsDeployAnswer
        answer={answer}
        rows={[
          { service: "web", line: "redeploys from 5c3ea18" },
          { service: "api", line: "redeploys from b21d904" },
        ]}
      />,
    );
    expect(markup).toContain("stage · web");
    expect(markup).toContain("production · web");
    expect(markup.match(/data-zerops-job-state="refused"/g)).toHaveLength(1);
    expect(markup.match(/data-zerops-job-state="skipped"/g)).toHaveLength(1);
    expect(markup.match(/Zerops did not answer: timeout/g)).toHaveLength(1);
    expect(markup.match(/No recipe at this commit/g)).toHaveLength(1);
    expect(markup).not.toContain("redeploys from 5c3ea18");
    expect(markup).toContain("redeploys from b21d904");
  });

  it.each<[string, ReviewPress]>([
    ["idle", { kind: "idle" }],
    ["running", { kind: "running" }],
    ["refused", { kind: "refused", reason: "Main moved." }],
    ["done, its answer lost", { kind: "done" }],
    ["done, no deploy requested", { kind: "done", deploys: { jobs: [], note: "  " } }],
  ])("says nothing while %s", (_name, press) => {
    expect(answeredDeploys(press)).toBeUndefined();
  });
});

const job = {
  id: "3",
  kind: "deploy",
  state: "building",
  reason: null,
  processId: "p3",
  appVersionId: "v3",
};
const environmentsWith = (streamed: object) => ({
  app: {
    environments: [
      {
        id: "prod-id",
        target: { kind: "zerops", projectId: "prod-id" },
        name: "renamed",
        jobs: [streamed],
      },
    ],
    refused: null,
  },
});
it("offers the answered job's inspection through its HQ project id, even after a rename", () => {
  navigation.environments = environmentsWith(job);
  const markup = renderToStaticMarkup(
    <ZeropsDeployAnswer
      answer={{ ...ANSWER, jobs: [{ ...ANSWER.jobs[0]!, state: "building", processId: "p3" }] }}
    />,
  );
  expect(markup).toContain("View deploy");
  expect(markup).toContain('data-zerops-deploy-job="3"');
});

// HQ's navigation is the source of truth: the answer said where a job stood when the request ended.
describe("an answered job follows HQ's stream to its end", () => {
  const streamed = (state: string, reason: string | null = null) =>
    environmentsWith({ ...job, state, reason });
  const building: HqDeployAnswer = {
    ...ANSWER,
    jobs: [{ ...ANSWER.jobs[0]!, state: "building", processId: "p3" }],
  };

  it.each([
    ["live", null, ">live<"],
    ["failed", "build broke", "failed: build broke"],
  ])("says %s once HQ's job has ended", (state, reason, said) => {
    navigation.environments = streamed(state, reason);
    const markup = renderToStaticMarkup(<ZeropsDeployAnswer answer={building} />);
    expect(markup).toContain(said);
    expect(markup).toContain(`data-zerops-job-state="${state}"`);
    expect(markup).not.toContain("building");
  });
});

// HQ answered before planning the merge's rollout: its review waits, then follows what was planned.
describe("a merge whose answer handed planning over", () => {
  const MERGED = "5c3ea18b00000000000000000000000000000000";
  const press: ReviewPress = {
    kind: "done",
    deploys: {
      jobs: [],
      note: "HQ plans these deploys once the organisation's other rollout is planned",
      planned: false,
    },
    rollout: { appId: "app", cause: "merge", ref: MERGED },
  };
  function Review() {
    return <ZeropsDeployAnswer answer={useReviewDeploys(press)} />;
  }

  it.each([
    {
      name: "says it waits for planning while HQ shows none of its jobs",
      streamed: { ...job, cause: "release", ref: MERGED },
      says: ["Waiting for planning."],
      never: ["View deploy", "other rollout"],
    },
    {
      name: "follows the planned jobs and their log once HQ shows them",
      streamed: { ...job, service: "web", sha: MERGED, cause: "merge", ref: MERGED },
      says: ["building", "View deploy", 'data-zerops-deploy-job="3"'],
      never: ["Waiting for planning."],
    },
  ])("$name", ({ streamed, says, never }) => {
    navigation.environments = environmentsWith(streamed);
    const markup = renderToStaticMarkup(<Review />);
    for (const words of says) expect(markup).toContain(words);
    for (const words of never) expect(markup).not.toContain(words);
  });
});
