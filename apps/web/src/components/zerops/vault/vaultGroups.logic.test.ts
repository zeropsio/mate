import type { VaultScope, VaultValue, VaultView } from "@t3tools/client-runtime/data";
import { describe, expect, it } from "vite-plus/test";

import { VAULT_FIXTURE } from "./vaultFixture";
import {
  deployConfigPath,
  isSignInPassword,
  keyWords,
  labelOf,
  looksSecret,
  serviceWords,
  setupLine,
  showOf,
  unsetTitle,
  usedByWords,
  vaultGroups,
  vaultNeeds,
} from "./vaultGroups.logic";

const value = (key: string, over: Partial<VaultValue> = {}): VaultValue => ({
  id: `v-${key}`,
  key,
  sensitive: false,
  value: "x",
  createdAt: null,
  changedAt: null,
  madeByZerops: false,
  readers: [],
  ...over,
});

const SHARED: VaultScope = {
  ref: { kind: "shared" },
  id: "shared",
  hostname: null,
  kind: "shared",
  serviceType: null,
  editable: true,
  values: [],
  reads: [],
  startedAt: null,
};

const viewOf = (
  shared: ReadonlyArray<VaultValue>,
  own: ReadonlyArray<VaultValue> = [],
): VaultView => ({
  status: "ready",
  complete: true,
  notLive: [],
  scopes: [
    { ...SHARED, values: shared },
    {
      ...SHARED,
      ref: { kind: "service", serviceId: "svc-mailpit" },
      id: "svc-mailpit",
      hostname: "mailpit",
      kind: "runtime",
      serviceType: "alpine@3.20",
      values: own,
    },
  ],
});

/** Each group as "title: label, label". */
const groupsOf = (view: VaultView, filter: Parameters<typeof vaultGroups>[1], query = "") =>
  vaultGroups(view, filter, query).map(
    (group) => `${group.title}: ${group.entries.map((entry) => entry.label).join(", ")}`,
  );

describe("labels", () => {
  it.each([
    ["SMTP_FROM_NAME", ["SMTP", "FROM", "NAME"]],
    ["apiKey", ["API", "KEY"]],
    ["next.public-url", ["NEXT", "PUBLIC", "URL"]],
  ])("splits %s into its words", (key, words) => {
    expect(keyWords(key)).toEqual(words);
  });

  it.each([
    [["API", "KEY"], "API key"],
    [["MEDUSA", "INTERNAL", "URL"], "Medusa internal URL"],
    [["JWT", "SECRET"], "JWT secret"],
  ])("writes %j as %s", (words, label) => {
    expect(labelOf(words)).toBe(label);
  });
});

describe("groups", () => {
  it("names each group for what its values are for, a group's own word dropped from the label", () => {
    const view = viewOf([
      value("SUPERADMIN_EMAIL"),
      value("SUPERADMIN_PASSWORD"),
      value("STRIPE_API_KEY"),
      value("SMTP_FROM_NAME"),
      value("SMTP_HOST"),
      value("S3_BUCKET"),
      value("API_URL"),
      value("DATABASE_URL"),
      value("ALGOLIA_APP_ID"),
      value("ALGOLIA_INDEX"),
      value("JWT_SECRET"),
      value("NODE_ENV"),
    ]);
    expect(groupsOf(view, { kind: "all" })).toEqual([
      "Admin sign-in: Email, Password",
      "Algolia: App ID, Index",
      "Stripe: API key",
      "Email: From name, Host",
      "File storage: Bucket",
      "Addresses: API URL",
      "Databases: Database URL",
      "Other settings: Node env",
      "Security keys: JWT secret",
    ]);
  });

  it("gathers names no rule knows under the first word they share, else under Other settings", () => {
    const view = viewOf([value("FEATURE_A"), value("FEATURE_B"), value("LOG_LEVEL")]);
    expect(groupsOf(view, { kind: "all" })).toEqual(["Feature: A, B", "Other settings: Log level"]);
  });

  it("lists the environment's values on the main page and an app's own on its page", () => {
    const view = viewOf([value("API_URL")], [value("MP_UI_BIND_ADDR")]);
    expect(groupsOf(view, { kind: "all" })).toEqual(["Addresses: API URL"]);
    expect(groupsOf(view, { kind: "app", id: "svc-mailpit" })).toEqual([
      "Addresses: Mp UI bind addr",
    ]);
  });

  it("searches every app, an app's own value marked with its app and grouped under it when no rule knows it", () => {
    const view = viewOf(
      [value("API_URL", { value: "https://shop" })],
      [value("MP_FLAG", { value: "shop-mode" })],
    );
    const found = vaultGroups(view, { kind: "everything" }, "shop");
    expect(found.map((group) => group.title)).toEqual(["Addresses", "mailpit"]);
    expect(found[1]?.entries[0]?.only).toBeNull();
    expect(vaultGroups(view, { kind: "everything" }, "api")[0]?.entries[0]?.only).toBeNull();
  });
});

describe("secrets", () => {
  it.each([
    ["JWT_SECRET", true],
    ["STRIPE_API_KEY", true],
    ["OPENAI_APIKEY", true],
    ["SMTP_PASS", true],
    ["STRIPE_PUBLISHABLE_KEY", false],
    ["NEXT_PUBLIC_STRIPE_KEY", false],
    ["PUBLIC_SECRET_KEY", true],
    ["API_URL", false],
  ])("reads %s as secret: %s", (key, secret) => {
    expect(looksSecret(key)).toBe(secret);
  });

  it.each([
    ["SUPERADMIN_PASSWORD", true],
    ["ADMIN_PASS", true],
    ["DB_PASSWORD", false],
    ["ADMIN_EMAIL", false],
  ])("reads %s as a password a person signs in with: %s", (key, signIn) => {
    expect(isSignInPassword(key)).toBe(signIn);
  });

  it("shows a written secret and a readable one as dots, a value not set as such, and references apart", () => {
    expect(showOf(value("TOKEN", { sensitive: true, value: null })).kind).toBe("secret");
    expect(showOf(value("JWT_SECRET", { value: "abc" }))).toEqual({ kind: "masked", value: "abc" });
    expect(showOf(value("STRIPE_API_KEY", { value: "" })).kind).toBe("unset");
    expect(showOf(value("API_URL", { value: "https://${zeropsSubdomainHost}/v1" }))).toEqual({
      kind: "text",
      parts: [
        { ref: false, text: "https://" },
        { ref: true, text: "zeropsSubdomainHost" },
        { ref: false, text: "/v1" },
      ],
    });
  });
});

describe("what needs the person", () => {
  it("asks for the values not set, and offers to protect the readable secrets but a sign-in password", () => {
    const view = viewOf([
      value("STRIPE_API_KEY", { value: "" }),
      value("STRIPE_WEBHOOK_SECRET", { value: "" }),
      value("COOKIE_SECRET", { value: "c" }),
      value("SUPERADMIN_PASSWORD", { value: "p" }),
    ]);
    const needs = vaultNeeds(vaultGroups(view, { kind: "everything" }, ""));
    expect(needs.unset.map((entry) => entry.value.key)).toEqual([
      "STRIPE_API_KEY",
      "STRIPE_WEBHOOK_SECRET",
    ]);
    expect(needs.readable.map((entry) => entry.value.key)).toEqual(["COOKIE_SECRET"]);
    expect(unsetTitle(needs.unset)).toBe("Stripe isn't set up yet");
  });

  it("counts values not set across groups", () => {
    const view = viewOf([
      value("STRIPE_API_KEY", { value: "" }),
      value("SMTP_HOST", { value: "" }),
    ]);
    const needs = vaultNeeds(vaultGroups(view, { kind: "everything" }, ""));
    expect(unsetTitle(needs.unset)).toBe("2 values aren't set yet");
  });
});

describe("who uses a value", () => {
  it("names the apps whose deploy config uses it, or says none does", () => {
    const api = VAULT_FIXTURE.scopes[0]!.values.find((candidate) => candidate.key === "API_URL")!;
    expect(usedByWords(api)).toBe("Used by appdev and appstage.");
    expect(usedByWords(value("UNUSED"))).toBe(
      "No app uses it yet: an app's deploy config has to name it.",
    );
  });
});

describe("the deploy config", () => {
  const paths = ["medusadev/zerops.yaml", "nextstoredev/zerops.yml", "medusadev/src/index.ts"];

  it.each([
    ["medusadev", "medusadev/zerops.yaml"],
    ["medusastage", "medusadev/zerops.yaml"],
    ["nextstorestage", "nextstoredev/zerops.yml"],
    ["mailpit", null],
  ])("finds %s's in %s", (hostname, path) => {
    expect(deployConfigPath(hostname, paths)).toBe(path);
  });

  it("falls back to the one config at the workspace root", () => {
    expect(deployConfigPath("app", ["zerops.yaml", "src/a.ts"])).toBe("zerops.yaml");
  });

  it("opens at the app's setup, else at the one its role builds with", () => {
    const content = "zerops:\n  - setup: dev\n    run: {}\n  - setup: prod\n    run: {}\n";
    expect(setupLine(content, "medusadev")).toBe(2);
    expect(setupLine(content, "medusastage")).toBe(4);
    expect(setupLine("zerops:\n  - setup: api\n", "api")).toBe(2);
    expect(setupLine(content, "worker")).toBeNull();
  });
});

describe("services in words", () => {
  it.each([
    [{ kind: "runtime", serviceType: "nodejs@22" }, "app", "Node.js app"],
    [{ kind: "runtime", serviceType: "alpine@3.20" }, "app", "Container"],
    [{ kind: "managed", serviceType: "postgresql@17" }, "database", "Database · PostgreSQL"],
    [{ kind: "managed", serviceType: "valkey@7.2:single" }, "cache", "Cache · Valkey"],
    [{ kind: "managed", serviceType: "object-storage" }, "storage", "File storage"],
  ] as const)("says what %j is", (over, kind, words) => {
    expect(serviceWords({ ...SHARED, ...over })).toEqual({ kind, words });
  });
});
