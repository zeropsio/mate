import { EnvironmentId } from "@t3tools/contracts";
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

const env = (id: string) => EnvironmentId.make(id);

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
      write: ["env-a", "someone"],
      expected: { "env-a": "someone" },
    },
    {
      name: "replaces the answer it held, newest last",
      memory: { "env-a": "you", "env-b": "someone" },
      write: ["env-a", "someone"],
      expected: { "env-b": "someone", "env-a": "someone" },
    },
  ])("$name", ({ memory, write, expected }) => {
    const next = withWriter(memory, env(write[0]), write[1]);
    expect(next).toEqual(expected);
    expect(Object.keys(next)).toEqual(Object.keys(expected));
  });

  it("keeps the same memory when the newest answer is unchanged, so nothing is written", () => {
    const memory: WriterMemory = { "env-a": "you", "env-b": "someone" };
    expect(withWriter(memory, env("env-b"), "someone")).toBe(memory);
  });

  it("is bounded: past its cap the oldest answer goes", () => {
    let memory: WriterMemory = {};
    for (let index = 0; index <= WRITER_MEMORY_CAP; index += 1) {
      memory = withWriter(memory, env(`env-${index}`), "you");
    }
    expect(Object.keys(memory)).toHaveLength(WRITER_MEMORY_CAP);
    expect(memory["env-0"]).toBeUndefined();
    expect(memory[`env-${WRITER_MEMORY_CAP}`]).toBe("you");
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
    rememberWriter(env("env-a"), "someone");
    expect(rememberedWriter(env("env-a"))).toBe("someone");
    expect(rememberedWriter(env("env-b"))).toBeUndefined();
    expect([...values.values()].join("")).toContain("someone");
  });

  it("gives another signed-in person nothing", () => {
    openAccountLifetime("person-a");
    rememberWriter(env("env-a"), "you");
    openAccountLifetime("person-b");
    expect(rememberedWriter(env("env-a"))).toBeUndefined();
  });

  it("remembers nothing with nobody signed in", () => {
    rememberWriter(env("env-a"), "you");
    expect(rememberedWriter(env("env-a"))).toBeUndefined();
    expect(values.size).toBe(0);
  });
});
