import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import {
  readWriterMemory,
  rememberedWriter,
  rememberWriter,
  WRITER_MEMORY_CAP,
  withWriter,
  writeWriterMemory,
  type WriterMemory,
} from "./writerMemory";

/** A conversation: `env-a/main` is the Mate's main chat, `env-a/crew` another of its chats. */
const chat = (id: string) => {
  const [environmentId = "", threadId = ""] = id.split("/");
  return scopeThreadRef(EnvironmentId.make(environmentId), ThreadId.make(threadId));
};
const key = (id: string) => scopedThreadKey(chat(id));

describe("the conversation writer memory", () => {
  it.each<{
    readonly name: string;
    readonly memory: WriterMemory;
    readonly write: readonly [string, "you" | "someone" | "nobody-yet"];
    readonly expected: WriterMemory;
  }>([
    {
      name: "remembers a known answer",
      memory: {},
      write: ["env-a/main", "someone"],
      expected: { [key("env-a/main")]: "someone" },
    },
    {
      name: "replaces the answer it held, newest last",
      memory: { [key("env-a/main")]: "you", [key("env-b/main")]: "someone" },
      write: ["env-a/main", "someone"],
      expected: { [key("env-b/main")]: "someone", [key("env-a/main")]: "someone" },
    },
    {
      name: "keeps each conversation's own answer in one environment",
      memory: { [key("env-a/main")]: "you" },
      write: ["env-a/crew", "someone"],
      expected: { [key("env-a/main")]: "you", [key("env-a/crew")]: "someone" },
    },
  ])("$name", ({ memory, write, expected }) => {
    const next = withWriter(memory, chat(write[0]), write[1]);
    expect(next).toEqual(expected);
    expect(Object.keys(next)).toEqual(Object.keys(expected));
  });

  it("keeps the same memory when the newest answer is unchanged, so nothing is written", () => {
    const memory: WriterMemory = { [key("env-a/main")]: "you", [key("env-b/main")]: "someone" };
    expect(withWriter(memory, chat("env-b/main"), "someone")).toBe(memory);
  });

  it("is bounded: past its cap the oldest answer goes", () => {
    let memory: WriterMemory = {};
    for (let index = 0; index <= WRITER_MEMORY_CAP; index += 1) {
      memory = withWriter(memory, chat(`env-${index}/main`), "you");
    }
    expect(Object.keys(memory)).toHaveLength(WRITER_MEMORY_CAP);
    expect(memory[key("env-0/main")]).toBeUndefined();
    expect(memory[key(`env-${WRITER_MEMORY_CAP}/main`)]).toBe("you");
  });

  it.each<{ readonly name: string; readonly text: string | null; readonly expected: WriterMemory }>(
    [
      { name: "nothing stored", text: null, expected: {} },
      { name: "unreadable text", text: "{", expected: {} },
      { name: "not an object", text: "[1]", expected: {} },
      {
        name: "an answer it does not know is dropped",
        text: JSON.stringify({ "env-a": "you", "env-b": "maybe", "env-c": 3 }),
        expected: { "env-a": "you" },
      },
    ],
  )("reads $name", ({ text, expected }) => {
    expect(readWriterMemory(text)).toEqual(expected);
  });

  it("reads back what it wrote", () => {
    const memory: WriterMemory = { "env-a": "you", "env-b": "nobody-yet" };
    expect(readWriterMemory(writeWriterMemory(memory))).toEqual(memory);
  });
});

describe("the conversation writer memory, per signed-in person", () => {
  const values = new Map<string, string>();
  beforeEach(() => {
    values.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
  });
  afterEach(() => {
    closeAccountLifetime();
    vi.unstubAllGlobals();
  });

  it("reads what this person's browser remembered, and survives a reload", () => {
    openAccountLifetime("person-a");
    rememberWriter(chat("env-a/main"), "someone");
    expect(rememberedWriter(chat("env-a/main"))).toBe("someone");
    expect(rememberedWriter(chat("env-b/main"))).toBeUndefined();
    expect([...values.values()].join("")).toContain("someone");
  });

  // A colleague's crewmate in the viewer's own Mate: its answer is that chat's, not the Mate's.
  it("gives another conversation of the same Mate nothing of one's answer", () => {
    openAccountLifetime("person-a");
    rememberWriter(chat("env-a/crew"), "someone");
    expect(rememberedWriter(chat("env-a/main"))).toBeUndefined();
  });

  it("gives another signed-in person nothing", () => {
    openAccountLifetime("person-a");
    rememberWriter(chat("env-a/main"), "you");
    openAccountLifetime("person-b");
    expect(rememberedWriter(chat("env-a/main"))).toBeUndefined();
  });

  it("remembers nothing with nobody signed in", () => {
    rememberWriter(chat("env-a/main"), "you");
    expect(rememberedWriter(chat("env-a/main"))).toBeUndefined();
    expect(values.size).toBe(0);
  });
});
