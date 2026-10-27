/**
 * One project's vault as the panel's tests and its harness (`/design-vault.html`) draw it: the
 * prototype's world — Shared with plain and sensitive values, appdev with one of its own and a
 * deployed zerops.yml that reads Shared, db and one name nothing has, appstage reading less, and
 * db's values made by Zerops. Times are set against `VAULT_FIXTURE_NOW`. Fixtures only: nothing
 * here ships.
 */
import type {
  VaultImpact,
  VaultReader,
  VaultScope,
  VaultScopeRef,
  VaultValue,
  VaultView,
  VaultWrite,
} from "@t3tools/client-runtime/data";

export const VAULT_FIXTURE_NOW = Date.parse("2026-10-07T12:00:00Z");

const ago = (ms: number) => new Date(VAULT_FIXTURE_NOW - ms).toISOString();
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const SHARED: VaultScopeRef = { kind: "shared" };
const APPDEV: VaultScopeRef = { kind: "service", serviceId: "svc-appdev" };
const DB: VaultScopeRef = { kind: "service", serviceId: "svc-db" };

const reader = (
  host: "appdev" | "appstage",
  via: ReadonlyArray<string>,
  state: VaultReader["state"] = "live",
): VaultReader => ({ serviceId: `svc-${host}`, hostname: host, via, state });

const value = (
  id: string,
  key: string,
  options: {
    readonly value?: string;
    readonly sensitive?: boolean;
    readonly changed?: number;
    readonly readers?: ReadonlyArray<VaultReader>;
    readonly madeByZerops?: boolean;
  } = {},
): VaultValue => ({
  id,
  key,
  sensitive: options.sensitive ?? false,
  value: options.sensitive ? null : (options.value ?? ""),
  createdAt: ago(60 * DAY),
  changedAt: ago(options.changed ?? 21 * DAY),
  madeByZerops: options.madeByZerops ?? false,
  readers: options.readers ?? [],
});

export const VAULT_FIXTURE: VaultView = {
  status: "ready",
  complete: true,
  scopes: [
    {
      ref: SHARED,
      id: "shared",
      hostname: null,
      kind: "shared",
      serviceType: null,
      editable: true,
      values: [
        value("v-api", "API_URL", {
          value: "https://api.acme.dev",
          readers: [reader("appdev", ["API_URL"]), reader("appstage", ["API_URL"])],
        }),
        value("v-log", "LOG_LEVEL", {
          value: "debug",
          changed: 20 * MINUTE,
          readers: [reader("appdev", ["LOG_LEVEL"], "restart")],
        }),
        value("v-legacy", "LEGACY_TOKEN", {
          sensitive: true,
          changed: 150 * DAY,
          readers: [reader("appstage", ["LEGACY_TOKEN"])],
        }),
        value("v-session", "SESSION_SECRET", {
          sensitive: true,
          changed: 2 * DAY,
          readers: [reader("appdev", ["SESSION_SECRET"]), reader("appstage", ["SESSION_SECRET"])],
        }),
        value("v-stripe", "STRIPE_SECRET_KEY", { sensitive: true, changed: 0 }),
      ],
      reads: [],
      startedAt: null,
    },
    {
      ref: APPDEV,
      id: "svc-appdev",
      hostname: "appdev",
      kind: "runtime",
      serviceType: "nodejs@22",
      editable: true,
      values: [
        value("v-flags", "FEATURE_FLAGS", {
          value: "cart-vat,new-search",
          changed: 3 * DAY,
          readers: [reader("appdev", ["FEATURE_FLAGS"])],
        }),
      ],
      reads: [
        { key: "NODE_ENV", template: "development", refs: [] },
        {
          key: "API_URL",
          template: "${API_URL}",
          refs: [{ kind: "value", name: "API_URL", scope: SHARED, key: "API_URL" }],
        },
        {
          key: "LOG_LEVEL",
          template: "${LOG_LEVEL}",
          refs: [{ kind: "value", name: "LOG_LEVEL", scope: SHARED, key: "LOG_LEVEL" }],
        },
        {
          key: "SESSION_SECRET",
          template: "${SESSION_SECRET}",
          refs: [{ kind: "value", name: "SESSION_SECRET", scope: SHARED, key: "SESSION_SECRET" }],
        },
        {
          key: "FEATURE_FLAGS",
          template: "${FEATURE_FLAGS}",
          refs: [{ kind: "value", name: "FEATURE_FLAGS", scope: APPDEV, key: "FEATURE_FLAGS" }],
        },
        {
          key: "DATABASE_URL",
          template: "${db_connectionString}",
          refs: [
            { kind: "value", name: "db_connectionString", scope: DB, key: "connectionString" },
          ],
        },
        {
          key: "PUBLIC_HOST",
          template: "${zeropsSubdomain}",
          refs: [{ kind: "platform", name: "zeropsSubdomain" }],
        },
        { key: "SEARCH_URL", template: "${NOPE}", refs: [{ kind: "missing", name: "NOPE" }] },
        {
          key: "DB_PASSWORD",
          template: "${DB_PASSWORD}",
          refs: [{ kind: "self", name: "DB_PASSWORD" }],
        },
      ],
      startedAt: ago(DAY),
    },
    {
      ref: { kind: "service", serviceId: "svc-appstage" },
      id: "svc-appstage",
      hostname: "appstage",
      kind: "runtime",
      serviceType: "nodejs@22",
      editable: true,
      values: [],
      reads: [
        { key: "NODE_ENV", template: "production", refs: [] },
        {
          key: "API_URL",
          template: "${API_URL}",
          refs: [{ kind: "value", name: "API_URL", scope: SHARED, key: "API_URL" }],
        },
        {
          key: "LEGACY_TOKEN",
          template: "${LEGACY_TOKEN}",
          refs: [{ kind: "value", name: "LEGACY_TOKEN", scope: SHARED, key: "LEGACY_TOKEN" }],
        },
        {
          key: "SESSION_SECRET",
          template: "${SESSION_SECRET}",
          refs: [{ kind: "value", name: "SESSION_SECRET", scope: SHARED, key: "SESSION_SECRET" }],
        },
      ],
      startedAt: ago(DAY),
    },
    {
      ref: DB,
      id: "svc-db",
      hostname: "db",
      kind: "managed",
      serviceType: "postgresql@17",
      editable: false,
      values: [
        value("v-db-cs", "connectionString", {
          value: "postgresql://db:5432/db",
          madeByZerops: true,
          readers: [reader("appdev", ["DATABASE_URL"])],
        }),
        value("v-db-host", "hostname", { value: "db", madeByZerops: true }),
        value("v-db-port", "port", { value: "5432", madeByZerops: true }),
        value("v-db-user", "user", { value: "db", madeByZerops: true }),
        value("v-db-pass", "password", { sensitive: true, madeByZerops: true }),
      ],
      reads: [],
      startedAt: null,
    },
  ],
  notLive: [
    { kind: "restart", serviceId: "svc-appdev", hostname: "appdev", keys: ["LOG_LEVEL"] },
    { kind: "unread", scope: SHARED, key: "STRIPE_SECRET_KEY" },
    {
      kind: "missing",
      serviceId: "svc-appdev",
      hostname: "appdev",
      entry: "SEARCH_URL",
      name: "NOPE",
    },
    { kind: "self", serviceId: "svc-appdev", hostname: "appdev", entry: "DB_PASSWORD" },
  ],
};

export const vaultFixtureScope = (id: string): VaultScope => {
  const scope = VAULT_FIXTURE.scopes.find((candidate) => candidate.id === id);
  if (scope === undefined) throw new Error(`No fixture scope ${id}`);
  return scope;
};

const sameRef = (a: VaultScopeRef, b: VaultScopeRef) =>
  a.kind === "shared" ? b.kind === "shared" : b.kind === "service" && a.serviceId === b.serviceId;

/** The fixture's impact, as the data part's `vaultImpact` reads it off a view. */
export function vaultFixtureImpact(
  view: VaultView,
  scope: VaultScopeRef,
  write: VaultWrite,
): VaultImpact {
  const held = view.scopes
    .find((candidate) => sameRef(candidate.ref, scope))
    ?.values.find((candidate) =>
      write.kind === "add"
        ? candidate.key.toUpperCase() === write.key.toUpperCase()
        : candidate.id === write.id,
    );
  const readers = (held?.readers ?? []).map(({ serviceId, hostname }) => ({
    serviceId,
    hostname,
  }));
  return {
    restart: write.kind === "remove" ? [] : readers,
    unread: readers.length === 0,
    literal: write.kind === "remove" ? readers : [],
  };
}
