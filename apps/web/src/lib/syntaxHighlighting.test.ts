import type { DiffsHighlighter } from "@pierre/diffs";
import { expect, it, vi } from "vite-plus/test";

const { getSharedHighlighter, runtimeLoads } = vi.hoisted(() => ({
  getSharedHighlighter: vi.fn(),
  runtimeLoads: vi.fn(),
}));

vi.mock("@pierre/diffs", () => {
  runtimeLoads();
  return { getSharedHighlighter };
});

import { getSyntaxHighlighterPromise, getSyntaxRuntimePromise } from "./syntaxHighlighting";

it("does not load the diff runtime until syntax is demanded and shares that load", async () => {
  expect(runtimeLoads).toHaveBeenCalledTimes(0);
  const first = getSyntaxRuntimePromise();
  expect(getSyntaxRuntimePromise()).toBe(first);
  await first;
  expect(runtimeLoads).toHaveBeenCalledTimes(1);
  expect(getSharedHighlighter).toHaveBeenCalledTimes(0);
});

it("caches the recovered text highlighter for unsupported languages", async () => {
  const textHighlighter = {} as DiffsHighlighter;
  getSharedHighlighter.mockImplementation(({ langs }: { langs: string[] }) =>
    langs[0] === "text"
      ? Promise.resolve(textHighlighter)
      : Promise.reject(new Error("unsupported language")),
  );

  const first = getSyntaxHighlighterPromise("unsupported-test-language");
  await expect(first).resolves.toBe(textHighlighter);
  const second = getSyntaxHighlighterPromise("unsupported-test-language");

  expect(second).toBe(first);
  expect(getSharedHighlighter).toHaveBeenCalledTimes(2);
});
