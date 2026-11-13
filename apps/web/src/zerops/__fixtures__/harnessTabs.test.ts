import { ZeropsUserId } from "@t3tools/contracts";
import { ZEROPS_SESSION_STORAGE_KEY, type ZeropsUser } from "@t3tools/client-runtime/zerops";
import { makeAccountHarness } from "@t3tools/client-runtime/zerops/testing";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mountTab, preloadTabs, settle, unmountTabs } from "./harnessTabs";

const person: ZeropsUser = {
  id: ZeropsUserId.make("user-1"),
  email: "person@example.test",
  clientUserList: [{ id: "cu-1", clientId: "org-1", roleCode: "OWNER" }],
};

/** A page that reloads itself when another tab writes the session. */
async function reloadingOnStorage() {
  const { createElement, useEffect } = await import("react");
  function ReloadOnStorage() {
    useEffect(() => {
      const reload = (event: StorageEvent) => {
        if (event.key === ZEROPS_SESSION_STORAGE_KEY) window.location.reload();
      };
      window.addEventListener("storage", reload);
      return () => window.removeEventListener("storage", reload);
    }, []);
    return null;
  }
  return createElement(ReloadOnStorage);
}

async function twoSignedInTabs() {
  const harness = makeAccountHarness({
    people: [{ user: person, password: "secret" }],
    signedIn: "user-1",
  });
  const a = await mountTab(harness, harness.browser.openTab(), { path: "/zerops/a" });
  const b = await mountTab(harness, harness.browser.openTab(), {
    path: "/zerops/b",
    page: reloadingOnStorage,
  });
  return { a, b };
}

afterEach(async () => {
  await unmountTabs();
  vi.unstubAllGlobals();
});

describe("harness tabs", () => {
  it("leaves the globals on the tab whose code ran after the other tab hears its write", async () => {
    const { a, b } = await twoSignedInTabs();

    await a.run(() => a.session().signOut());
    await settle();

    expect(b.tab.reloads).toBe(1);
    expect(globalThis.window.location).toBe(a.location());
  });
});

// Under load a test timed out while its tab still opened — the page's module graph took longer
// than the test's 15 s — and its tab went on opening into the tests after it: the globals moved to
// its window, and every test after it in the file read an empty page.
describe("a tab whose test ended while it opened", () => {
  it("never opens into the next test", async () => {
    const harness = makeAccountHarness({ people: [{ user: person, password: "secret" }] });
    let release = () => {};
    let entered = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const opening = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const late = mountTab(harness, harness.browser.openTab(), {
      path: "/zerops/late",
      page: async () => {
        entered();
        await gate;
        return null;
      },
    }).catch((cause: unknown) => cause);
    await opening;
    await unmountTabs();
    const next = await mountTab(harness, harness.browser.openTab(), { path: "/zerops/next" });

    release();
    expect(await late).toBeInstanceOf(Error);
    expect(globalThis.window.location).toBe(next.location());
  });
});

// The first tab of a file paid for its modules' first load inside its test: 10 s and more of the
// test's 15 s under load (8 workers beside client-runtime's, measured 2026-10-03).
describe("a file's slow first load of its tabs' modules", () => {
  let loads = 0;
  let loaded = false;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  /** A cold module graph can remain pending until after the file's setup starts. */
  const load = async () => {
    loads += 1;
    if (loads === 1) {
      await held;
      loaded = true;
    }
    return "a page";
  };
  preloadTabs(
    load,
    () =>
      new Promise<void>((resolve) => {
        setImmediate(() => {
          release();
          resolve();
        });
      }),
  );

  it("is the file's setup, never its first test's time", { timeout: 1_000 }, async () => {
    expect(loaded).toBe(true);
    const harness = makeAccountHarness({ people: [{ user: person, password: "secret" }] });
    const tab = await mountTab(harness, harness.browser.openTab(), { page: load });

    expect(tab.text()).toContain("a page");
  });
});
