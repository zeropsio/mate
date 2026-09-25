import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsDeployRun } from "~/zerops/useZeropsDeployRun";

import { failedJob, ZeropsDeployRunView } from "./ZeropsDeployRun";

const FAILED_BUILD: ZeropsDeployRun["state"] = {
  kind: "read",
  runId: 42,
  runNumber: 13,
  jobs: [{ id: 3, name: "build", status: "completed", conclusion: "failure", run_id: 42 }],
};

function run(
  state: ZeropsDeployRun["state"],
  rerun: Pick<ZeropsDeployRun, "rerunning" | "rerunFailure">,
): ZeropsDeployRun {
  return { state, readLog: async () => "", rerun: async () => {}, refresh: () => {}, ...rerun };
}

describe("ZeropsDeployRunView", () => {
  it("says it is redeploying while the rerun's new run is read", () => {
    const html = renderToStaticMarkup(
      <ZeropsDeployRunView
        run={run({ kind: "reading" }, { rerunning: true, rerunFailure: null })}
      />,
    );
    expect(html).toContain("Redeploying");
    expect(html).not.toContain("Reading the build");
  });

  it.each([
    {
      name: "a failed job offers Run again while no rerun is out",
      rerun: { rerunning: false, rerunFailure: null },
      button: /<button[^>]*>Run again<\/button>/u,
      disabled: false,
    },
    {
      name: "a failed job's verb says Redeploying, pressed, while its rerun is out",
      rerun: { rerunning: true, rerunFailure: null },
      button: /<button[^>]*>Redeploying…<\/button>/u,
      disabled: true,
    },
  ])("$name", ({ rerun, button, disabled }) => {
    const html = renderToStaticMarkup(<ZeropsDeployRunView run={run(FAILED_BUILD, rerun)} />);
    const verb = html.match(button)?.[0];
    expect(verb).toBeDefined();
    expect(verb?.includes(`disabled=""`)).toBe(disabled);
  });

  it("says why Gitea refused the last rerun", () => {
    const html = renderToStaticMarkup(
      <ZeropsDeployRunView
        run={run(FAILED_BUILD, {
          rerunning: false,
          rerunFailure: "Gitea refused to run the job again.",
        })}
      />,
    );
    expect(html).toContain("Gitea refused to run the job again.");
    expect(html).toContain("Run again");
  });
});

describe("failedJob", () => {
  it.each<{ name: string; state: ZeropsDeployRun["state"]; expected: number | undefined }>([
    { name: "the job that failed, where the build read has one", state: FAILED_BUILD, expected: 3 },
    {
      name: "none where every job passed",
      state: {
        kind: "read",
        runId: 41,
        runNumber: 12,
        jobs: [{ id: 1, name: "build", status: "completed", conclusion: "success", run_id: 41 }],
      },
      expected: undefined,
    },
    { name: "none while the build is being read", state: { kind: "reading" }, expected: undefined },
    { name: "none where no build was found", state: { kind: "none" }, expected: undefined },
  ])("$name", ({ state, expected }) => {
    expect(failedJob(state)?.id).toBe(expected);
  });
});
