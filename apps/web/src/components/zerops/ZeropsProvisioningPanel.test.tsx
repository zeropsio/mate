import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  PROVISIONING_CAPS,
  advanceProvisioning,
  startProvisioning,
  type ProvisioningState,
} from "@t3tools/client-runtime/zerops/provisioning";

import { ZeropsProvisioningPanel, zeropsGuiProjectUrl } from "./ZeropsProvisioningPanel";

const noop = () => undefined;

type ActionProps = {
  readonly "aria-busy"?: boolean;
  readonly children?: ReactNode;
  readonly disabled?: boolean;
  readonly label?: string;
  readonly onClick?: () => void;
};

function findAction(node: ReactNode, label: string): ReactElement<ActionProps> {
  if (isValidElement<ActionProps>(node)) {
    if (node.props.label === label && node.props.onClick !== undefined) return node;
    for (const child of Children.toArray(node.props.children)) {
      try {
        return findAction(child, label);
      } catch {
        // Keep searching sibling nodes.
      }
    }
  }
  throw new Error(`Action not found: ${label}`);
}

const PROJECT = {
  id: "project-1",
  name: "p",
  status: "ACTIVE",
  publicZone: "abc.prg1-zerops.zone",
  zeropsSubdomainHost: "24cb",
};

const CONTAINER = {
  id: "service-1",
  name: "zcp",
  status: "ACTIVE",
  subdomainAccess: true,
  ports: [{ port: 8080 }],
  serviceStackTypeInfo: { serviceStackTypeVersionName: "zcp@1" },
};

function render(state: ProvisioningState, error: string | null = null): string {
  return renderToStaticMarkup(
    <ZeropsProvisioningPanel
      state={state}
      busy={false}
      error={error}
      onRetry={noop}
      onEnable={noop}
    />,
  );
}

const awaitingContainer = advanceProvisioning(
  startProvisioning({ zcpClaimed: true, nowMs: 0 }),
  { kind: "projects", projects: [PROJECT] },
  0,
);
const awaitingHealth = advanceProvisioning(
  awaitingContainer,
  { kind: "services", project: PROJECT, services: [CONTAINER] },
  1000,
);

describe("ZeropsProvisioningPanel", () => {
  it("explains waiting, failure and retry states with an explicit next action", () => {
    const waitingMarkup = render(awaitingContainer);
    const failureMarkup = render(awaitingHealth, "Network error contacting Zerops.");
    const timedOut = advanceProvisioning(
      awaitingContainer,
      { kind: "tick" },
      PROVISIONING_CAPS["awaiting-container"] + 1,
    );
    const timedOutMarkup = render(timedOut);

    expect(waitingMarkup).toContain('data-zerops-provisioning-phase="awaiting-container"');
    expect(waitingMarkup).toContain('data-zerops-primitive="flat-card"');
    expect(waitingMarkup).toContain('data-zerops-primitive="status-dot"');
    expect(waitingMarkup).toContain("Preparing your project");
    expect(failureMarkup).toContain('role="alert"');
    expect(failureMarkup).toContain("Try again");
    expect(timedOutMarkup).toContain("Keep waiting");
    expect(timedOutMarkup).toContain("Check it in the Zerops GUI");
  });

  it("invokes Retry exactly once after user action and keeps it disabled while busy", () => {
    const timedOut = advanceProvisioning(
      awaitingContainer,
      { kind: "tick" },
      PROVISIONING_CAPS["awaiting-container"] + 1,
    );
    const onRetry = vi.fn();
    const panel = ZeropsProvisioningPanel({
      state: timedOut,
      busy: false,
      error: null,
      onRetry,
      onEnable: noop,
    });

    findAction(panel, "Keep waiting").props.onClick?.();

    expect(onRetry).toHaveBeenCalledTimes(1);
    const busyPanel = ZeropsProvisioningPanel({
      state: timedOut,
      busy: true,
      error: null,
      onRetry,
      onEnable: noop,
    });
    expect(findAction(busyPanel, "Keep waiting").props.disabled).toBe(true);
    expect(busyPanel.props["aria-busy"]).toBe(true);
  });

  it("names what every wait is waiting for, and its cap", () => {
    expect(render(startProvisioning({ zcpClaimed: true, nowMs: 0 }))).toContain(
      "Waiting for your project to appear",
    );
    expect(render(startProvisioning({ zcpClaimed: true, nowMs: 0 }))).toContain("up to 60s");

    expect(render(awaitingContainer)).toContain("Waiting for the Zerops Code container to start");
    expect(render(awaitingContainer)).toContain("up to 5 min");

    expect(render(awaitingHealth)).toContain("Waiting for Zerops Code to answer");
    expect(render(awaitingHealth)).toContain("up to 30s");
  });

  it("offers the restart when the container predates Zerops Code, and says what it costs", () => {
    const needsEnable = advanceProvisioning(
      awaitingHealth,
      { kind: "health", health: "predates-z3" },
      2000,
    );

    const markup = render(needsEnable);
    expect(markup).toContain("Enable Zerops Code");
    // A restart is safe; saying so is what makes the button clickable.
    expect(markup).toMatch(/untouched/i);
  });

  it("turns a cap that ran out into two ways forward, never a failure", () => {
    const expired = advanceProvisioning(
      awaitingContainer,
      { kind: "tick" },
      PROVISIONING_CAPS["awaiting-container"] + 1,
    );

    const markup = render(expired);
    expect(markup).toContain("Keep waiting");
    expect(markup).toContain(zeropsGuiProjectUrl("project-1"));
    expect(markup).not.toMatch(/failed|error/i);
  });

  it("links to the project the wait is about", () => {
    expect(zeropsGuiProjectUrl("abc123")).toBe("https://app.zerops.io/project/abc123");
    expect(zeropsGuiProjectUrl(null)).toBe("https://app.zerops.io");
  });

  it("shows a read failure without abandoning the wait", () => {
    const markup = render(awaitingHealth, "Network error contacting Zerops.");

    expect(markup).toContain("Network error contacting Zerops.");
    expect(markup).toContain("Waiting for Zerops Code to answer");
  });

  it("offers the restart when the health wait runs out on a known container", () => {
    // A container that never answers is either from before Zerops Code or
    // away; both are addressed by the same restart, and the alternative is a
    // panel that can only ever say "keep waiting".
    const expired = advanceProvisioning(
      awaitingHealth,
      { kind: "tick" },
      1000 + PROVISIONING_CAPS["awaiting-health"] + 1,
    );

    const markup = render(expired);
    expect(expired.phase).toBe("timed-out");
    expect(markup).toContain("Keep waiting");
    expect(markup).toContain("Enable Zerops Code");
  });

  it("does not offer a restart when it is the project that is late", () => {
    const expired = advanceProvisioning(
      awaitingContainer,
      { kind: "tick" },
      PROVISIONING_CAPS["awaiting-container"] + 1,
    );

    expect(render(expired)).not.toContain("Enable Zerops Code");
  });

  it("stops offering Enable once a restart already tried it and the container still predates Zerops Code", () => {
    const needsEnable = advanceProvisioning(
      awaitingHealth,
      { kind: "health", health: "predates-z3" },
      2000,
    );
    const enabled = advanceProvisioning(needsEnable, { kind: "enable" }, 3000);
    const stillOld = advanceProvisioning(enabled, { kind: "health", health: "predates-z3" }, 4000);

    const markup = render(stillOld);
    expect(stillOld.phase).toBe("not-yet-available");
    // The button is gone and so is the old advice to go set a flag by hand:
    // enabling now writes it, so the only thing left to name is the release.
    expect(markup).not.toContain(">Enable Zerops Code<");
    expect(markup).toContain("this container");
    expect(markup).toContain("zcp release does not carry Zerops Code");
    expect(markup).not.toContain("ZCP_Z3_ENABLED");
    expect(markup).not.toMatch(/failed|error/i);
  });

  it("prefers the same copy when the post-enable health wait times out instead", () => {
    const needsEnable = advanceProvisioning(
      awaitingHealth,
      { kind: "health", health: "predates-z3" },
      2000,
    );
    const enabled = advanceProvisioning(needsEnable, { kind: "enable" }, 3000);
    const expired = advanceProvisioning(
      enabled,
      { kind: "tick" },
      3000 + PROVISIONING_CAPS["awaiting-health"] + 1,
    );

    const markup = render(expired);
    expect(expired.phase).toBe("timed-out");
    expect(markup).not.toContain(">Enable Zerops Code<");
    expect(markup).toContain("this container");
    expect(markup).toContain("zcp release does not carry Zerops Code");
    expect(markup).not.toContain("ZCP_Z3_ENABLED");
  });
});
