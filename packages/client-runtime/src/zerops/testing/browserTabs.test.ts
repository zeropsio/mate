// @effect-diagnostics globalTimers:off -- cross-tab delivery is a later browser task; these tests wait one.
import { describe, expect, it } from "@effect/vitest";

import {
  ZEROPS_SELECTION_STORAGE_KEY,
  ZEROPS_SESSION_STORAGE_KEY,
  loadZeropsSelection,
  loadZeropsSession,
  saveZeropsSelection,
} from "../session.ts";
import { makeHarnessBrowser, type BrowserSignal, type HarnessTab } from "./browserTabs.ts";

/** Storage events and channel messages arrive as a later task, never inside the write. */
const delivered = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function received(tab: HarnessTab): BrowserSignal[] {
  const signals: BrowserSignal[] = [];
  tab.signals.subscribe((signal) => signals.push(signal));
  return signals;
}

describe("harness browser", () => {
  it("fires a storage event in the other tab only, with the old and new value", async () => {
    const browser = makeHarnessBrowser();
    const a = browser.openTab();
    const b = browser.openTab();
    const inA = received(a);
    const inB = received(b);

    a.localStorage.setItem("k", "1");
    a.localStorage.setItem("k", "2");
    expect(inB).toEqual([]);
    await delivered();

    expect(b.localStorage.getItem("k")).toBe("2");
    expect(inA).toEqual([]);
    expect(inB).toEqual([
      { type: "storage", key: "k", oldValue: null, newValue: "1" },
      { type: "storage", key: "k", oldValue: "1", newValue: "2" },
    ]);
  });

  it("fires nothing for a write that changes nothing", async () => {
    const browser = makeHarnessBrowser();
    const a = browser.openTab();
    const inB = received(browser.openTab());

    a.localStorage.removeItem("absent");
    a.localStorage.clear();
    a.localStorage.setItem("k", "1");
    a.localStorage.setItem("k", "1");
    await delivered();

    expect(inB).toEqual([{ type: "storage", key: "k", oldValue: null, newValue: "1" }]);
  });

  it("reaches other tabs with a null key when storage is cleared", async () => {
    const browser = makeHarnessBrowser();
    const a = browser.openTab();
    const b = browser.openTab();
    a.localStorage.setItem("k", "1");
    await delivered();
    const inB = received(b);

    a.localStorage.clear();
    await delivered();

    expect(b.localStorage.length).toBe(0);
    expect(inB).toEqual([{ type: "storage", key: null, oldValue: null, newValue: null }]);
  });

  it("keeps sessionStorage per tab", () => {
    const browser = makeHarnessBrowser();
    const a = browser.openTab();
    const b = browser.openTab();

    a.sessionStorage.setItem("k", "a");

    expect(a.sessionStorage.getItem("k")).toBe("a");
    expect(b.sessionStorage.getItem("k")).toBeNull();
  });

  it("starts with a legacy session: the session key and no owner record", async () => {
    const browser = makeHarnessBrowser({ session: { accessToken: "access-1" } });
    const tab = browser.openTab();

    expect(browser.localStorageKeys()).toEqual([ZEROPS_SESSION_STORAGE_KEY]);
    await expect(loadZeropsSession(tab.zeropsStorage)).resolves.toEqual({
      accessToken: "access-1",
    });
  });

  it("keeps the Zerops session shared and the organization selection per tab", async () => {
    const browser = makeHarnessBrowser();
    const a = browser.openTab();
    const b = browser.openTab();
    const selection = (clientId: string) => ({
      userId: "user-1",
      clientUserId: `cu-${clientId}`,
      clientId,
      projectId: null,
    });

    await saveZeropsSelection(a.zeropsStorage, selection("org-a"));
    await saveZeropsSelection(b.zeropsStorage, selection("org-b"));

    await expect(loadZeropsSelection(a.zeropsStorage, "user-1")).resolves.toEqual(
      selection("org-a"),
    );
    const c = browser.openTab();
    await expect(loadZeropsSelection(c.zeropsStorage, "user-1")).resolves.toEqual(
      selection("org-b"),
    );
    expect(browser.localStorageKeys()).toEqual([`${ZEROPS_SELECTION_STORAGE_KEY}:user-1`]);
  });

  it("grants a Web Lock to one holder at a time, in request order", async () => {
    const browser = makeHarnessBrowser();
    const a = browser.openTab();
    const b = browser.openTab();
    const order: string[] = [];
    let releaseA!: () => void;

    const first = a.locks.request("mate:zerops-refresh", async (lock) => {
      order.push(`a:${lock?.name}`);
      await new Promise<void>((resolve) => {
        releaseA = resolve;
      });
      order.push("a:done");
      return "a";
    });
    const second = b.locks.request("mate:zerops-refresh", async () => {
      order.push("b");
      return "b";
    });
    await delivered();
    expect(order).toEqual(["a:mate:zerops-refresh"]);
    expect(browser.locksHeld()).toEqual(["mate:zerops-refresh"]);

    releaseA();
    await expect(Promise.all([first, second])).resolves.toEqual(["a", "b"]);
    expect(order).toEqual(["a:mate:zerops-refresh", "a:done", "b"]);
    expect(browser.locksHeld()).toEqual([]);
  });

  it("answers ifAvailable with no lock while another tab holds it", async () => {
    const browser = makeHarnessBrowser();
    const a = browser.openTab();
    const b = browser.openTab();
    let release!: () => void;
    const held = a.locks.request(
      "mate:tags:p1",
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await delivered();

    await expect(
      b.locks.request("mate:tags:p1", { ifAvailable: true }, async (lock) => lock),
    ).resolves.toBeNull();
    release();
    await held;
  });

  it("delivers a BroadcastChannel message to every other channel of its name, never the sender", async () => {
    const browser = makeHarnessBrowser();
    const a = browser.openTab();
    const b = browser.openTab();
    const sender = new a.BroadcastChannel("mate:account");
    const sameTab = new a.BroadcastChannel("mate:account");
    const otherTab = new b.BroadcastChannel("mate:account");
    const otherName = new b.BroadcastChannel("mate:other");
    const seen: string[] = [];
    for (const [label, channel] of [
      ["sender", sender],
      ["sameTab", sameTab],
      ["otherTab", otherTab],
      ["otherName", otherName],
    ] as const)
      channel.addEventListener("message", (event) => seen.push(`${label}:${String(event.data)}`));

    sender.postMessage("hello");
    expect(seen).toEqual([]);
    await delivered();

    expect(seen.sort()).toEqual(["otherTab:hello", "sameTab:hello"]);
  });

  it("drops a reloaded page's locks, channels and listeners but keeps its sessionStorage", async () => {
    const browser = makeHarnessBrowser();
    const a = browser.openTab();
    const b = browser.openTab();
    a.sessionStorage.setItem("k", "kept");
    const inA = received(a);
    void a.locks.request("mate:zerops-refresh", () => new Promise<void>(() => undefined));
    const channel = new a.BroadcastChannel("mate:account");
    const seen: unknown[] = [];
    channel.addEventListener("message", (event) => seen.push(event.data));
    await delivered();

    a.reload();
    new b.BroadcastChannel("mate:account").postMessage("after");
    b.localStorage.setItem("k", "after");
    await delivered();

    expect(a.reloads).toBe(1);
    expect(browser.locksHeld()).toEqual([]);
    expect(seen).toEqual([]);
    expect(inA).toEqual([]);
    expect(a.sessionStorage.getItem("k")).toBe("kept");
  });

  it("changes tab state on each signal and tells subscribers once per change", () => {
    const browser = makeHarnessBrowser();
    const tab = browser.openTab();
    const signals = received(tab);

    tab.signals.hide();
    tab.signals.hide();
    tab.signals.freeze();
    tab.signals.resume();
    tab.signals.offline();
    tab.signals.online();
    tab.signals.blur();
    tab.signals.focus();
    tab.signals.pageshow({ persisted: true });
    tab.signals.show();

    expect(signals).toEqual([
      { type: "visibilitychange", visibilityState: "hidden" },
      { type: "freeze" },
      { type: "resume" },
      { type: "offline" },
      { type: "online" },
      { type: "blur" },
      { type: "focus" },
      { type: "pageshow", persisted: true },
      { type: "visibilitychange", visibilityState: "visible" },
    ]);
    expect(tab.signals.state()).toEqual({
      visibilityState: "visible",
      frozen: false,
      online: true,
      focused: true,
    });
  });
});
