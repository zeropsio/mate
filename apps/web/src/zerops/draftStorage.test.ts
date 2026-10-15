import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { quotaStorage } from "../lib/__fixtures__/quotaStorage";
import { accountLocalStorage, closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { createDraftStorage } from "./draftStorage";
const memory = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
      return true;
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    keys: () => [...data.keys()],
  };
};
const branchesOf = (storage: ReturnType<typeof memory>, key: string) =>
  [...storage.data.keys()].filter((stored) => stored.startsWith(`${key}:tab:`));
describe("draft branches", () => {
  it("preserves concurrent edits, resumes each tab after reload, and never revives a cleared draft", () => {
    const storage = memory();
    const tabA = memory();
    const tabB = memory();
    const a = createDraftStorage(
      storage,
      () => tabA,
      () => "a",
    );
    a.setItem("draft", "unsent A");
    const b = createDraftStorage(
      storage,
      () => tabB,
      () => "b",
    );
    expect(b.getItem("draft")).toBe("unsent A");
    b.setItem("draft", "unsent B");
    expect(a.getItem("draft")).toBe("unsent A");
    a.setItem("draft", "new A");
    expect(b.getItem("draft")).toBe("unsent B");
    const reloadedB = createDraftStorage(
      storage,
      () => tabB,
      () => "b2",
    );
    expect(reloadedB.getItem("draft")).toBe("unsent B");
    const twiceReloadedB = createDraftStorage(
      storage,
      () => tabB,
      () => "b3",
    );
    expect(twiceReloadedB.getItem("draft")).toBe("unsent B");
    reloadedB.removeItem("draft");
    expect(reloadedB.getItem("draft")).toBe("");
    expect(a.getItem("draft")).toBe("new A");
  });

  it("a tab reloaded all day keeps one draft branch", () => {
    const storage = memory();
    const tabA = memory();
    const tabB = memory();
    createDraftStorage(
      storage,
      () => tabA,
      () => "a",
    ).setItem("draft", "unsent A");
    for (let load = 0; load < 100; load += 1) {
      const b = createDraftStorage(
        storage,
        () => tabB,
        () => `b${load}`,
      );
      expect(b.getItem("draft")).toBe(load === 0 ? "unsent A" : "unsent B");
      b.setItem("draft", "unsent B");
    }

    expect(branchesOf(storage, "draft")).toHaveLength(2);
  });

  it("tabs closed long ago leave at most eight draft branches behind", () => {
    const storage = memory();
    for (let tab = 0; tab < 30; tab += 1) {
      const opened = createDraftStorage(
        storage,
        memory,
        () => `tab${tab}`,
        () => tab,
      );
      opened.getItem("draft");
      opened.setItem("draft", `unsent ${tab}`);
    }

    expect(branchesOf(storage, "draft")).toHaveLength(8);
    const next = createDraftStorage(storage, memory, () => "next");
    expect(next.getItem("draft")).toBe("unsent 29");
  });

  it("a storage already full of draft branches recovers on the next load", () => {
    const storage = memory();
    const draft = "x".repeat(10_310);
    // What the owner's browser held: one branch per page load, from before branches carried time.
    for (let load = 0; load < 588; load += 1) storage.setItem(`draft:tab:${load}-legacy`, draft);
    storage.setItem("draft:tab:587-legacy", "last typed");
    storage.setItem("draft:latest", "587-legacy");

    const opened = createDraftStorage(storage, memory, () => "next");

    expect(opened.getItem("draft")).toBe("last typed");
    expect(branchesOf(storage, "draft").length).toBeLessThanOrEqual(8);
  });
});

describe("a full localStorage", () => {
  afterEach(() => {
    closeAccountLifetime();
    vi.unstubAllGlobals();
  });

  it("an origin filled with draft branches makes room for the next write", () => {
    const branch = (id: string) => `mate:account:owner:t3code:composer-drafts:v1:tab:${id}`;
    // The owner's browser: 588 branches of about 8.7k characters, the rest of 5 MiB in other keys.
    const draft = "x".repeat(8_600);
    const browser = quotaStorage(5_242_880);
    browser.values.set("mate:account:owner:t3code:composer-drafts:v1:latest", "587");
    for (let load = 0; load < 588; load += 1) browser.values.set(branch(String(load)), draft);
    let filled = 0;
    while (filled < 5_242_880) {
      try {
        browser.setItem(`filler-${filled}`, "x".repeat(1_000));
        filled += 1_000;
      } catch {
        break;
      }
    }
    vi.stubGlobal("window", { localStorage: browser });
    openAccountLifetime("owner");

    accountLocalStorage.setItem("t3code:right-panel-state:v2", "y".repeat(7_118));

    expect(browser.getItem("mate:account:owner:t3code:right-panel-state:v2")).toHaveLength(7_118);
    expect([...browser.values.keys()].filter((key) => key.includes(":tab:"))).toEqual([
      branch("587"),
    ]);
  });
});
