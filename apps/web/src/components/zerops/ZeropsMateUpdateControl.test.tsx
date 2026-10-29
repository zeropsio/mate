import {
  makeAccountStore,
  makeMateUpdates,
  mateUpdate,
  readsOfState,
} from "@t3tools/client-runtime/data";
import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
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
          readonly zcp?: { installed: string; latest: string; behind: boolean };
          readonly restart?: { needed: boolean; why?: string };
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

vi.mock("../../zerops/useMateUpdate", () => ({
  useMateUpdate: () => ({
    state: mateUpdateState.state,
    update: verbs.update,
    checked: mateUpdateState.checked,
    check: verbs.check,
  }),
}));

/** Whether the viewer may update the Mate: its owner, or an admin of its project. */
const viewer = vi.hoisted(() => ({ mayUpdate: true }));

vi.mock("../../zerops/useMateReadOnly", () => ({
  useMayUpdateMate: () => viewer.mayUpdate,
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
    viewer.mayUpdate = true;
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

  it.each([
    { who: "its owner or an admin of its project", mayUpdate: true, offered: true },
    { who: "a colleague reading along", mayUpdate: false, offered: false },
  ])(
    "a Mate's update is offered to its owner or an admin of its project: $who",
    ({ mayUpdate, offered }) => {
      environmentState.environment = {
        serverVersion: "0.8.0",
        capabilities: { mateUpdate: true, mateUpdateCheck: true },
        update: { installed: "0.8.0", latest: "0.8.1", available: true, checkedAt: "now" },
      };
      viewer.mayUpdate = mayUpdate;
      const html = render();
      expect(html).toContain("Server 0.8.0");
      expect(html.includes("Update to 0.8.1")).toBe(offered);
      expect(html.includes("Check for updates")).toBe(offered);
    },
  );

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
      verbs.check.mockResolvedValue({
        installed: "0.8.0",
        latest: "0.8.1",
        available: true,
        checkedAt: "later",
      });
      verbs.confirm.mockResolvedValue(answer);
      menuAction("update").onSelect();
      await vi.waitFor(() => expect(verbs.confirm).toHaveBeenCalledTimes(1));
      expect(verbs.confirm.mock.calls[0]?.[0]).toMatch(/^Update Nova to 0\.8\.1\?\n/);
      await Promise.resolve();
      expect(verbs.update.mock.calls.map(([to]) => to)).toEqual(updates);
    },
  );

  // The run 2 follow-up: Wren's dialog asked "Update Wren to 0.15.145?" and installed 0.15.146 —
  // the version the last hourly check knew, while the update installs the newest one there is.
  it("Update asks about the version a check finds now, never the one the last check knew", async () => {
    environmentState.environment = {
      serverVersion: "0.8.0",
      capabilities: { mateUpdate: true, mateUpdateCheck: true },
      update: { installed: "0.8.0", latest: "0.8.1", available: true, checkedAt: "an hour ago" },
    };
    verbs.check.mockResolvedValue({
      installed: "0.8.0",
      latest: "0.8.2",
      available: true,
      checkedAt: "now",
    });
    verbs.confirm.mockResolvedValue(true);
    menuAction("update").onSelect();
    await vi.waitFor(() => expect(verbs.confirm).toHaveBeenCalledTimes(1));
    expect(verbs.confirm.mock.calls[0]?.[0]).toMatch(/^Update Nova to 0\.8\.2\?\n/);
    await Promise.resolve();
    expect(verbs.update.mock.calls.map(([to]) => to)).toEqual(["0.8.2"]);
  });

  it.each([
    { case: "a server that cannot check", check: false, found: undefined },
    { case: "a check that could not answer", check: true, found: undefined },
  ])(
    "where the version is not known ($case), Update asks about the newest version",
    async ({ check, found }) => {
      environmentState.environment = {
        serverVersion: "0.8.0",
        capabilities: { mateUpdate: true, mateUpdateCheck: check },
        update: { installed: "0.8.0", latest: "0.8.1", available: true, checkedAt: "an hour ago" },
      };
      verbs.check.mockResolvedValue(found);
      verbs.confirm.mockResolvedValue(true);
      menuAction("update").onSelect();
      await vi.waitFor(() => expect(verbs.confirm).toHaveBeenCalledTimes(1));
      expect(verbs.confirm.mock.calls[0]?.[0]).toMatch(/^Update Nova to the newest version\?\n/);
    },
  );

  it("a Mate only a restart gets current offers the same Update, saying zcp's why, and restarts once asked", async () => {
    const needsRestart = {
      installed: "0.8.0",
      latest: "0.8.0",
      available: false,
      checkedAt: "now",
      zcp: { installed: "9.225.0", latest: "9.226.0", behind: true },
      restart: { needed: true, why: "zcp 9.226.0 is out; only a restart installs it" },
    };
    environmentState.environment = {
      serverVersion: "0.8.0",
      capabilities: { mateUpdate: true, mateUpdateCheck: true },
      update: needsRestart,
    };
    const html = render();
    expect(html).toContain("Zerops Control Plane 9.226.0 available");
    expect(html).toContain('aria-label="Update: zcp 9.226.0 is out; only a restart installs it"');
    expect(menuAction("update").label).toBe("Update");
    verbs.check.mockResolvedValue(needsRestart);
    verbs.confirm.mockResolvedValue(true);
    menuAction("update").onSelect();
    await vi.waitFor(() => expect(verbs.update).toHaveBeenCalledTimes(1));
    expect(verbs.confirm.mock.calls[0]?.[0]).toMatch(
      /^Update Nova to Zerops Control Plane 9\.226\.0\?\n/,
    );
    expect(verbs.update).toHaveBeenCalledWith("Zerops Control Plane 9.226.0", { zcp: "9.226.0" });
  });

  // The owner's open Mate read "zcp 9.226.0 available" beside "Up to date" and no Update: the
  // account's projection called a line with no newer mate current.
  it("a Mate only a restart gets current keeps its Update through the account's own reading", async () => {
    const needsRestart = {
      installed: "0.8.0",
      latest: "0.8.0",
      available: false,
      checkedAt: "now",
      automatic: {
        protocol: 1 as const,
        rollbackCompatible: true,
        phase: "idle" as const,
        runningVersion: "0.8.0",
      },
      zcp: { installed: "9.225.0", latest: "9.226.0", behind: true },
      restart: { needed: true, why: "zcp 9.226.0 is out" },
    };
    const store = makeAccountStore(AtomRegistry.make());
    const host = makeMateUpdates({
      store,
      wire: {
        update: () => Effect.die("not pressed"),
        check: () => Effect.succeed(needsRestart),
      },
      isCurrent: () => true,
      makeId: () => "request-1",
    });
    await host.check(ENVIRONMENT_ID);
    const projected = mateUpdate.derive(readsOfState(store.state()), ENVIRONMENT_ID);
    host.close();
    mateUpdateState.state = projected.state;
    mateUpdateState.checked = projected.checked;
    environmentState.environment = {
      serverVersion: "0.8.0",
      capabilities: { mateUpdate: true, mateUpdateCheck: true },
      update: needsRestart,
    };
    const html = render();
    expect(html).not.toContain("Up to date");
    expect(html).toContain('aria-label="Update: zcp 9.226.0 is out"');
  });

  it("a check that finds nothing newer asks nothing: the Mate is up to date", async () => {
    environmentState.environment = {
      serverVersion: "0.8.0",
      capabilities: { mateUpdate: true, mateUpdateCheck: true },
      update: { installed: "0.8.0", latest: "0.8.1", available: true, checkedAt: "an hour ago" },
    };
    verbs.check.mockResolvedValue({
      installed: "0.8.1",
      latest: "0.8.1",
      available: false,
      checkedAt: "now",
    });
    menuAction("update").onSelect();
    await vi.waitFor(() => expect(verbs.check).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    await Promise.resolve();
    expect(verbs.confirm).not.toHaveBeenCalled();
    expect(verbs.update).not.toHaveBeenCalled();
  });

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
