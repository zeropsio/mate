import { EnvironmentId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { MateUpdateState } from "../../zerops/useZeropsMateUpdate";

const environmentState = vi.hoisted(() => ({
  environment: undefined as
    | undefined
    | {
        readonly serverVersion: string;
        readonly capabilities: {
          readonly mateUpdate?: boolean;
          readonly mateUpdateCheck?: boolean;
        };
        readonly update?: {
          readonly installed: string;
          readonly latest: string;
          readonly available: boolean;
          readonly checkedAt: string;
        };
      },
}));
const mateUpdateState = vi.hoisted<{
  state: MateUpdateState;
  checked:
    | { installed: string; latest: string; available: boolean; checkedAt: string }
    | null
    | undefined;
}>(() => ({
  state: { phase: "idle" },
  checked: undefined,
}));

vi.mock("../../state/environments", () => ({
  useEnvironment: () =>
    environmentState.environment === undefined
      ? null
      : { serverConfig: { environment: environmentState.environment } },
}));

vi.mock("../../zerops/useZeropsMateUpdate", () => ({
  useZeropsMateUpdate: () => ({
    state: mateUpdateState.state,
    request: () => {},
    confirm: () => {},
    cancel: () => {},
    checked: mateUpdateState.checked,
    check: () => {},
  }),
}));

import { ZeropsMateUpdateControl } from "./ZeropsMateUpdateControl";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

function render() {
  return renderToStaticMarkup(
    <ZeropsMateUpdateControl environmentId={ENVIRONMENT_ID}>
      {({ line, menuActions }) => (
        <>
          {line}
          {menuActions.map((action) => (
            <span key={action.id} data-zerops-surface={`mate-update-menu-action-${action.id}`}>
              {action.label}
            </span>
          ))}
        </>
      )}
    </ZeropsMateUpdateControl>,
  );
}

describe("ZeropsMateUpdateControl — the verb's presence rules (spec-mate.md §2.9, MU-2)", () => {
  beforeEach(() => {
    mateUpdateState.state = { phase: "idle" };
    mateUpdateState.checked = undefined;
  });

  it("renders nothing before the environment's descriptor has been read", () => {
    environmentState.environment = undefined;
    expect(render()).toBe("");
  });

  it("shows the installed version alone, no verb, no menu, without mateUpdate capability", () => {
    environmentState.environment = {
      serverVersion: "0.8.0",
      capabilities: {},
      update: { installed: "0.8.0", latest: "0.8.1", available: true, checkedAt: "now" },
    };
    const html = render();
    expect(html).toContain("Server 0.8.0");
    expect(html).not.toContain(">Update<");
    expect(html).not.toContain("Check for updates");
  });

  it("shows the line with no verb, but still offers Check for updates, when nothing is available", () => {
    environmentState.environment = {
      serverVersion: "0.8.1",
      capabilities: { mateUpdate: true, mateUpdateCheck: true },
      update: { installed: "0.8.1", latest: "0.8.1", available: false, checkedAt: "now" },
    };
    const html = render();
    expect(html).toContain("Server 0.8.1");
    expect(html).not.toContain(">Update<");
    expect(html).toContain("Check for updates");
  });

  it("offers Update but never Check for updates on a server without the check capability", () => {
    environmentState.environment = {
      serverVersion: "0.9.0",
      capabilities: { mateUpdate: true },
      update: { installed: "0.9.0", latest: "0.10.0", available: true, checkedAt: "now" },
    };
    mateUpdateState.state = { phase: "idle" };
    const html = render();
    expect(html).toContain(">Update<");
    expect(html).not.toContain("Check for updates");
  });

  it("offers Update only when capable and an update is available", () => {
    environmentState.environment = {
      serverVersion: "0.8.0",
      capabilities: { mateUpdate: true, mateUpdateCheck: true },
      update: { installed: "0.8.0", latest: "0.8.1", available: true, checkedAt: "now" },
    };
    mateUpdateState.state = { phase: "idle" };
    const html = render();
    expect(html).toContain("Server 0.8.0");
    expect(html).toContain('data-zerops-surface="mate-update-role"');
    expect(html).toContain(">Update<");
    expect(html).toContain('data-zerops-surface="mate-update-menu-action-update"');
    expect(html).toContain("Update to 0.8.1");
    expect(html).toContain('data-zerops-surface="mate-update-menu-action-check-for-updates"');
    expect(html).toContain("Check for updates");
  });

  it("in confirm, offers Update and Keep running with the running-threads warning", () => {
    environmentState.environment = {
      serverVersion: "0.8.0",
      capabilities: { mateUpdate: true, mateUpdateCheck: true },
      update: { installed: "0.8.0", latest: "0.8.1", available: true, checkedAt: "now" },
    };
    mateUpdateState.state = { phase: "confirm" };
    const html = render();
    expect(html).toContain("Running threads stop. Update now?");
    expect(html).toContain(">Update<");
    expect(html).toContain("Keep running");
    // The menu offers its own request while idle only; a confirm already
    // under way on the line is not also offered as a fresh menu click.
    expect(html).not.toContain('data-zerops-surface="mate-update-menu-action-update"');
    // Check for updates stays offered regardless of the update flow's phase.
    expect(html).toContain('data-zerops-surface="mate-update-menu-action-check-for-updates"');
  });

  it("shows the failure message inline, never a toast surface", () => {
    environmentState.environment = {
      serverVersion: "0.8.0",
      capabilities: { mateUpdate: true, mateUpdateCheck: true },
      update: { installed: "0.8.0", latest: "0.8.1", available: true, checkedAt: "now" },
    };
    mateUpdateState.state = { phase: "failed", message: "zcp mate update exited 1" };
    const html = render();
    expect(html).toContain('data-zerops-surface="mate-update-error"');
    expect(html).toContain("zcp mate update exited 1");
  });

  it("shows 'Checking…', disabled, while a check is running", () => {
    environmentState.environment = {
      serverVersion: "0.8.1",
      capabilities: { mateUpdate: true, mateUpdateCheck: true },
      update: { installed: "0.8.1", latest: "0.8.1", available: false, checkedAt: "now" },
    };
    mateUpdateState.state = { phase: "checking" };
    const html = render();
    expect(html).toContain("Checking…");
    expect(html).not.toContain("Check for updates");
  });

  it("an available checked result overrides the descriptor's own update field (MU-1)", () => {
    environmentState.environment = {
      serverVersion: "0.8.1",
      capabilities: { mateUpdate: true, mateUpdateCheck: true },
      update: { installed: "0.8.1", latest: "0.8.1", available: false, checkedAt: "now" },
    };
    mateUpdateState.checked = {
      installed: "0.8.1",
      latest: "0.8.2",
      available: true,
      checkedAt: "later",
    };
    const html = render();
    expect(html).toContain(">Update<");
    expect(html).toContain("Update to 0.8.2");
  });
});
