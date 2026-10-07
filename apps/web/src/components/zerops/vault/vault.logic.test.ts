import type { VaultImpact, VaultNotLive, VaultWrite } from "@t3tools/client-runtime/data";
import { describe, expect, it } from "vite-plus/test";

import {
  agoWords,
  generateVaultValue,
  impactLine,
  keyProblem,
  notLiveClosing,
  notLiveTarget,
  notLiveWords,
  readerStateWords,
  readSource,
  referenceFor,
  refusalWords,
  removeGuardWords,
  reviewLine,
  scopeCount,
  scopeName,
  scopeSections,
  sensitiveWordIn,
  serviceMonograms,
  valueLine,
} from "./vault.logic";
import { VAULT_FIXTURE, VAULT_FIXTURE_NOW, vaultFixtureScope } from "./vaultFixture";

const SHARED = vaultFixtureScope("shared");
const APPDEV = vaultFixtureScope("svc-appdev");
const DB = vaultFixtureScope("svc-db");
const valueOf = (scopeId: string, key: string) => {
  const found = vaultFixtureScope(scopeId).values.find((value) => value.key === key);
  if (found === undefined) throw new Error(key);
  return found;
};
const text = (parts: ReadonlyArray<{ readonly text: string }>) =>
  parts.map((part) => part.text).join("");

describe("sensitiveWordIn", () => {
  it.each([
    ["STRIPE_SECRET_KEY", "SECRET"],
    ["github_token", "TOKEN"],
    ["API_KEY", "KEY"],
    ["DB_PASSWORD", "PASSWORD"],
    ["SMTP_PASS", "PASS"],
    ["SENTRY_DSN", "DSN"],
    ["PRIVATE_PEM", "PRIVATE"],
    ["GCP_CREDENTIALS", "CREDENTIAL"],
    ["API_URL", null],
    ["LOG_LEVEL", null],
    ["", null],
  ])("%s → %s", (key, word) => {
    expect(sensitiveWordIn(key)).toBe(word);
  });
});

describe("keyProblem", () => {
  it.each([
    ["", SHARED, null],
    ["NEW_KEY", SHARED, null],
    ["_PRIVATE", SHARED, null],
    ["bad-key!", SHARED, "Letters, digits and _ only, not starting with a digit"],
    ["1ST", SHARED, "Letters, digits and _ only, not starting with a digit"],
    ["WITH SPACE", SHARED, "Letters, digits and _ only, not starting with a digit"],
    ["session_secret", SHARED, "SESSION_SECRET is already in Shared"],
    ["API_URL", SHARED, "API_URL is already in Shared"],
    ["feature_flags", APPDEV, "FEATURE_FLAGS is already in appdev"],
    ["NODE_ENV", APPDEV, "appdev's zerops.yml already sets NODE_ENV"],
    ["node_env", APPDEV, "appdev's zerops.yml already sets NODE_ENV"],
    ["NODE_ENV", SHARED, null],
  ])("%s in %s", (key, scope, problem) => {
    expect(keyProblem(key, scope)).toBe(problem);
  });
});

describe("generateVaultValue", () => {
  it("is 32 random bytes in base64url", () => {
    const value = generateVaultValue((target) => {
      target.fill(0xff);
      return target;
    });
    expect(value).toBe(`${"_".repeat(42)}8`);
  });

  it("asks for 32 bytes", () => {
    let asked = 0;
    generateVaultValue((target) => {
      asked = target.length;
      return target;
    });
    expect(asked).toBe(32);
  });
});

describe("agoWords", () => {
  const MIN = 60_000;
  it.each([
    [10_000, "just now"],
    [MIN, "a minute ago"],
    [5 * MIN, "5 minutes ago"],
    [60 * MIN, "an hour ago"],
    [3 * 60 * MIN, "3 hours ago"],
    [24 * 60 * MIN, "yesterday"],
    [2 * 24 * 60 * MIN, "2 days ago"],
    [14 * 24 * 60 * MIN, "2 weeks ago"],
    [70 * 24 * 60 * MIN, "2 months ago"],
    [800 * 24 * 60 * MIN, "2 years ago"],
    [-5 * MIN, "just now"],
  ])("%d ms → %s", (elapsed, words) => {
    expect(agoWords(new Date(VAULT_FIXTURE_NOW - elapsed).toISOString(), VAULT_FIXTURE_NOW)).toBe(
      words,
    );
  });

  it("is null for a time it cannot read", () => {
    expect(agoWords("not a time", VAULT_FIXTURE_NOW)).toBeNull();
    expect(agoWords(null, VAULT_FIXTURE_NOW)).toBeNull();
  });
});

describe("names and references", () => {
  it("names Shared and a service by its hostname", () => {
    expect(scopeName(SHARED)).toBe("Shared");
    expect(scopeName(APPDEV)).toBe("appdev");
  });

  it.each([
    [SHARED, "API_URL", "${API_URL}", null],
    [APPDEV, "FEATURE_FLAGS", "${FEATURE_FLAGS}", "${appdev_FEATURE_FLAGS}"],
    [DB, "password", "${db_password}", null],
  ])("a value in %s", (scope, key, own, other) => {
    expect(referenceFor(scope, key)).toEqual({ own, other });
  });
});

describe("scopeCount and scopeSections", () => {
  it("counts a scope's own values, never a managed one's", () => {
    expect(scopeCount(SHARED, "")).toBe(5);
    expect(scopeCount(vaultFixtureScope("svc-appstage"), "")).toBe(0);
    expect(scopeCount(DB, "")).toBe(0);
  });

  it("counts what a search matches, managed included", () => {
    expect(scopeCount(SHARED, "secret")).toBe(2);
    expect(scopeCount(SHARED, "acme")).toBe(1);
    expect(scopeCount(DB, "PASS")).toBe(1);
  });

  it("splits plain from sensitive, each by key", () => {
    const sections = scopeSections(SHARED, "");
    expect(sections.plain.map((value) => value.key)).toEqual(["API_URL", "LOG_LEVEL"]);
    expect(sections.sensitive.map((value) => value.key)).toEqual([
      "LEGACY_TOKEN",
      "SESSION_SECRET",
      "STRIPE_SECRET_KEY",
    ]);
  });

  it("filters keys and plain values, never a sensitive one's (it has none)", () => {
    const sections = scopeSections(SHARED, "ACME");
    expect(sections.plain.map((value) => value.key)).toEqual(["API_URL"]);
    expect(sections.sensitive).toEqual([]);
  });
});

describe("valueLine", () => {
  it.each([
    ["shared", "API_URL", { kind: "value", text: "https://api.acme.dev", tail: null }],
    ["shared", "SESSION_SECRET", { kind: "sensitive", text: "Sensitive · set 2 days ago" }],
    ["shared", "LEGACY_TOKEN", { kind: "sensitive", text: "Sensitive · set 5 months ago" }],
    [
      "shared",
      "STRIPE_SECRET_KEY",
      { kind: "sensitive", text: "Added just now · nothing reads it yet" },
    ],
    ["svc-db", "password", { kind: "sensitive", text: "Sensitive · made by Zerops" }],
  ] as const)("%s %s", (scopeId, key, line) => {
    expect(
      valueLine(
        VAULT_FIXTURE,
        vaultFixtureScope(scopeId),
        valueOf(scopeId, key),
        VAULT_FIXTURE_NOW,
      ),
    ).toEqual(line);
  });

  it("says an empty plain value is empty, never a blank line", () => {
    const empty = { ...valueOf("shared", "API_URL"), value: "" };
    expect(valueLine(VAULT_FIXTURE, SHARED, empty, VAULT_FIXTURE_NOW)).toEqual({
      kind: "empty",
      tail: null,
    });
  });

  it("tails an unread plain value", () => {
    const view = {
      ...VAULT_FIXTURE,
      notLive: [{ kind: "unread", scope: { kind: "shared" }, key: "API_URL" } as const],
    };
    expect(valueLine(view, SHARED, valueOf("shared", "API_URL"), VAULT_FIXTURE_NOW)).toEqual({
      kind: "value",
      text: "https://api.acme.dev",
      tail: "nothing reads it yet",
    });
  });
});

describe("readerStateWords", () => {
  it.each([
    ["live", "live"],
    ["restart", "started before this change — restart"],
    ["unknown", "start not known"],
  ] as const)("%s", (state, words) => {
    expect(readerStateWords(state)).toBe(words);
  });
});

describe("notLiveWords", () => {
  it.each([
    [
      { kind: "restart", serviceId: "s", hostname: "appdev", keys: ["LOG_LEVEL"] },
      "appdev started before LOG_LEVEL changed",
      "a restart applies it",
    ],
    [
      { kind: "restart", serviceId: "s", hostname: "appdev", keys: ["LOG_LEVEL", "API_URL"] },
      "appdev started before LOG_LEVEL and API_URL changed",
      "a restart applies them",
    ],
    [
      { kind: "unread", scope: { kind: "shared" }, key: "STRIPE_SECRET_KEY" },
      "Nothing reads STRIPE_SECRET_KEY yet",
      "it needs a reference in zerops.yml and a deploy",
    ],
    [
      { kind: "missing", serviceId: "s", hostname: "appdev", entry: "SEARCH_URL", name: "NOPE" },
      "appdev reads ${NOPE}, which nothing has",
      "the app gets that literal text",
    ],
    [
      { kind: "self", serviceId: "s", hostname: "appdev", entry: "DB_PASSWORD" },
      "appdev's zerops.yml sets DB_PASSWORD to ${DB_PASSWORD}",
      "the app gets that literal text",
    ],
  ] satisfies ReadonlyArray<[VaultNotLive, string, string]>)("%o", (item, fact, fix) => {
    const words = notLiveWords(item);
    expect(text(words.fact)).toBe(fact);
    expect(words.fix).toBe(fix);
  });

  it("marks the hostname strong and the key as code", () => {
    const words = notLiveWords({
      kind: "restart",
      serviceId: "s",
      hostname: "appdev",
      keys: ["LOG_LEVEL"],
    });
    expect(words.fact.filter((part) => part.kind !== "text")).toEqual([
      { kind: "strong", text: "appdev" },
      { kind: "code", text: "LOG_LEVEL" },
    ]);
  });
});

describe("notLiveTarget", () => {
  it.each([
    [VAULT_FIXTURE.notLive[0]!, { scopeId: "shared", valueId: "v-log" }],
    [VAULT_FIXTURE.notLive[1]!, { scopeId: "shared", valueId: "v-stripe" }],
    [VAULT_FIXTURE.notLive[2]!, { scopeId: "svc-appdev", valueId: null }],
    [VAULT_FIXTURE.notLive[3]!, { scopeId: "svc-appdev", valueId: null }],
  ])("%o", (item, target) => {
    expect(notLiveTarget(VAULT_FIXTURE, item)).toEqual(target);
  });
});

describe("notLiveClosing", () => {
  it.each([
    [1, "Fen", "Fen does it with your next message"],
    [3, "Fen", "Fen does these with your next message"],
  ])("%d items beside %s", (count, mate, words) => {
    expect(notLiveClosing(count, mate)).toBe(words);
  });
});

const impact = (over: Partial<VaultImpact>): VaultImpact => ({
  restart: [],
  unread: false,
  literal: [],
  ...over,
});
const APPDEV_REF = { serviceId: "svc-appdev", hostname: "appdev" };
const APPSTAGE_REF = { serviceId: "svc-appstage", hostname: "appstage" };

describe("impactLine", () => {
  it.each([
    [impact({ restart: [APPDEV_REF] }), "appdev reads it · a restart applies it"],
    [
      impact({ restart: [APPDEV_REF, APPSTAGE_REF] }),
      "appdev and appstage read it · a restart applies it",
    ],
    [impact({ unread: true }), "nothing reads it yet"],
    [impact({}), null],
  ])("%o", (given, line) => {
    expect(impactLine(given)).toBe(line);
  });
});

describe("reviewLine", () => {
  const add: VaultWrite = { kind: "add", key: "CDN_URL", value: "x", sensitive: false };
  const update: VaultWrite = {
    kind: "update",
    id: "v-api",
    key: "API_URL",
    value: "y",
    sensitive: false,
  };
  const remove: VaultWrite = { kind: "remove", id: "v-legacy", key: "LEGACY_TOKEN" };
  it.each([
    [add, impact({ unread: true }), "+", "nothing reads it yet"],
    [update, impact({ restart: [APPDEV_REF] }), "~", "appdev reads it — restart appdev"],
    [
      update,
      impact({ restart: [APPDEV_REF, APPSTAGE_REF] }),
      "~",
      "appdev and appstage read it — restart appdev and appstage",
    ],
    [update, impact({ unread: true }), "~", "nothing reads it yet"],
    [
      remove,
      impact({ literal: [APPSTAGE_REF] }),
      "−",
      "appstage reads it — it would get the literal text",
    ],
    [
      remove,
      impact({ literal: [APPDEV_REF, APPSTAGE_REF] }),
      "−",
      "appdev and appstage read it — they would get the literal text",
    ],
    [remove, impact({ unread: true }), "−", "nothing reads it"],
  ])("%o", (write, given, mark, consequence) => {
    expect(reviewLine(write, given)).toEqual({
      mark,
      key: write.key,
      consequence,
      guarded: write.kind === "remove" && given.literal.length > 0,
    });
  });
});

describe("removeGuardWords", () => {
  it.each([
    [
      "SESSION_SECRET",
      ["appdev", "appstage"],
      "appdev and appstage read SESSION_SECRET. After their next restart they'd get the literal text ${SESSION_SECRET}.",
    ],
    [
      "LEGACY_TOKEN",
      ["appstage"],
      "appstage reads LEGACY_TOKEN. After its next restart it'd get the literal text ${LEGACY_TOKEN}.",
    ],
  ])("%s", (key, hosts, words) => {
    expect(text(removeGuardWords(key, hosts))).toBe(words);
  });
});

describe("serviceMonograms", () => {
  it("never gives two services one mark: two families of dev and stage", () => {
    const marks = serviceMonograms(["medusadev", "medusastage", "nextstoredev", "nextstorestage"]);
    expect(marks).toEqual(
      new Map([
        ["medusadev", "MD"],
        ["medusastage", "MS"],
        ["nextstoredev", "ND"],
        ["nextstorestage", "NS"],
      ]),
    );
    expect(new Set(marks.values()).size).toBe(marks.size);
  });

  it("names each service by what tells it from the others", () => {
    expect(serviceMonograms(["appdev", "appstage", "db"])).toEqual(
      new Map([
        ["appdev", "D"],
        ["appstage", "S"],
        ["db", "db"],
      ]),
    );
  });

  it("keeps a name that is a prefix of another as its first letter", () => {
    expect(serviceMonograms(["app", "appdev", "api"])).toEqual(
      new Map([
        ["app", "A"],
        ["appdev", "D"],
        ["api", "I"],
      ]),
    );
  });

  it("uses the first letter of a lone long name", () => {
    expect(serviceMonograms(["storage"])).toEqual(new Map([["storage", "S"]]));
  });
});

describe("readSource", () => {
  const read = (key: string) => {
    const found = APPDEV.reads.find((entry) => entry.key === key);
    if (found === undefined) throw new Error(key);
    return found;
  };
  it.each([
    ["NODE_ENV", { kind: "literal", text: "= development" }],
    ["API_URL", { kind: "source", text: "Shared", target: { scopeId: "shared", key: "API_URL" } }],
    [
      "FEATURE_FLAGS",
      { kind: "source", text: "own", target: { scopeId: "svc-appdev", key: "FEATURE_FLAGS" } },
    ],
    [
      "DATABASE_URL",
      { kind: "source", text: "db", target: { scopeId: "svc-db", key: "connectionString" } },
    ],
    ["PUBLIC_HOST", { kind: "source", text: "platform", target: null }],
    ["SEARCH_URL", { kind: "bad", text: "missing", name: "NOPE" }],
    ["DB_PASSWORD", { kind: "bad", text: "self", name: "DB_PASSWORD" }],
  ] as const)("%s", (key, source) => {
    expect(readSource(VAULT_FIXTURE, APPDEV, read(key))).toEqual(source);
  });
});

describe("refusalWords", () => {
  it.each([
    ["projectEnvDuplicateKey", SHARED, "API_URL", "API_URL is already in Shared"],
    [
      "userDataDuplicateKey",
      APPDEV,
      "NODE_ENV",
      "appdev already has NODE_ENV in its values or zerops.yml",
    ],
    [
      "projectEnvKeyInvalid",
      SHARED,
      "bad-key!",
      "Letters, digits and _ only, not starting with a digit",
    ],
    [null, SHARED, "API_URL", "Zerops refused it"],
  ])("%s", (code, scope, key, words) => {
    expect(refusalWords(code, scope, key, null)).toBe(words);
  });

  it("shows the account's own sentence as given", () => {
    expect(
      refusalWords(
        "projectEnvDuplicateKey",
        SHARED,
        "LOG_LEVEL",
        "LOG_LEVEL is already in Shared.",
      ),
    ).toBe("LOG_LEVEL is already in Shared.");
  });
});
