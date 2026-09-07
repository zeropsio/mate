import { describe, expect, it } from "vite-plus/test";
import { createDraftStorage } from "./draftStorage";
const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
};
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
});
