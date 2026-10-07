import { describe, expect, it } from "vite-plus/test";

import { vaultChangesSince, vaultImpact, vaultNote } from "./vaultChanges.ts";
import type {
  VaultChange,
  VaultImpact,
  VaultReader,
  VaultScope,
  VaultValue,
  VaultView,
} from "./vaultModel.ts";

const T = (hour: number) => `2026-10-07T${String(hour).padStart(2, "0")}:00:00Z`;

const reader = (
  serviceId: string,
  hostname: string,
  state: VaultReader["state"] = "live",
): VaultReader => ({ serviceId, hostname, via: ["X"], state });

const value = (patch: Partial<VaultValue> & Pick<VaultValue, "id" | "key">): VaultValue => ({
  sensitive: false,
  value: "v",
  createdAt: T(8),
  changedAt: T(8),
  madeByZerops: false,
  readers: [],
  ...patch,
});

const SHARED = { kind: "shared" } as const;
const APP = { kind: "service", serviceId: "s-app" } as const;
const STAGE = { kind: "service", serviceId: "s-stage" } as const;

const scope = (patch: Partial<VaultScope> & Pick<VaultScope, "ref" | "id">): VaultScope => ({
  hostname: null,
  kind: "shared",
  serviceType: null,
  editable: true,
  values: [],
  reads: [],
  startedAt: null,
  ...patch,
});

const VIEW: VaultView = {
  status: "ready",
  notLive: [],
  scopes: [
    scope({
      ref: SHARED,
      id: "shared",
      values: [
        value({
          id: "e-log",
          key: "LOG_LEVEL",
          changedAt: T(11),
          readers: [reader("s-app", "appdev", "restart"), reader("s-stage", "appstage", "live")],
        }),
        value({ id: "e-token", key: "TOKEN", readers: [reader("s-app", "appdev")] }),
        value({
          id: "e-stripe",
          key: "STRIPE_KEY",
          sensitive: true,
          value: null,
          createdAt: T(11),
          changedAt: T(11),
        }),
      ],
    }),
    scope({
      ref: APP,
      id: "s-app",
      hostname: "appdev",
      kind: "runtime",
      values: [
        value({ id: "u-token", key: "TOKEN", readers: [reader("s-app", "appdev")] }),
        value({
          id: "u-old",
          key: "OLD_TOKEN",
          sensitive: true,
          value: null,
          readers: [reader("s-stage", "appstage")],
        }),
      ],
      reads: [
        {
          key: "PAYMENTS",
          template: "${PAYMENTS_KEY}",
          refs: [{ kind: "missing", name: "PAYMENTS_KEY" }],
        },
        {
          key: "LOG",
          template: "${LOG_LEVEL}",
          refs: [{ kind: "value", name: "LOG_LEVEL", scope: SHARED, key: "LOG_LEVEL" }],
        },
      ],
    }),
    scope({
      ref: STAGE,
      id: "s-stage",
      hostname: "appstage",
      kind: "runtime",
      reads: [
        {
          key: "PAY",
          template: "${PAYMENTS_KEY}",
          refs: [{ kind: "missing", name: "PAYMENTS_KEY" }],
        },
        {
          key: "APP_FLAG",
          template: "${appdev_FLAG}",
          refs: [{ kind: "missing", name: "appdev_FLAG" }],
        },
      ],
    }),
  ],
};

const NONE: VaultImpact = { restart: [], unread: true, literal: [] };
const appdev = { serviceId: "s-app", hostname: "appdev" };
const appstage = { serviceId: "s-stage", hostname: "appstage" };

describe("vaultImpact", () => {
  it.each<{
    readonly name: string;
    readonly scope: VaultChange["scope"];
    readonly write: Parameters<typeof vaultImpact>[2];
    readonly impact: VaultImpact;
  }>([
    {
      name: "a new value nothing names yet is unread",
      scope: SHARED,
      write: { kind: "add", key: "NEW", value: "x", sensitive: false },
      impact: NONE,
    },
    {
      name: "a new Shared value that run entries name waits for their restart",
      scope: SHARED,
      write: { kind: "add", key: "PAYMENTS_KEY", value: "x", sensitive: true },
      impact: { restart: [appdev, appstage], unread: false, literal: [] },
    },
    {
      name: "a new service value reaches its own entries and ${host_KEY} elsewhere",
      scope: APP,
      write: { kind: "add", key: "FLAG", value: "1", sensitive: false },
      impact: { restart: [appstage], unread: false, literal: [] },
    },
    {
      name: "a service value shadowing the Shared one its entries read",
      scope: APP,
      write: { kind: "add", key: "LOG_LEVEL", value: "debug", sensitive: false },
      impact: { restart: [appdev], unread: false, literal: [] },
    },
    {
      name: "an update waits for every reader's restart",
      scope: SHARED,
      write: { kind: "update", id: "e-log", key: "LOG_LEVEL", value: "warn", sensitive: false },
      impact: { restart: [appdev, appstage], unread: false, literal: [] },
    },
    {
      name: "an update of what nothing reads is unread",
      scope: SHARED,
      write: { kind: "update", id: "e-stripe", key: "STRIPE_KEY", value: "x", sensitive: true },
      impact: NONE,
    },
    {
      name: "a removal leaves its readers the literal text",
      scope: APP,
      write: { kind: "remove", id: "u-old", key: "OLD_TOKEN" },
      impact: { restart: [], unread: false, literal: [appstage] },
    },
    {
      name: "a service value's removal falls back to Shared's after a restart",
      scope: APP,
      write: { kind: "remove", id: "u-token", key: "TOKEN" },
      impact: { restart: [appdev], unread: false, literal: [] },
    },
  ])("$name", ({ scope: target, write, impact }) => {
    expect(vaultImpact(VIEW, target, write)).toEqual(impact);
  });
});

describe("vaultChangesSince", () => {
  const removed = {
    scope: APP,
    key: "GONE",
    sensitive: true,
    at: T(12),
    impact: { restart: [], unread: false, literal: [appstage] },
  };

  it("lists what was added, changed and removed since, oldest first, never a value", () => {
    expect(vaultChangesSince(VIEW, T(10), [removed])).toEqual([
      {
        scope: SHARED,
        hostname: null,
        key: "LOG_LEVEL",
        kind: "changed",
        sensitive: false,
        at: T(11),
        impact: { restart: [appdev], unread: false, literal: [] },
      },
      {
        scope: SHARED,
        hostname: null,
        key: "STRIPE_KEY",
        kind: "added",
        sensitive: true,
        at: T(11),
        impact: NONE,
      },
      { ...removed, hostname: "appdev", kind: "removed" },
    ]);
  });

  it("lists nothing from before the moment", () => {
    expect(vaultChangesSince(VIEW, T(11), [{ ...removed, at: T(9) }])).toEqual([]);
  });
});

describe("vaultNote", () => {
  it("is nothing without changes", () => {
    expect(vaultNote([])).toBeNull();
  });

  it("names each change's key, scope, kind and impact — never a value", () => {
    const changes: ReadonlyArray<VaultChange> = [
      {
        scope: SHARED,
        hostname: null,
        key: "STRIPE_SECRET_KEY",
        kind: "added",
        sensitive: true,
        at: T(11),
        impact: NONE,
      },
      {
        scope: SHARED,
        hostname: null,
        key: "LOG_LEVEL",
        kind: "changed",
        sensitive: false,
        at: T(11),
        impact: { restart: [appdev], unread: false, literal: [] },
      },
      {
        scope: APP,
        hostname: "appdev",
        key: "OLD_TOKEN",
        kind: "removed",
        sensitive: true,
        at: T(12),
        impact: { restart: [], unread: false, literal: [appstage] },
      },
      {
        scope: SHARED,
        hostname: null,
        key: "API_URL",
        kind: "changed",
        sensitive: false,
        at: T(12),
        impact: { restart: [appdev, appstage], unread: false, literal: [] },
      },
      {
        scope: APP,
        hostname: "appdev",
        key: "TOKEN",
        kind: "removed",
        sensitive: false,
        at: T(12),
        impact: { restart: [appdev], unread: false, literal: [] },
      },
      {
        scope: STAGE,
        hostname: "appstage",
        key: "UNUSED",
        kind: "removed",
        sensitive: false,
        at: T(12),
        impact: NONE,
      },
    ];
    expect(vaultNote(changes)).toBe(
      [
        "Vault changes since your last turn (values are never shown to you):",
        "+ STRIPE_SECRET_KEY  Shared · sensitive · nothing reads it yet — reference it in zerops.yml where the app needs it, then deploy",
        "~ LOG_LEVEL  Shared · plain · appdev reads it at run — restart appdev",
        "− OLD_TOKEN  appdev · sensitive · appstage reads it — it now gets the literal text ${OLD_TOKEN}; stop using it",
        "~ API_URL  Shared · plain · appdev, appstage read it at run — restart appdev, appstage",
        "− TOKEN  appdev · plain · appdev reads it — it runs Shared's TOKEN after a restart; restart appdev",
        "− UNUSED  appstage · plain · nothing read it",
      ].join("\n"),
    );
  });
});
