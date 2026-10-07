import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { openAccountLifetime, closeAccountLifetime } from "./accountLifetime";
import { dismissComposerReview, dismissedComposerReview } from "./composerReviewDismissal";
const stored = new Map<string, string>();
beforeEach(() => {
  stored.clear();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
  });
  openAccountLifetime("ales");
});
afterEach(() => {
  closeAccountLifetime();
  vi.unstubAllGlobals();
});
it("a reload keeps only the dismissed identity, scoped to its account and conversation", () => {
  const id = JSON.stringify(["app", "api", 2]);
  dismissComposerReview("env:thread", id);
  expect(dismissedComposerReview("env:other")).toBeUndefined();
  closeAccountLifetime();
  openAccountLifetime("ales");
  expect(dismissedComposerReview("env:thread")).toBe(id);
  openAccountLifetime("jan");
  expect(dismissedComposerReview("env:thread")).toBeUndefined();
  expect([...stored.values()]).toEqual([JSON.stringify({ "env:thread": id })]);
});
