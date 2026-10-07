import type { VaultScope } from "@t3tools/client-runtime/data";
import { describe, expect, it } from "vite-plus/test";

import {
  diffVaultText,
  envPasteLines,
  pasteIntoText,
  VAULT_MASK,
  vaultToText,
} from "./vaultText.logic";
import { vaultFixtureScope } from "./vaultFixture";

const SHARED = vaultFixtureScope("shared");
const APPDEV = vaultFixtureScope("svc-appdev");
const M = VAULT_MASK;

const START = vaultToText(SHARED);

describe("vaultToText", () => {
  it("writes plain values as they are and sensitive ones masked, each by key", () => {
    expect(START).toEqual({
      plain: "API_URL=https://api.acme.dev\nLOG_LEVEL=debug",
      sensitive: `LEGACY_TOKEN=${M}\nSESSION_SECRET=${M}\nSTRIPE_SECRET_KEY=${M}`,
    });
  });

  it.each([
    ["two\nlines", 'K="two\\nlines"'],
    [" padded ", 'K=" padded "'],
    ['"quoted"', 'K="\\"quoted\\""'],
    ["a#b=c", "K=a#b=c"],
    ["", "K="],
  ])("quotes %j only where it must", (value, line) => {
    const scope: VaultScope = {
      ...SHARED,
      values: [{ ...SHARED.values[0]!, key: "K", value, sensitive: false }],
    };
    expect(vaultToText(scope).plain).toBe(line);
  });

  it("reads back what it wrote", () => {
    const scope: VaultScope = {
      ...SHARED,
      values: ["two\nlines", " padded ", '"quoted"', "back\\slash"].map((value, index) => ({
        ...SHARED.values[0]!,
        id: `v${index}`,
        key: `K${index}`,
        value,
      })),
    };
    expect(diffVaultText(scope, vaultToText(scope))).toEqual({
      writes: [],
      problems: [],
      marks: { plain: [null, null, null, null], sensitive: [] },
    });
  });
});

describe("diffVaultText", () => {
  it("finds nothing in the text as written", () => {
    expect(diffVaultText(SHARED, START).writes).toEqual([]);
  });

  it.each([
    [
      "an added plain line",
      { ...START, plain: `${START.plain}\nCDN_URL=https://cdn.acme.dev` },
      [{ kind: "add", key: "CDN_URL", value: "https://cdn.acme.dev", sensitive: false }],
    ],
    [
      "an added sensitive line",
      { ...START, sensitive: `${START.sensitive}\nNEW_TOKEN=abc` },
      [{ kind: "add", key: "NEW_TOKEN", value: "abc", sensitive: true }],
    ],
    [
      "a changed plain value",
      { ...START, plain: "API_URL=https://api.acme.shop\nLOG_LEVEL=debug" },
      [
        {
          kind: "update",
          id: "v-api",
          key: "API_URL",
          value: "https://api.acme.shop",
          sensitive: false,
        },
      ],
    ],
    [
      "a sensitive value typed over",
      { ...START, sensitive: START.sensitive.replace(`SESSION_SECRET=${M}`, "SESSION_SECRET=new") },
      [{ kind: "update", id: "v-session", key: "SESSION_SECRET", value: "new", sensitive: true }],
    ],
    [
      "a plain value moved to sensitive, unchanged",
      {
        plain: "API_URL=https://api.acme.dev",
        sensitive: `${START.sensitive}\nLOG_LEVEL=${M}`,
      },
      [{ kind: "update", id: "v-log", key: "LOG_LEVEL", value: "debug", sensitive: true }],
    ],
    [
      "a sensitive value moved to plain with a value",
      {
        plain: `${START.plain}\nLEGACY_TOKEN=visible`,
        sensitive: `SESSION_SECRET=${M}\nSTRIPE_SECRET_KEY=${M}`,
      },
      [{ kind: "update", id: "v-legacy", key: "LEGACY_TOKEN", value: "visible", sensitive: false }],
    ],
    [
      "a deleted line",
      { ...START, sensitive: `SESSION_SECRET=${M}\nSTRIPE_SECRET_KEY=${M}` },
      [{ kind: "remove", id: "v-legacy", key: "LEGACY_TOKEN" }],
    ],
    [
      "comments, blanks, export and quotes",
      {
        ...START,
        plain: `# urls\n\nexport API_URL='https://api.acme.dev'\nLOG_LEVEL = "debug"`,
      },
      [],
    ],
  ] as const)("%s", (_, text, writes) => {
    const diff = diffVaultText(SHARED, text);
    expect(diff.problems).toEqual([]);
    expect(diff.writes).toEqual(writes);
  });

  it("lists adds, then changes, then removals", () => {
    const diff = diffVaultText(SHARED, {
      plain: "LOG_LEVEL=info\nA_NEW=1",
      sensitive: `SESSION_SECRET=${M}\nSTRIPE_SECRET_KEY=${M}\nLEGACY_TOKEN=${M}`,
    });
    expect(diff.writes.map((write) => `${write.kind} ${write.key}`)).toEqual([
      "add A_NEW",
      "update LOG_LEVEL",
      "remove API_URL",
    ]);
  });

  it.each([
    ["plain", "not a pair", "Write it as KEY=value"],
    ["plain", "bad-key!=1", "Letters, digits and _ only, not starting with a digit"],
    ["plain", `SESSION_SECRET=${M}`, "Type SESSION_SECRET's value to make it plain"],
    ["sensitive", `BRAND_NEW=${M}`, "Type a value for BRAND_NEW"],
  ] as const)("marks a bad %s line: %s", (section, line, message) => {
    const text = { ...START, [section]: `${START[section]}\n${line}` };
    const diff = diffVaultText(SHARED, text);
    expect(diff.problems.map((problem) => problem.message)).toContain(message);
    expect(diff.marks[section].at(-1)).toBe("!");
  });

  it("refuses a key held in another case", () => {
    const diff = diffVaultText(SHARED, { ...START, plain: "LOG_LEVEL=debug\napi_url=x" });
    expect(diff.problems.map((problem) => problem.message)).toEqual(["API_URL already exists"]);
  });

  it("marks a key on two lines", () => {
    const diff = diffVaultText(SHARED, { ...START, plain: `${START.plain}\nLOG_LEVEL=info` });
    expect(diff.problems).toEqual([
      { section: "plain", line: 2, key: "LOG_LEVEL", message: "LOG_LEVEL is on two lines" },
    ]);
  });

  it("refuses a service value its zerops.yml already sets", () => {
    const diff = diffVaultText(APPDEV, {
      plain: "FEATURE_FLAGS=cart-vat,new-search\nNODE_ENV=x",
      sensitive: "",
    });
    expect(diff.problems.map((problem) => problem.message)).toEqual([
      "appdev's zerops.yml already sets NODE_ENV",
    ]);
  });

  it("marks each line by what it does", () => {
    const diff = diffVaultText(SHARED, {
      plain: "API_URL=https://api.acme.dev\nLOG_LEVEL=info\nNEW=1\nnope",
      sensitive: START.sensitive,
    });
    expect(diff.marks.plain).toEqual([null, "~", "+", "!"]);
  });
});

describe("envPasteLines", () => {
  it.each([
    ["A=1\nB=2", true],
    ["export A=1\r\n# c\nB=2\n", true],
    ["A=1", false],
    ["just text\nmore text", false],
    ["SINGLE_KEY", false],
  ])("%j is a .env: %s", (pasted, isEnv) => {
    expect(envPasteLines(pasted) !== null).toBe(isEnv);
  });
});

describe("pasteIntoText", () => {
  it("puts each pasted line in its section by name, after what is there", () => {
    expect(pasteIntoText(START, "CDN_URL=https://cdn\nGITHUB_TOKEN=ghp")).toEqual({
      plain: `${START.plain}\nCDN_URL=https://cdn`,
      sensitive: `${START.sensitive}\nGITHUB_TOKEN=ghp`,
    });
  });

  it("starts an empty section without a blank line", () => {
    expect(pasteIntoText({ plain: "", sensitive: "" }, "A=1\nB=2")).toEqual({
      plain: "A=1\nB=2",
      sensitive: "",
    });
  });
});
