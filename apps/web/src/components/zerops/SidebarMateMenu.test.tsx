import { act, createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { EnvironmentId } from "@t3tools/contracts";

/** The environment record the menu's update entries read, as `useEnvironment` serves it. */
const environmentRecord = vi.hoisted(() => ({
  environment: undefined as
    | undefined
    | {
        readonly serverVersion: string;
        readonly capabilities: { readonly mateUpdate: boolean; readonly mateUpdateCheck: boolean };
        readonly update: {
          readonly installed: string;
          readonly latest: string;
          readonly available: boolean;
          readonly checkedAt: string;
        };
      },
}));
vi.mock("../../state/environments", () => ({
  useEnvironment: () =>
    environmentRecord.environment === undefined
      ? null
      : { serverConfig: { environment: environmentRecord.environment } },
}));
vi.mock("../../zerops/useMateUpdate", () => ({
  useMateUpdate: () => ({
    state: { phase: "idle" },
    checked: undefined,
    update: () => {},
    check: async () => undefined,
  }),
}));

import { Menu } from "../ui/menu";
import { MateMenuItems, MateRenameField, type MateRowActions } from "./SidebarMateMenu";

const ACTIONS: MateRowActions = {
  muted: false,
  toggleMute: () => {},
  toggleUnread: () => {},
  copyLink: () => {},
  rename: { initialValue: "Nova", validate: () => undefined, commit: () => {} },
  changeFace: () => {},
  entries: [
    { id: "restart", label: "Restart", onSelect: () => {} },
    { id: "quick", separator: true },
    { id: "assign", label: "Hand over…", onSelect: () => {} },
    { id: "move", label: "Move to project…", onSelect: () => {} },
  ],
};

const items = (props: Partial<Parameters<typeof MateMenuItems>[0]> = {}) =>
  renderToStaticMarkup(
    <Menu>
      <MateMenuItems
        actions={ACTIONS}
        appUrl="https://app.example"
        onOpenMate={() => {}}
        onRename={() => {}}
        shortcuts
        unread={false}
        {...props}
      />
    </Menu>,
  );
const order = (html: string) =>
  [...html.matchAll(/data-zerops-mate-menu="([^"]+)"/gu)].map((match) => match[1]);

describe("MateMenuItems — a Mate's own menu", () => {
  it("lists the ways in, what this viewer keeps, the shared verbs, then the stop", () => {
    expect(order(items({ actions: { ...ACTIONS, stop: () => {} } }))).toEqual([
      "open",
      "open-app",
      "copy-link",
      "mute",
      "unread",
      "rename",
      "face",
      "restart",
      "assign",
      "move",
      "stop",
    ]);
  });

  it("opens the Mate at its crew right after Open, where its crew is the viewer's to see", () => {
    const crew = { label: "Set up a crew", onSelect: () => {} };
    const html = items({ crew });
    expect(order(html)).toEqual([
      "open",
      "crew",
      "open-app",
      "copy-link",
      "mute",
      "unread",
      "rename",
      "face",
      "restart",
      "assign",
      "move",
    ]);
    expect(html).toContain(">Set up a crew<");
    expect(order(items())).not.toContain("crew");
  });

  it("offers no snooze and no pin, anywhere", () => {
    const html = items({ actions: { ...ACTIONS, stop: () => {} } }).toLowerCase();
    expect(html).not.toContain("snooze");
    expect(html).not.toContain(">pin");
  });

  it.each([
    {
      case: "muted",
      actions: { ...ACTIONS, muted: true },
      unread: false,
      says: "Unmute notifications",
    },
    { case: "ringing", actions: ACTIONS, unread: false, says: "Mute notifications" },
    { case: "unread", actions: ACTIONS, unread: true, says: "Mark as read" },
    { case: "read", actions: ACTIONS, unread: false, says: "Mark as unread" },
  ])("says the opposite of what it is: $case", ({ actions, unread, says }) => {
    expect(items({ actions, unread })).toContain(`>${says}<`);
  });

  it("opens the app as a link where there is one, and says there is none where there is not", () => {
    expect(items()).toMatch(/<a[^>]*href="https:\/\/app\.example"[^>]*target="_blank"/u);
    const none = items({ appUrl: undefined });
    expect(none).not.toContain("<a ");
    expect(none).toMatch(
      /data-disabled=""[^>]*data-zerops-mate-menu="open-app"|data-zerops-mate-menu="open-app"[^>]*data-disabled=""/u,
    );
  });

  it("puts Delete last, in red, a line apart from everything else — the stop included", () => {
    const remove = {
      id: "delete",
      label: "Delete Nova…",
      variant: "destructive" as const,
      onSelect: () => {},
    };
    const html = items({ actions: { ...ACTIONS, entries: [...ACTIONS.entries, remove] } });
    expect(order(html)).toEqual([
      "open",
      "open-app",
      "copy-link",
      "mute",
      "unread",
      "rename",
      "face",
      "restart",
      "assign",
      "move",
      "delete",
    ]);
    expect(html).toMatch(
      /role="separator"[^>]*><\/div><div[^>]*data-variant="destructive"[^>]*data-zerops-mate-menu="delete"|role="separator"[^>]*><\/div><div[^>]*data-zerops-mate-menu="delete"[^>]*data-variant="destructive"/u,
    );
    expect(html).toContain(">Delete Nova…<");
    const working = items({
      actions: { ...ACTIONS, stop: () => {}, entries: [...ACTIONS.entries, remove] },
    });
    expect(order(working).slice(-2)).toEqual(["stop", "delete"]);
    expect(working.match(/role="separator"/gu)).toHaveLength(4);
  });

  it("offers Stop the run only while it works, and Rename only where it may be renamed", () => {
    expect(order(items())).not.toContain("stop");
    expect(order(items({ actions: { ...ACTIONS, rename: undefined } }))).not.toContain("rename");
  });

  it("offers Change face… beside Rename, and only where its face may be changed", () => {
    const html = items();
    expect(html).toContain(">Change face…<");
    expect(order(html).slice(4, 7)).toEqual(["unread", "rename", "face"]);
    expect(order(items({ actions: { ...ACTIONS, changeFace: undefined } }))).not.toContain("face");
  });

  it("shows the keys the list answers beside their items", () => {
    const html = items({ actions: { ...ACTIONS, stop: () => {} } });
    for (const key of ["↵", "E", "X"]) expect(html).toContain(`>${key}</kbd>`);
    // Space presses the row as any button's does: there is no peek to open.
    expect(html).not.toContain(">Space</kbd>");
    expect(items({ shortcuts: false })).not.toContain("<kbd");
  });
});

describe("MateMenuItems — Check for updates, from the Mate itself", () => {
  afterEach(() => {
    environmentRecord.environment = undefined;
  });
  const connected = { ...ACTIONS, environmentId: EnvironmentId.make("environment-1") };
  const record = (available: boolean) => ({
    serverVersion: "0.15.30",
    capabilities: { mateUpdate: true, mateUpdateCheck: true },
    update: {
      installed: "0.15.30",
      latest: available ? "0.15.31" : "0.15.30",
      available,
      checkedAt: "2026-10-10T11:24:00Z",
    },
  });

  it("offers Check for updates beside the Mate's other verbs, and Update to the version its server found", () => {
    environmentRecord.environment = record(true);
    const html = items({ actions: connected });
    expect(order(html)).toEqual([
      "open",
      "open-app",
      "copy-link",
      "mute",
      "unread",
      "rename",
      "face",
      "restart",
      "assign",
      "move",
      "check-for-updates",
      "update",
    ]);
    expect(html).toContain(">Check for updates<");
    expect(html).toContain(">Update to 0.15.31<");
  });

  it("offers only the check while its server knows no newer release", () => {
    environmentRecord.environment = record(false);
    const offered = order(items({ actions: connected }));
    expect(offered).toContain("check-for-updates");
    expect(offered).not.toContain("update");
  });

  it("offers no update entries for a Mate this page holds no environment record of", () => {
    expect(order(items({ actions: connected }))).not.toContain("check-for-updates");
    environmentRecord.environment = record(true);
    expect(order(items())).not.toContain("check-for-updates");
  });
});

describe("MateRenameField — the name, edited where it stands", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const mountField = (validate: (value: string) => string | undefined) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const commit = vi.fn();
    const onDone = vi.fn();
    let renderer: ReturnType<typeof create> | undefined;
    act(() => {
      renderer = create(
        h(MateRenameField, { rename: { initialValue: "Nova", validate, commit }, onDone }),
        { createNodeMock: () => ({ focus: () => {}, select: () => {} }) },
      );
    });
    const input = () => renderer!.root.findByType("input");
    const type = (value: string) => {
      act(() => {
        input().props.onChange({ currentTarget: { value } });
      });
    };
    const key = (name: string) => {
      act(() => {
        input().props.onKeyDown({ key: name, preventDefault: () => {}, stopPropagation: () => {} });
      });
    };
    return { commit, onDone, type, key, input, renderer: () => renderer! };
  };

  it("writes the new name on Enter and hands the row back", () => {
    const field = mountField(() => undefined);
    field.type("Vega");
    field.key("Enter");
    expect(field.commit).toHaveBeenCalledWith("Vega");
    expect(field.onDone).toHaveBeenCalledTimes(1);
  });

  it("leaves the name as it was on Escape", () => {
    const field = mountField(() => undefined);
    field.type("Vega");
    field.key("Escape");
    expect(field.commit).not.toHaveBeenCalled();
    expect(field.onDone).toHaveBeenCalledTimes(1);
  });

  it("keeps the field open with the reason under it when the name will not do", () => {
    const field = mountField((value) =>
      value === "Kai" ? "Another Mate is called Kai." : undefined,
    );
    field.type("Kai");
    field.key("Enter");
    expect(field.commit).not.toHaveBeenCalled();
    expect(field.onDone).not.toHaveBeenCalled();
    const alert = field.renderer().root.find((node) => node.props.role === "alert");
    expect(alert.children.join("")).toBe("Another Mate is called Kai.");
  });

  it("writes nothing when the name did not change", () => {
    const field = mountField(() => undefined);
    field.key("Enter");
    expect(field.commit).not.toHaveBeenCalled();
    expect(field.onDone).toHaveBeenCalledTimes(1);
  });
});
