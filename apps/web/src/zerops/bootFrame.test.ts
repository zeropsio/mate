import { ZEROPS_SESSION_STORAGE_KEY } from "@t3tools/client-runtime/zerops";
import { describe, expect, it } from "vite-plus/test";

import indexHtml from "../../index.html?raw";
import {
  resolveInitialThreadSidebarWidth,
  THREAD_SIDEBAR_WIDTH_STORAGE_KEY,
} from "../components/threadSidebarWidth";
import {
  BOOT_FRAME_STORAGE_KEY,
  bootFrameMemory,
  bootFrameMode,
  bootFrameSync,
  livePalette,
} from "./bootFrame.logic";

const frameScript = (() => {
  const scripts = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  const script = scripts.find((body) => body?.includes(BOOT_FRAME_STORAGE_KEY));
  if (script === undefined) throw new Error("index.html has no boot-frame script");
  return script;
})();

/** Runs index.html's frame script against a stored state, as the browser does before first paint. */
function bootFrameOf(input: {
  readonly storage: Record<string, string>;
  readonly pathname: string;
  readonly innerWidth: number;
  readonly storageThrows?: boolean;
  readonly desktop?: boolean;
}): { readonly mode: string | undefined; readonly menuWidth: string | undefined } {
  const variables: Record<string, string> = {};
  const documentElement = {
    dataset: {} as Record<string, string | undefined>,
    style: { setProperty: (name: string, value: string) => void (variables[name] = value) },
  };
  const fakeWindow = {
    ...(input.desktop === true ? { desktopBridge: {} } : {}),
    innerWidth: input.innerWidth,
    location: { pathname: input.pathname },
    localStorage: {
      getItem: (key: string) => {
        if (input.storageThrows) throw new Error("storage blocked");
        return input.storage[key] ?? null;
      },
    },
  };
  new Function("window", "document", frameScript)(fakeWindow, { documentElement });
  return { mode: documentElement.dataset.bootFrame, menuWidth: variables["--boot-menu-width"] };
}

const SESSION = "a-stored-session";

describe("the boot frame", () => {
  const cases = [
    {
      name: "a browser signed in last time",
      remembered: "app",
      session: SESSION,
      pathname: "/zerops",
      mode: "app",
    },
    {
      name: "a conversation reloaded, signed in",
      remembered: "app",
      session: SESSION,
      pathname: "/env-1/thread-1",
      mode: "app",
    },
    {
      name: "a memory left over with no session",
      remembered: "app",
      session: null,
      pathname: "/zerops",
      mode: "mark",
    },
    {
      name: "a browser never signed in",
      remembered: null,
      session: null,
      pathname: "/zerops",
      mode: "mark",
    },
    { name: "an unknown memory", remembered: "yes", session: SESSION, pathname: "/", mode: "mark" },
    {
      name: "the way back from the Zerops sign-in",
      remembered: null,
      session: null,
      pathname: "/zerops/authorized",
      mode: "app",
    },
    {
      name: "the way back under a base path",
      remembered: null,
      session: null,
      pathname: "/mate/zerops/authorized/",
      mode: "app",
    },
  ] as const;

  it.each(cases)("paints $mode for $name, in index.html as in the app", (row) => {
    expect(
      bootFrameMode({
        remembered: row.remembered,
        session: row.session,
        pathname: row.pathname,
        desktop: false,
      }),
    ).toBe(row.mode);
    const storage: Record<string, string> = {};
    if (row.remembered !== null) storage[BOOT_FRAME_STORAGE_KEY] = row.remembered;
    if (row.session !== null) storage[ZEROPS_SESSION_STORAGE_KEY] = row.session;
    const painted = bootFrameOf({ storage, pathname: row.pathname, innerWidth: 1786 });
    expect(painted.mode ?? "mark").toBe(row.mode);
  });

  // A desktop window's menu stands its mark beside the window's own buttons, in a 52 px bar:
  // the sign-in's centred mark stands until the app draws, never one in the wrong corner.
  it("paints the sign-in's mark in a desktop window, signed in or on its way back", () => {
    for (const pathname of ["/zerops", "/zerops/authorized"]) {
      expect(bootFrameMode({ remembered: "app", session: SESSION, pathname, desktop: true })).toBe(
        "mark",
      );
      const storage = { [BOOT_FRAME_STORAGE_KEY]: "app", [ZEROPS_SESSION_STORAGE_KEY]: SESSION };
      expect(
        bootFrameOf({ storage, pathname, innerWidth: 1786, desktop: true }).mode,
      ).toBeUndefined();
    }
  });

  it.each([
    { stored: null, innerWidth: 1786 },
    { stored: 420, innerWidth: 1786 },
    { stored: 120, innerWidth: 1786 },
    { stored: 900, innerWidth: 1280 },
    { stored: null, innerWidth: 800 },
  ])("draws the menu column $stored px wide at $innerWidth as the menu will", (row) => {
    const storage: Record<string, string> = {
      [BOOT_FRAME_STORAGE_KEY]: "app",
      [ZEROPS_SESSION_STORAGE_KEY]: SESSION,
    };
    if (row.stored !== null) storage[THREAD_SIDEBAR_WIDTH_STORAGE_KEY] = JSON.stringify(row.stored);
    const painted = bootFrameOf({ storage, pathname: "/", innerWidth: row.innerWidth });
    expect(painted.menuWidth).toBe(
      `${resolveInitialThreadSidebarWidth(row.stored, row.innerWidth)}px`,
    );
  });

  it("paints the sign-in's mark when storage is refused, except on the way back", () => {
    expect(
      bootFrameOf({ storage: {}, pathname: "/zerops", innerWidth: 1786, storageThrows: true }).mode,
    ).toBeUndefined();
    expect(
      bootFrameOf({
        storage: {},
        pathname: "/zerops/authorized",
        innerWidth: 1786,
        storageThrows: true,
      }),
    ).toEqual({ mode: "app", menuWidth: "304px" });
  });

  it.each([
    { status: "signed-in", memory: "remember" },
    { status: "signed-out", memory: "forget" },
    { status: "loading", memory: "keep" },
    { status: "unavailable", memory: "keep" },
    { status: "totp-required", memory: "keep" },
  ] as const)("a session $status leaves the next load's frame: $memory", (row) => {
    expect(bootFrameMemory(row.status)).toBe(row.memory);
  });
});

describe("the boot frame later in the session", () => {
  it.each([
    {
      name: "the first load, nothing drawn yet",
      children: 0,
      drawn: false,
      shown: true,
      repaint: false,
    },
    { name: "the app drawn", children: 1, drawn: false, shown: false, repaint: false },
    { name: "a wait after the app drew", children: 0, drawn: true, shown: true, repaint: true },
  ])(
    "$name: shown $shown, repainted from the app $repaint",
    ({ children, drawn, shown, repaint }) => {
      expect(bootFrameSync({ rootChildren: children, drawn })).toEqual({
        shown,
        repaint,
        drawn: drawn || children > 0,
      });
    },
  );

  it("takes the app's colours as they are now, and leaves out what it cannot read", () => {
    const live: Record<string, string> = {
      "--background": " oklch(0.16 0.005 173) ",
      "--foreground": "oklch(0.94 0.006 170)",
      "--sidebar": "",
    };
    expect(livePalette((name) => live[name] ?? "")).toEqual({
      "--boot-background": "oklch(0.16 0.005 173)",
      "--boot-foreground": "oklch(0.94 0.006 170)",
    });
  });
});
