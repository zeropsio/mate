import { describe, expect, it } from "vite-plus/test";
import { createEntryStorage, foldDraftBranches } from "./draftStorage";
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
const drafts = (byThread: Record<string, string>) => ({
  state: { drafts: byThread, sticky: "codex" },
  version: 1,
});

describe("draft entries", () => {
  it("preserves concurrent edits, resumes each tab after reload, and never revives a cleared draft", () => {
    const storage = memory();
    const a = createEntryStorage(storage);
    expect(a.getItem("draft")).toBeNull();
    a.setItem("draft", drafts({ x: "unsent A" }));
    const b = createEntryStorage(storage);
    expect(b.getItem("draft")).toEqual(drafts({ x: "unsent A" }));
    b.setItem("draft", drafts({ x: "unsent A", y: "unsent B" }));
    // Tab A never read thread y: its next write leaves y alone.
    a.setItem("draft", drafts({ x: "new A" }));

    const reloadedB = createEntryStorage(storage);
    expect(reloadedB.getItem("draft")).toEqual(drafts({ x: "new A", y: "unsent B" }));
    const reloadedA = createEntryStorage(storage);
    reloadedA.getItem("draft");
    reloadedB.setItem("draft", drafts({ x: "new A" }));
    // Tab A still holds y as it read it; an edit of x does not bring y back.
    reloadedA.setItem("draft", drafts({ x: "newer A", y: "unsent B" }));

    expect(createEntryStorage(storage).getItem("draft")).toEqual(drafts({ x: "newer A" }));
  });

  it("writes only the entries a change touched", () => {
    const storage = memory();
    const tab = createEntryStorage(storage);
    tab.setItem("draft", drafts({ x: "one", y: "two" }));
    const written: string[] = [];
    const setItem = storage.setItem;
    storage.setItem = (key, value) => {
      written.push(key);
      return setItem(key, value);
    };

    tab.setItem("draft", drafts({ x: "one", y: "two!" }));

    expect(written).toEqual(["draft:drafts:y"]);
  });

  it("a storage already full of draft branches recovers on the next load", () => {
    const storage = memory();
    const branch = (state: Record<string, string>) => JSON.stringify(drafts(state));
    // What the owner's browser held: one whole copy per page load.
    for (let load = 0; load < 588; load += 1) {
      storage.setItem(`draft:v1:tab:${load}-legacy`, branch({ x: "x".repeat(10_000) }));
    }
    storage.setItem("draft:v1:tab:587-legacy", branch({ x: "last typed" }));
    storage.setItem("draft:v1:latest", "587-legacy");
    const opened = createEntryStorage(storage);

    foldDraftBranches(storage, "draft:v1", (value) =>
      opened.adopt("draft:v2", JSON.parse(value) as ReturnType<typeof drafts>),
    );

    expect(opened.getItem("draft:v2")).toEqual(drafts({ x: "last typed" }));
    expect(storage.keys().filter((key) => key.startsWith("draft:v1"))).toEqual([]);
  });

  it("keeps the latest copy while it cannot land", () => {
    const storage = memory();
    storage.setItem("draft:v1:tab:old", "{}");
    storage.setItem("draft:v1:tab:new", "{}");
    storage.setItem("draft:v1:latest", "new");

    foldDraftBranches(storage, "draft:v1", () => false);

    expect(storage.keys().toSorted()).toEqual(["draft:v1:latest", "draft:v1:tab:new"]);
  });
});
