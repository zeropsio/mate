import { EnvironmentId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { MateUpdateState } from "../../zerops/useZeropsMateUpdate";

const environmentState = vi.hoisted(() => ({
  environment: undefined as
    | undefined
    | {
        readonly serverVersion: string;
        readonly capabilities: { readonly mateUpdate?: boolean };
        readonly update?: {
          readonly installed: string;
          readonly latest: string;
          readonly available: boolean;
          readonly checkedAt: string;
        };
      },
}));
const mateUpdateState = vi.hoisted<{ state: MateUpdateState }>(() => ({
  state: { phase: "idle" },
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
  }),
}));

import { ZeropsMateUpdateControl } from "./ZeropsMateUpdateControl";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

function render() {
  return renderToStaticMarkup(<ZeropsMateUpdateControl environmentId={ENVIRONMENT_ID} />);
}

describe("ZeropsMateUpdateControl — the verb's presence rules (spec-mate.md §2.9, MU-2)", () => {
  it("renders nothing before the environment's descriptor has been read", () => {
    environmentState.environment = undefined;
    expect(render()).toBe("");
  });

  it("shows the installed version alone, no verb, without mateUpdate capability", () => {
    environmentState.environment = {
      serverVersion: "0.8.0",
      capabilities: {},
      update: { installed: "0.8.0", latest: "0.8.1", available: true, checkedAt: "now" },
    };
    const html = render();
    expect(html).toContain("Server 0.8.0");
    expect(html).not.toContain(">Update<");
  });

  it("shows the line with no verb when nothing is available to update", () => {
    environmentState.environment = {
      serverVersion: "0.8.1",
      capabilities: { mateUpdate: true },
      update: { installed: "0.8.1", latest: "0.8.1", available: false, checkedAt: "now" },
    };
    const html = render();
    expect(html).toContain("Server 0.8.1");
    expect(html).not.toContain(">Update<");
  });

  it("offers Update only when capable and an update is available", () => {
    environmentState.environment = {
      serverVersion: "0.8.0",
      capabilities: { mateUpdate: true },
      update: { installed: "0.8.0", latest: "0.8.1", available: true, checkedAt: "now" },
    };
    mateUpdateState.state = { phase: "idle" };
    const html = render();
    expect(html).toContain("Server 0.8.0");
    expect(html).toContain('data-zerops-surface="mate-update-attention"');
    expect(html).toContain(">Update<");
  });

  it("in confirm, offers Update and Keep running with the running-threads warning", () => {
    environmentState.environment = {
      serverVersion: "0.8.0",
      capabilities: { mateUpdate: true },
      update: { installed: "0.8.0", latest: "0.8.1", available: true, checkedAt: "now" },
    };
    mateUpdateState.state = { phase: "confirm" };
    const html = render();
    expect(html).toContain("Running threads stop. Update now?");
    expect(html).toContain(">Update<");
    expect(html).toContain("Keep running");
  });

  it("shows the failure message inline, never a toast surface", () => {
    environmentState.environment = {
      serverVersion: "0.8.0",
      capabilities: { mateUpdate: true },
      update: { installed: "0.8.0", latest: "0.8.1", available: true, checkedAt: "now" },
    };
    mateUpdateState.state = { phase: "failed", message: "zcp mate update exited 1" };
    const html = render();
    expect(html).toContain('data-zerops-surface="mate-update-error"');
    expect(html).toContain("zcp mate update exited 1");
  });
});
