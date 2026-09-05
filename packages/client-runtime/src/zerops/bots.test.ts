import { describe, expect, it } from "vite-plus/test";

import { botDisplayName, generateBotName, hasBotName, ZEROPS_BOT_NAME_POOL } from "./bots.ts";
import type { RandomBytes } from "./newProject.ts";

/** Deterministic bytes, so a name choice is a fact rather than a coin flip. */
function bytesReturning(...values: ReadonlyArray<number>): RandomBytes {
  let index = 0;
  return (into: Uint8Array<ArrayBuffer>) => {
    for (let i = 0; i < into.length; i += 1) {
      into[i] = values[index % values.length] ?? 0;
      index += 1;
    }
    return into;
  };
}

describe("generateBotName", () => {
  it("names a first environment from the pool", () => {
    expect(ZEROPS_BOT_NAME_POOL).toContain(generateBotName([], bytesReturning(0)));
  });

  it("never repeats a name a sibling already has", () => {
    const taken: Array<string> = [];
    for (let i = 0; i < ZEROPS_BOT_NAME_POOL.length; i += 1) {
      taken.push(generateBotName(taken, bytesReturning(0)));
    }
    expect(new Set(taken).size).toBe(ZEROPS_BOT_NAME_POOL.length);
  });

  it("ignores case when deciding what is taken", () => {
    const name = generateBotName(["ada"], bytesReturning(0));
    expect(name.toLowerCase()).not.toBe("ada");
  });

  it("suffixes rather than failing once the pool is exhausted", () => {
    const name = generateBotName([...ZEROPS_BOT_NAME_POOL], bytesReturning(0));
    expect(name).toMatch(/ 2$/u);
    expect(ZEROPS_BOT_NAME_POOL).not.toContain(name);
  });

  it("keeps suffixing past the second round", () => {
    const taken = [...ZEROPS_BOT_NAME_POOL, ...ZEROPS_BOT_NAME_POOL.map((name) => `${name} 2`)];
    expect(generateBotName(taken, bytesReturning(0))).toMatch(/ 3$/u);
  });

  it("draws again rather than skewing when a byte is out of range", () => {
    // A byte at or above the rejection limit must be discarded, not folded in,
    // or the first names in the pool come up more often than the last.
    const name = generateBotName([], bytesReturning(255, 1));
    expect(ZEROPS_BOT_NAME_POOL).toContain(name);
  });
});

describe("botDisplayName", () => {
  it.each([
    ["the agent's name when it has one", "Ada", "crm-dev", "Ada"],
    ["the project's name when it does not", undefined, "crm-dev", "crm-dev"],
    ["the project's name for a blank one", "   ", "crm-dev", "crm-dev"],
  ] as const)("shows %s", (_label, bot, projectName, expected) => {
    expect(botDisplayName({ bot, projectName })).toBe(expected);
  });
});

describe("hasBotName", () => {
  it.each([
    ["Ada", true],
    [undefined, false],
    ["  ", false],
  ] as const)("%s -> %s", (bot, expected) => {
    expect(hasBotName(bot)).toBe(expected);
  });
});
