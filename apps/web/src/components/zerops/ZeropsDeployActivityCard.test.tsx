import type { ActivityProcess } from "@t3tools/client-runtime/zerops/activity/dto";
import { getPipelineState } from "@t3tools/client-runtime/zerops/activity/pipelineState";
import type { ActivityState } from "@t3tools/client-runtime/zerops/activity/reducer";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  DeployPlatformOverlayBody,
  ZeropsDeployPendingCard,
  activityStateHasPendingOverlayContent,
} from "./ZeropsDeployActivityCard";

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

  /**
   * The agent's own result has ALREADY landed on this card (that is what
   * "resolved" means) — so unlike `settledOnPlatform` on the pending path,
   * this copy must never claim to be "waiting for the agent's result". While
   * the platform pipeline is not yet terminal it uses the same "as of Ns ago"
   * line as the still-running `observed` state.
   */
  it("shows the BUILD_TRIGGERED continuation's elapsed line while its pipeline is not yet terminal", () => {
    const markup = render({
      kind: "resolved",
      continuation: {
        pipeline: getPipelineState({ status: "BUILDING" }),
        chips: [],
        atMs: Date.now(),
      },
    });
    expect(markup).toContain(
      '<p class="text-muted-foreground text-xs">Platform · as of 0s ago</p>',
    );
    expect(markup).not.toContain("waiting for the agent");
  });

  it("reports the BUILD_TRIGGERED continuation's terminal outcome with no 'waiting' claim", () => {
    const markup = render({
      kind: "resolved",
      continuation: {
        pipeline: getPipelineState({ status: "ACTIVE" }),
        chips: [],
        atMs: Date.now(),
      },
    });
    expect(markup).toContain(
      '<p class="text-muted-foreground text-xs">Platform reports finished</p>',
    );
    expect(markup).not.toContain("waiting for the agent");
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

describe("activityStateHasPendingOverlayContent — the pending-card gate", () => {
  it("is true for every state the pending card actually draws", () => {
    expect(activityStateHasPendingOverlayContent({ kind: "searching", elapsedMs: 0 })).toBe(true);
    expect(
      activityStateHasPendingOverlayContent({
        kind: "observed",
        observation: { pipeline: getPipelineState({ status: "BUILDING" }), chips: [], atMs: 0 },
      }),
    ).toBe(true);
    expect(
      activityStateHasPendingOverlayContent({
        kind: "settledOnPlatform",
        observation: { pipeline: getPipelineState({ status: "ACTIVE" }), chips: [], atMs: 0 },
        outcome: "finished",
      }),
    ).toBe(true);
    expect(
      activityStateHasPendingOverlayContent({
        kind: "stale",
        observation: { pipeline: getPipelineState({ status: "BUILDING" }), chips: [], atMs: 0 },
        staleMs: 11_000,
      }),
    ).toBe(true);
  });

  /**
   * `resolved` is the case a negative list (`!== "idle" && !== "unavailable"`)
   * would wrongly let through: reachable when a result lands with an
   * undecodable body while the row still reads `toolLifecycleStatus ===
   * "inProgress"`. It must be false here so the caller falls back to the
   * ordinary row instead of an empty card shell.
   */
  it("is false for idle, unavailable, and resolved", () => {
    expect(activityStateHasPendingOverlayContent({ kind: "idle" })).toBe(false);
    expect(activityStateHasPendingOverlayContent({ kind: "unavailable", reason: "ceiling" })).toBe(
      false,
    );
    expect(activityStateHasPendingOverlayContent({ kind: "resolved" })).toBe(false);
    expect(
      activityStateHasPendingOverlayContent({
        kind: "resolved",
        continuation: {
          pipeline: getPipelineState({ status: "BUILDING" }),
          chips: [],
          atMs: 0,
        },
      }),
    ).toBe(false);
  });
});
