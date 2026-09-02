import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import { getPipelineState } from "@t3tools/client-runtime/zerops/activity/pipelineState";
import type { ActivityState } from "@t3tools/client-runtime/zerops/activity/reducer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { DeployPlatformOverlayBody, ZeropsDeployPendingCard } from "./ZeropsDeployActivityCard";

function process(overrides: Partial<ActivityProcess>): ActivityProcess {
  return {
    id: "p1",
    projectId: "proj-1",
    serviceStackIds: ["svc-1"],
    status: "RUNNING",
    actionName: "stack.deploy",
    created: "2026-09-02T10:00:00.000Z",
    ...overrides,
  };
}

const render = (state: ActivityState) =>
  renderToStaticMarkup(<DeployPlatformOverlayBody hostname="kanbandev" state={state} />);

describe("DeployPlatformOverlayBody", () => {
  it("renders nothing for idle — the row falls back to the ordinary tool block", () => {
    expect(render({ kind: "idle" })).toBe("");
  });

  it("renders nothing for unavailable", () => {
    expect(render({ kind: "unavailable", reason: "forbidden" })).toBe("");
  });

  it("renders nothing for a resolved result with no BUILD_TRIGGERED continuation", () => {
    expect(render({ kind: "resolved" })).toBe("");
  });

  it("says 'Platform' and the hostname while searching, with the elapsed time", () => {
    const markup = render({ kind: "searching", elapsedMs: 4_000 });
    expect(markup).toContain("Platform");
    expect(markup).toContain("kanbandev");
    expect(markup).toContain("4s");
  });

  it("renders the pipeline steps and a 'Platform' label once observed", () => {
    const markup = render({
      kind: "observed",
      observation: {
        pipeline: getPipelineState({ status: "BUILDING", build: { startDate: "t" } }),
        chips: [],
        atMs: Date.now(),
      },
    });
    expect(markup).toContain("Platform");
    expect(markup).toContain("Run build commands");
  });

  it("shows secondary-action chips alongside the observed steps", () => {
    const markup = render({
      kind: "observed",
      observation: {
        pipeline: getPipelineState({ status: "BUILDING" }),
        chips: [process({ actionName: "stack.enableSubdomainAccess" })],
        atMs: Date.now(),
      },
    });
    expect(markup).toContain("stack.enableSubdomainAccess");
  });

  it("reports the platform outcome once settled, without a card verdict", () => {
    const markup = render({
      kind: "settledOnPlatform",
      observation: {
        pipeline: getPipelineState({ status: "ACTIVE" }),
        chips: [],
        atMs: Date.now(),
      },
      outcome: "finished",
    });
    expect(markup).toContain("Platform reports finished");
    expect(markup).toContain("waiting for the agent");
    expect(markup).not.toContain("✓");
    expect(markup).not.toContain("✗");
  });

  it("marks stale data as 'Platform: stale' with its age", () => {
    const markup = render({
      kind: "stale",
      observation: {
        pipeline: getPipelineState({ status: "BUILDING" }),
        chips: [],
        atMs: Date.now(),
      },
      staleMs: 12_000,
    });
    expect(markup).toContain("Platform: stale");
    expect(markup).toContain("12s");
  });

  it("renders the BUILD_TRIGGERED continuation below a resolved verdict", () => {
    const markup = render({
      kind: "resolved",
      continuation: {
        pipeline: getPipelineState({ status: "BUILDING" }),
        chips: [],
        atMs: Date.now(),
      },
    });
    expect(markup).toContain("Platform reports");
    expect(markup).not.toBe("");
  });
});

describe("ZeropsDeployPendingCard", () => {
  it("renders the 'Deploy · <hostname>' kicker and the searching body", () => {
    const markup = renderToStaticMarkup(
      <ZeropsDeployPendingCard
        hostname="kanbandev"
        state={{ kind: "searching", elapsedMs: 1_000 }}
      />,
    );
    expect(markup).toContain("Deploy · kanbandev");
    expect(markup).toContain("Platform");
    expect(markup).toContain('data-zerops-card-kind="deploy-pending"');
  });
});
