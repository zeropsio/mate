import { EnvironmentId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { MateUpdateState } from "../../zerops/mateUpdate";
import type { ZeropsMateUpdateView } from "./ZeropsMateUpdateControl";

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

const verbs = vi.hoisted(() => ({
  update: vi.fn(),
  check: vi.fn(),
  /** The app's confirm dialog; the person's answer. */
  confirm: vi.fn(),
}));

vi.mock("../../zerops/useZeropsMateUpdate", () => ({
  useZeropsMateUpdate: () => ({
    state: mateUpdateState.state,
    update: verbs.update,
    checked: mateUpdateState.checked,
    check: verbs.check,
  }),
}));

vi.mock("../../confirmDialog", () => ({
  requestConfirmDialog: verbs.confirm,
}));

import { ZeropsMateUpdateControl } from "./ZeropsMateUpdateControl";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

/** What the control hands its surface, with the verbs callable. */
function view(): ZeropsMateUpdateView {
  let seen: ZeropsMateUpdateView | undefined;
  renderToStaticMarkup(
    <ZeropsMateUpdateControl environmentId={ENVIRONMENT_ID} mateName="Nova">
      {(given) => {
        seen = given;
        return null;
      }}
    </ZeropsMateUpdateControl>,
  );
  if (seen === undefined) throw new Error("the control rendered nothing");
  return seen;
}

function menuAction(id: string) {
  const action = view().menuActions.find((entry) => entry.id === id);
  if (action === undefined) throw new Error(`no ${id} in the menu`);
  return action;
}

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
    verbs.update.mockReset();
    verbs.check.mockReset();
    verbs.confirm.mockReset();
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

  // The bug this replaces: *Update to x.y.z* in a Mate's menu armed a
  // question drawn only on the update line, and the menus draw no line — the
  // click did nothing anyone could see (the owner, 2026-09-26).
  it.each([
    { answer: true, updates: ["0.8.1"] },
    { answer: false, updates: [] },
  ])(
    "Update to x.y.z asks in the app's dialog, by name, and updates only on yes ($answer)",
    async ({ answer, updates }) => {
      environmentState.environment = {
        serverVersion: "0.8.0",
        capabilities: { mateUpdate: true, mateUpdateCheck: true },
        update: { installed: "0.8.0", latest: "0.8.1", available: true, checkedAt: "now" },
      };
      verbs.confirm.mockResolvedValue(answer);
      menuAction("update").onSelect();
      await vi.waitFor(() => expect(verbs.confirm).toHaveBeenCalledTimes(1));
      expect(verbs.confirm.mock.calls[0]?.[0]).toMatch(/^Update Nova to 0\.8\.1\?\n/);
      await Promise.resolve();
      expect(verbs.update.mock.calls.map(([to]) => to)).toEqual(updates);
    },
  );

  it.each([
    {
      answer: { installed: "0.8.0", latest: "0.8.2", available: true, checkedAt: "later" },
      asks: 1,
    },
    {
      answer: { installed: "0.8.2", latest: "0.8.2", available: false, checkedAt: "later" },
      asks: 0,
    },
    { answer: undefined, asks: 0 },
  ])(
    "Check for updates asks to update when it finds a newer version ($asks)",
    async ({ answer, asks }) => {
      environmentState.environment = {
        serverVersion: "0.8.0",
        capabilities: { mateUpdate: true, mateUpdateCheck: true },
        update: { installed: "0.8.0", latest: "0.8.0", available: false, checkedAt: "now" },
      };
      verbs.check.mockResolvedValue(answer);
      verbs.confirm.mockResolvedValue(true);
      menuAction("check-for-updates").onSelect();
      await vi.waitFor(() => expect(verbs.check).toHaveBeenCalledTimes(1));
      await Promise.resolve();
      await Promise.resolve();
      expect(verbs.confirm).toHaveBeenCalledTimes(asks);
      if (asks > 0) expect(verbs.confirm.mock.calls[0]?.[0]).toMatch(/^Update Nova to 0\.8\.2\?/);
    },
  );

  it.each([
    { state: { phase: "checking" } as const, words: "Checking for updates…" },
    { state: { phase: "updating", to: "0.8.1" } as const, words: "Updating to 0.8.1…" },
    { state: { phase: "updated", to: "0.8.1" } as const, words: "Updated to 0.8.1" },
    { state: { phase: "already-current" } as const, words: "Up to date" },
  ])("says $words where the verb stands, and offers no second update", ({ state, words }) => {
    environmentState.environment = {
      serverVersion: "0.8.0",
      capabilities: { mateUpdate: true, mateUpdateCheck: true },
      update: { installed: "0.8.0", latest: "0.8.1", available: true, checkedAt: "now" },
    };
    mateUpdateState.state = state;
    const html = render();
    expect(html).toContain(words);
    expect(html).not.toContain(">Update<");
    if (state.phase === "checking" || state.phase === "updating") {
      expect(html).not.toContain('data-zerops-surface="mate-update-menu-action-update"');
    }
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
