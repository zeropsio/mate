/**
 * The vault as a person reads it: every value in a group named for what it is for (Admin sign-in,
 * Stripe, Email, Addresses…), each under a label in words ("From name" for `SMTP_FROM_NAME`),
 * and what needs the person — values not set, secrets anyone can read — drawn on top.
 */
import type { VaultScope, VaultValue, VaultView } from "@t3tools/client-runtime/data";

const ACRONYMS = new Set([
  "AI",
  "API",
  "AWS",
  "CDN",
  "CORS",
  "CPU",
  "CSRF",
  "DB",
  "DNS",
  "DSN",
  "GCP",
  "HMAC",
  "HTTP",
  "HTTPS",
  "ID",
  "IP",
  "JWT",
  "OAUTH",
  "OIDC",
  "RAM",
  "S3",
  "SDK",
  "SMS",
  "SMTP",
  "SSL",
  "SSO",
  "TLS",
  "TTL",
  "UI",
  "URI",
  "URL",
]);

/** A key's words, upper-case: `SMTP_FROM_NAME` → SMTP, FROM, NAME; `apiKey` → API, KEY. */
export function keyWords(key: string): ReadonlyArray<string> {
  return key
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toUpperCase()
    .split(/[_\-.]+/u)
    .filter((word) => word !== "");
}

/** Words as a sentence-case label, acronyms kept: API, KEY → "API key". */
export function labelOf(words: ReadonlyArray<string>): string {
  return words
    .map((word, index) => {
      if (ACRONYMS.has(word)) return word;
      const lower = word.toLowerCase();
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

const PROVIDERS: Readonly<Record<string, string>> = {
  ADYEN: "Adyen",
  ALGOLIA: "Algolia",
  ANTHROPIC: "Anthropic",
  AUTH0: "Auth0",
  BRAINTREE: "Braintree",
  CLERK: "Clerk",
  CLOUDINARY: "Cloudinary",
  FIREBASE: "Firebase",
  GITHUB: "GitHub",
  GOOGLE: "Google",
  LEMONSQUEEZY: "Lemon Squeezy",
  MAILGUN: "Mailgun",
  MEILI: "Meilisearch",
  MEILISEARCH: "Meilisearch",
  MOLLIE: "Mollie",
  OPENAI: "OpenAI",
  PADDLE: "Paddle",
  PAYPAL: "PayPal",
  POSTHOG: "PostHog",
  POSTMARK: "Postmark",
  RESEND: "Resend",
  SENDGRID: "SendGrid",
  SENTRY: "Sentry",
  SHOPIFY: "Shopify",
  SLACK: "Slack",
  STRIPE: "Stripe",
  SUPABASE: "Supabase",
  TWILIO: "Twilio",
  TYPESENSE: "Typesense",
};
const ADMIN = new Set(["ADMIN", "SUPERADMIN"]);
const EMAIL = new Set(["SMTP", "MAIL", "MAILER", "EMAIL", "IMAP"]);
const STORAGE = new Set(["S3", "STORAGE", "BUCKET", "R2", "MINIO", "AWS"]);
const DATA = new Set([
  "DB",
  "DATABASE",
  "POSTGRES",
  "POSTGRESQL",
  "PG",
  "MYSQL",
  "MARIADB",
  "MONGO",
  "MONGODB",
  "REDIS",
  "VALKEY",
  "KEYDB",
  "ELASTICSEARCH",
  "NATS",
  "RABBITMQ",
  "KAFKA",
]);
const ADDRESS_ENDS = new Set([
  "URL",
  "URI",
  "HOST",
  "HOSTNAME",
  "DOMAIN",
  "ORIGIN",
  "ENDPOINT",
  "PORT",
  "ADDRESS",
]);
const SECURITY = new Set(["SECRET", "JWT", "COOKIE", "SESSION", "SALT", "ENCRYPTION", "SIGNING"]);

export interface VaultGroupRef {
  readonly id: string;
  readonly title: string;
  /** Where the group sits: what a person looks for first comes first, machines' keys last. */
  readonly order: number;
}

const GROUP = {
  admin: { id: "admin", title: "Admin sign-in", order: 0 },
  email: { id: "email", title: "Email", order: 2 },
  storage: { id: "storage", title: "File storage", order: 3 },
  addresses: { id: "addresses", title: "Addresses", order: 4 },
  data: { id: "data", title: "Databases", order: 5 },
  other: { id: "other", title: "Other settings", order: 7 },
  security: { id: "security", title: "Security keys", order: 8 },
} as const satisfies Record<string, VaultGroupRef>;

interface Placement {
  readonly group: VaultGroupRef | null;
  readonly label: string;
}

/** Where a key goes by its words alone, and its label there (the group's own word dropped). */
function place(key: string): Placement {
  const words = keyWords(key);
  const first = words[0] ?? "";
  const rest = words.slice(1);
  const label = (parts: ReadonlyArray<string>) => labelOf(parts.length === 0 ? words : parts);
  if (ADMIN.has(first)) return { group: GROUP.admin, label: label(rest) };
  if (words.some((word) => ADMIN.has(word))) return { group: GROUP.admin, label: label(words) };
  const provider = PROVIDERS[first];
  if (provider !== undefined) {
    return { group: { id: `provider:${first}`, title: provider, order: 1 }, label: label(rest) };
  }
  if (EMAIL.has(first)) return { group: GROUP.email, label: label(rest) };
  if (STORAGE.has(first)) {
    return { group: GROUP.storage, label: label(first === "AWS" ? words : rest) };
  }
  if (DATA.has(first)) return { group: GROUP.data, label: label(words) };
  if (ADDRESS_ENDS.has(words.at(-1) ?? "")) return { group: GROUP.addresses, label: label(words) };
  if (words.some((word) => SECURITY.has(word)) || words.join("_") === "APP_KEY") {
    return { group: GROUP.security, label: label(words) };
  }
  return { group: null, label: label(words) };
}

// ── secrets ─────────────────────────────────────────────────────────────────

const SECRET_WORDS = new Set([
  "SECRET",
  "TOKEN",
  "PASSWORD",
  "PASS",
  "KEY",
  "DSN",
  "PRIVATE",
  "CREDENTIAL",
]);
const SECRET_ENDS = ["SECRET", "TOKEN", "PASSWORD", "KEY", "CREDENTIALS"];
const PUBLIC_WORDS = new Set(["PUBLIC", "PUBLISHABLE"]);
const PRIVATE_WORDS = new Set(["SECRET", "PASSWORD", "PRIVATE"]);

/**
 * A name that says secret: a word of it (or a word's end, APIKEY) is a secret's. A name public by
 * design — PUBLIC or PUBLISHABLE, and nothing private beside it — is not: a browser ships it.
 */
export function looksSecret(key: string): boolean {
  const words = keyWords(key);
  if (words.some((word) => PUBLIC_WORDS.has(word)) && !words.some((w) => PRIVATE_WORDS.has(w))) {
    return false;
  }
  return words.some(
    (word) => SECRET_WORDS.has(word) || SECRET_ENDS.some((end) => word.endsWith(end)),
  );
}

/** A password a person signs in with: it stays readable to them, hidden on screen. */
export function isSignInPassword(key: string): boolean {
  const words = keyWords(key);
  return (
    words.some((word) => ADMIN.has(word)) &&
    words.some((word) => word === "PASSWORD" || word === "PASS")
  );
}

/** How a closed row shows a value. */
export type VaultShow =
  /** Written secret: nobody reads it back. */
  | { readonly kind: "secret" }
  /** Readable, but its name says secret: dots until the row opens. */
  | { readonly kind: "masked"; readonly value: string }
  | { readonly kind: "unset" }
  | {
      readonly kind: "text";
      /** The value, each `${name}` in it a part of its own. */
      readonly parts: ReadonlyArray<{ readonly ref: boolean; readonly text: string }>;
    };

export function showOf(value: VaultValue): VaultShow {
  if (value.sensitive) return { kind: "secret" };
  const text = value.value ?? "";
  if (text === "") return { kind: "unset" };
  if (looksSecret(value.key)) return { kind: "masked", value: text };
  const parts: Array<{ readonly ref: boolean; readonly text: string }> = [];
  let at = 0;
  for (const match of text.matchAll(/\$\{([^}]+)\}/gu)) {
    if (match.index > at) parts.push({ ref: false, text: text.slice(at, match.index) });
    parts.push({ ref: true, text: match[1] ?? "" });
    at = match.index + match[0].length;
  }
  if (at < text.length) parts.push({ ref: false, text: text.slice(at) });
  return { kind: "text", parts };
}

// ── the list ────────────────────────────────────────────────────────────────

export interface VaultEntry {
  readonly scope: VaultScope;
  readonly value: VaultValue;
  readonly label: string;
  /** The one app that has it, when it is that app's own and the list shows every app. */
  readonly only: string | null;
  readonly group: VaultGroupRef;
}

export interface VaultGroup extends VaultGroupRef {
  readonly entries: ReadonlyArray<VaultEntry>;
}

/** Which values the list shows: every app's (the environment's and each app's own), or one app's own. */
export type VaultFilter = { readonly kind: "all" } | { readonly kind: "app"; readonly id: string };

const entryMatches = (entry: VaultEntry, query: string) => {
  if (query === "") return true;
  const needle = query.toLowerCase();
  return [
    entry.value.key,
    entry.label,
    entry.group.title,
    entry.only ?? "",
    entry.value.value ?? "",
  ].some((text) => text.toLowerCase().includes(needle));
};

/** Every value the filter shows, in its group: the groups in order, a group's values by label. */
export function vaultGroups(
  view: VaultView,
  filter: VaultFilter,
  query: string,
): ReadonlyArray<VaultGroup> {
  const scopes = view.scopes.filter((scope) =>
    filter.kind === "all" ? scope.kind !== "managed" : scope.id === filter.id,
  );
  const placed = scopes.flatMap((scope) =>
    scope.values.map((value) => ({ scope, value, ...place(value.key) })),
  );
  // A name no rule knows joins others that start the same way, else Other settings.
  const firsts = new Map<string, number>();
  for (const item of placed) {
    if (item.group !== null || item.scope.hostname !== null) continue;
    const first = keyWords(item.value.key)[0] ?? "";
    firsts.set(first, (firsts.get(first) ?? 0) + 1);
  }
  const entries = placed.map((item): VaultEntry => {
    const only = filter.kind === "all" && item.scope.hostname !== null ? item.scope.hostname : null;
    if (item.group !== null) return { ...item, group: item.group, only };
    // An app's own value no rule knows sits under the app's name, not under a prefix.
    if (item.scope.hostname !== null) {
      return {
        ...item,
        group: { id: `app:${item.scope.id}`, title: item.scope.hostname, order: 6 },
        only: null,
      };
    }
    const words = keyWords(item.value.key);
    const first = words[0] ?? "";
    if ((firsts.get(first) ?? 0) >= 2 && words.length > 1) {
      return {
        ...item,
        group: { id: `prefix:${first}`, title: labelOf([first]), order: 6 },
        label: labelOf(words.slice(1)),
        only,
      };
    }
    return { ...item, group: GROUP.other, only };
  });
  const groups = new Map<string, { ref: VaultGroupRef; entries: VaultEntry[] }>();
  for (const entry of entries) {
    if (!entryMatches(entry, query)) continue;
    const held = groups.get(entry.group.id);
    if (held === undefined) groups.set(entry.group.id, { ref: entry.group, entries: [entry] });
    else held.entries.push(entry);
  }
  return [...groups.values()]
    .map(({ ref, entries: list }) => ({
      ...ref,
      entries: list.toSorted(
        (a, b) => a.label.localeCompare(b.label) || (a.only ?? "").localeCompare(b.only ?? ""),
      ),
    }))
    .toSorted((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

// ── what needs the person ───────────────────────────────────────────────────

export interface VaultNeeds {
  /** Values that are empty: an app reads nothing there. */
  readonly unset: ReadonlyArray<VaultEntry>;
  /** Values whose name says secret, written readable: anyone with access reads them. */
  readonly readable: ReadonlyArray<VaultEntry>;
}

export function vaultNeeds(groups: ReadonlyArray<VaultGroup>): VaultNeeds {
  const entries = groups.flatMap((group) => group.entries).filter((e) => e.scope.editable);
  return {
    unset: entries.filter((entry) => showOf(entry.value).kind === "unset"),
    readable: entries.filter(
      (entry) => showOf(entry.value).kind === "masked" && !isSignInPassword(entry.value.key),
    ),
  };
}

/** The unset card's title: the one group they share ("Stripe isn't set up yet"), else a count. */
export function unsetTitle(unset: ReadonlyArray<VaultEntry>): string {
  const groups = new Set(unset.map((entry) => entry.group.id));
  const only = unset[0]?.group;
  if (groups.size === 1 && only !== undefined && only.id !== "other") {
    return `${only.title} isn't set up yet`;
  }
  return unset.length === 1 ? "1 value isn't set yet" : `${unset.length} values aren't set yet`;
}

/**
 * Who gets a value, in words. Zerops hands a value of the whole environment to every app, and an
 * app's own to that app, whatever their zerops.yml names (measured 2026-10-07).
 */
export function usedByWords(scope: VaultScope): string {
  return scope.hostname === null ? "Every app gets it." : `Only ${scope.hostname} gets it.`;
}

/**
 * The apps still running a value's previous version: every app of the environment (or the one
 * app that owns it) whose containers last started before the value last changed. An app whose
 * start is not known is left out.
 */
export function staleApps(
  view: VaultView,
  scope: VaultScope,
  value: VaultValue,
): ReadonlyArray<VaultScope> {
  const changed = Date.parse(value.changedAt ?? value.createdAt ?? "");
  if (Number.isNaN(changed)) return [];
  const apps = scope.kind === "shared" ? view.scopes.filter((s) => s.kind === "runtime") : [scope];
  return apps.filter((app) => app.startedAt !== null && Date.parse(app.startedAt) < changed);
}
