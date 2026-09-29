import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import {
  COMPOSER_TOP_MEMORY_STORAGE_KEY,
  COMPOSER_TOP_MEMORY_THREADS,
  rememberComposerTop,
  rememberedComposerTop,
  withComposerTop,
  type RememberedComposerTop,
} from "./composerTopMemory";

const NOVA: RememberedComposerTop = {
  groupId: "g-1",
  repository: "app",
  number: 2,
  title: "Add a status page",
  words: "Nova is waiting for your review of #2",
  tint: "slate",
};

describe("withComposerTop", () => {
  it("holds what a conversation's top showed, and forgets it once nothing waits", () => {
    const remembered = withComposerTop({}, "env-nova:thread-1", NOVA);
    expect(remembered).toEqual({ "env-nova:thread-1": NOVA });
    expect(withComposerTop(remembered, "env-nova:thread-1", NOVA)).toBe(remembered);
    expect(withComposerTop(remembered, "env-nova:thread-1", null)).toEqual({});
    expect(withComposerTop({}, "env-nova:thread-1", null)).toEqual({});
  });

  it("keeps the conversations most recently shown, the oldest going first", () => {
    let memory = {};
    for (let index = 0; index <= COMPOSER_TOP_MEMORY_THREADS; index += 1) {
      memory = withComposerTop(memory, `env:thread-${String(index)}`, { ...NOVA, number: index });
    }
    const keys = Object.keys(memory);
    expect(keys).toHaveLength(COMPOSER_TOP_MEMORY_THREADS);
    expect(keys).not.toContain("env:thread-0");
    expect(keys.at(-1)).toBe(`env:thread-${String(COMPOSER_TOP_MEMORY_THREADS)}`);
  });
});

describe("the composer top's memory in this browser", () => {
  const stored = new Map<string, string>();

  beforeEach(() => {
    vi.useFakeTimers();
    stored.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
        removeItem: (key: string) => stored.delete(key),
      },
    });
  });

  afterEach(() => {
    closeAccountLifetime();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is read at once, written per account a moment later, and gone when the account closes", () => {
    openAccountLifetime("user-ales");
    rememberComposerTop("env-nova:thread-1", NOVA);
    expect(rememberedComposerTop("env-nova:thread-1")).toEqual(NOVA);
    expect(stored.size).toBe(0);
    vi.advanceTimersByTime(400);
    const key = `mate:account:user-ales:${COMPOSER_TOP_MEMORY_STORAGE_KEY}`;
    expect(JSON.parse(stored.get(key) ?? "{}")["env-nova:thread-1"].words).toBe(
      "Nova is waiting for your review of #2",
    );

    closeAccountLifetime();
    expect(stored.has(key)).toBe(false);
    openAccountLifetime("user-ales");
    expect(rememberedComposerTop("env-nova:thread-1")).toBeUndefined();
  });

  it("reads back what an earlier page wrote, and nothing another account did", () => {
    openAccountLifetime("user-ales");
    rememberComposerTop("env-nova:thread-1", NOVA);
    vi.advanceTimersByTime(400);
    openAccountLifetime("user-jan");
    expect(rememberedComposerTop("env-nova:thread-1")).toBeUndefined();
  });

  it("remembers nothing before an account is open", () => {
    rememberComposerTop("env-nova:thread-1", NOVA);
    vi.advanceTimersByTime(400);
    expect(stored.size).toBe(0);
    expect(rememberedComposerTop("env-nova:thread-1")).toBeUndefined();
  });

  it("reads a stored shape it does not know as nothing remembered", () => {
    stored.set(
      `mate:account:user-ales:${COMPOSER_TOP_MEMORY_STORAGE_KEY}`,
      '{"x":{"number":"two"}}',
    );
    openAccountLifetime("user-ales");
    expect(rememberedComposerTop("x")).toBeUndefined();
  });
});
