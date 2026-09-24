import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { ZeropsDeployRun } from "~/zerops/useZeropsDeployRun";

import { ZeropsDeployRunView } from "./ZeropsDeployRun";

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
