/**
 * A store-sized environment for the harness (`/design-vault.html?data=store`): a Medusa backend
 * and a Next.js storefront in dev and stage, a mail catcher and a database — fifteen values for
 * every app (Stripe's three not set, two signing keys written readable, an admin sign-in, email
 * settings, addresses over the environment's subdomain), three of the apps' own. Every value is
 * made up. Fixtures only: nothing here ships.
 */
import type {
  VaultReader,
  VaultScopeRef,
  VaultValue,
  VaultView,
} from "@t3tools/client-runtime/data";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const DAY = 24 * 60 * 60_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const SHARED: VaultScopeRef = { kind: "shared" };
const service = (host: string): VaultScopeRef => ({ kind: "service", serviceId: `svc-${host}` });

type Host = "medusadev" | "medusastage" | "nextstoredev" | "nextstorestage" | "mailpit";
const reader = (host: Host, state: VaultReader["state"] = "live"): VaultReader => ({
  serviceId: `svc-${host}`,
  hostname: host,
  via: [],
  state,
});

const value = (
  key: string,
  options: {
    readonly value?: string;
    readonly sensitive?: boolean;
    readonly readers?: ReadonlyArray<VaultReader>;
    readonly madeByZerops?: boolean;
  } = {},
): VaultValue => ({
  id: `v-${key}`,
  key,
  sensitive: options.sensitive ?? false,
  value: options.sensitive ? null : (options.value ?? ""),
  createdAt: ago(2 * DAY),
  changedAt: ago(2 * DAY),
  madeByZerops: options.madeByZerops ?? false,
  readers: options.readers ?? [],
});

const backends = [reader("medusadev"), reader("medusastage")];
const stores = [reader("nextstoredev"), reader("nextstorestage")];

const runtime = (host: Host, type: string, values: ReadonlyArray<VaultValue> = []) => ({
  ref: service(host),
  id: `svc-${host}`,
  hostname: host,
  kind: "runtime" as const,
  serviceType: type,
  editable: true,
  values,
  reads: [],
  startedAt: ago(DAY),
});

export const VAULT_STORE_FIXTURE: VaultView = {
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
        value("API_URL", {
          value: "https://medusastage-${zeropsSubdomainHost}-9000.prg1.zerops.app",
          readers: [reader("medusastage"), reader("nextstorestage")],
        }),
        value("APP_URL", {
          value: "https://nextstorestage-${zeropsSubdomainHost}-8000.prg1.zerops.app",
          readers: [reader("medusastage"), reader("nextstorestage")],
        }),
        value("COOKIE_SECRET", { value: "made-up-cookie-signing-value-0000", readers: backends }),
        value("JWT_SECRET", { value: "made-up-jwt-signing-value-00000000", readers: backends }),
        value("MEDUSA_INTERNAL_URL", {
          value: "http://medusastage:9000",
          readers: [reader("nextstorestage")],
        }),
        value("SMTP_FROM", { value: "shop@example.com", readers: backends }),
        value("SMTP_FROM_NAME", { value: "Example Shop", readers: backends }),
        value("SMTP_HOST", { value: "mailpit", readers: backends }),
        value("SMTP_PORT", { value: "1025", readers: backends }),
        value("SMTP_SECURE", { value: "false", readers: backends }),
        value("STRIPE_API_KEY", { readers: backends }),
        value("STRIPE_PUBLISHABLE_KEY", { readers: [reader("nextstoredev"), ...stores.slice(1)] }),
        value("STRIPE_WEBHOOK_SECRET", { readers: backends }),
        value("SUPERADMIN_EMAIL", { value: "admin@example.com", readers: backends }),
        value("SUPERADMIN_PASSWORD", { value: "made-up-admin-pass", readers: backends }),
      ],
      reads: [],
      startedAt: null,
    },
    runtime("mailpit", "go@1", [
      value("MP_SMTP_AUTH_ACCEPT_ANY", { value: "1", readers: [reader("mailpit")] }),
      value("MP_UI_BIND_ADDR", { value: "0.0.0.0:8025", readers: [reader("mailpit")] }),
    ]),
    runtime("medusadev", "nodejs@22"),
    runtime("medusastage", "nodejs@22"),
    runtime("nextstoredev", "nodejs@22", [
      value("NEXT_PUBLIC_DEFAULT_REGION", { value: "us", readers: [reader("nextstoredev")] }),
    ]),
    runtime("nextstorestage", "nodejs@22"),
    {
      ref: service("db"),
      id: "svc-db",
      hostname: "db",
      kind: "managed",
      serviceType: "postgresql@17",
      editable: false,
      values: [
        value("connectionString", { value: "postgresql://db:5432/db", madeByZerops: true }),
        value("hostname", { value: "db", madeByZerops: true }),
        value("port", { value: "5432", madeByZerops: true }),
        value("user", { value: "db", madeByZerops: true }),
        value("password", { sensitive: true, madeByZerops: true }),
        value("dbName", { value: "db", madeByZerops: true }),
      ],
      reads: [],
      startedAt: null,
    },
  ],
  notLive: [],
};
