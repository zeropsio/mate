/**
 * The vault panel's words and decisions, from the `vault` projection's view: what a scope is
 * called, which name a value is used as, what a row's second line says, what is not live and how
 * it becomes live, what a write would mean for the services that read it, and what the person may
 * type as a key. Pure: the panel draws what these answer.
 */
import type {
  VaultImpact,
  VaultNotLive,
  VaultReader,
  VaultScope,
  VaultScopeRef,
  VaultValue,
  VaultView,
  VaultWrite,
} from "@t3tools/client-runtime/data";

/** A run of words, some of them a name: a hostname is strong, a key is code. */
export interface VaultWordPart {
  readonly kind: "text" | "strong" | "code";
  readonly text: string;
}

const t = (text: string): VaultWordPart => ({ kind: "text", text });
const strong = (text: string): VaultWordPart => ({ kind: "strong", text });
const code = (text: string): VaultWordPart => ({ kind: "code", text });

/** "app", "app and api", "app, api and web". */
export function joinNames(names: ReadonlyArray<string>): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

const ref = (name: string) => `\${${name}}`;

export const SHARED_NAME = "Every app";

/** Every app, or the service's hostname. */
export function scopeName(scope: Pick<VaultScope, "hostname">): string {
  return scope.hostname ?? SHARED_NAME;
}

/** One row of one scope, for what is in flight or refused there: the scope's id and the key. */
export function vaultRowKey(scopeId: string, key: string): string {
  return `${scopeId}:${key}`;
}

export function sameScopeRef(a: VaultScopeRef, b: VaultScopeRef): boolean {
  return a.kind === "shared"
    ? b.kind === "shared"
    : b.kind === "service" && a.serviceId === b.serviceId;
}

export function scopeOfRef(view: VaultView, scopeRef: VaultScopeRef): VaultScope | undefined {
  return view.scopes.find((scope) => sameScopeRef(scope.ref, scopeRef));
}

// ── keys ────────────────────────────────────────────────────────────────────

/** The words in a name that make a value sensitive by default; the person can still say no. */
export const SENSITIVE_WORDS = [
  "SECRET",
  "TOKEN",
  "PASSWORD",
  "PASS",
  "KEY",
  "DSN",
  "PRIVATE",
  "CREDENTIAL",
] as const;

/** The first sensitive word the name holds (any case), or null. */
export function sensitiveWordIn(key: string): string | null {
  const upper = key.toUpperCase();
  return SENSITIVE_WORDS.find((word) => upper.includes(word)) ?? null;
}

/** Zerops' own rule for a variable's name (`projectEnvKeyInvalid` otherwise). */
export const VAULT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const KEY_FORMAT_WORDS = "Letters, digits and _ only, not starting with a digit";

/**
 * Why a key cannot be added to a scope, or null: its format, a value the scope already holds
 * (Zerops compares keys case-insensitively), or — in a service — a run entry of its deployed
 * zerops.yml, which Zerops refuses (`userDataDuplicateKey`). An empty key is no problem yet.
 */
export function keyProblem(key: string, scope: VaultScope): string | null {
  if (key === "") return null;
  if (!VAULT_KEY_PATTERN.test(key)) return KEY_FORMAT_WORDS;
  const upper = key.toUpperCase();
  const held = scope.values.find((value) => value.key.toUpperCase() === upper);
  if (held !== undefined) return `${held.key} already exists`;
  const entry = scope.reads.find((read) => read.key.toUpperCase() === upper);
  if (entry !== undefined) return `${scopeName(scope)}'s zerops.yml already sets ${entry.key}`;
  return null;
}

/** 32 random bytes in base64url (43 characters), from the given source of randomness. */
export function generateVaultValue(
  fill: (target: Uint8Array<ArrayBuffer>) => Uint8Array = (target) =>
    crypto.getRandomValues(target),
): string {
  const bytes = fill(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

// ── time ────────────────────────────────────────────────────────────────────

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const count = (n: number, one: string, many: string) =>
  n === 1 ? `${one} ago` : `${String(n)} ${many} ago`;

/** "just now", "5 minutes ago", "yesterday", "3 weeks ago"; null for a time it cannot read. */
export function agoWords(at: string | null, nowMs: number): string | null {
  if (at === null) return null;
  const then = Date.parse(at);
  if (Number.isNaN(then)) return null;
  const elapsed = nowMs - then;
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return count(Math.floor(elapsed / MINUTE), "a minute", "minutes");
  if (elapsed < DAY) return count(Math.floor(elapsed / HOUR), "an hour", "hours");
  const days = Math.floor(elapsed / DAY);
  if (days === 1) return "yesterday";
  if (days < 14) return `${String(days)} days ago`;
  if (days < 60) return count(Math.floor(days / 7), "a week", "weeks");
  if (days < 730) return count(Math.floor(days / 30), "a month", "months");
  return count(Math.floor(days / 365), "a year", "years");
}

// ── a scope's rows ──────────────────────────────────────────────────────────

const matches = (value: VaultValue, query: string) => {
  if (query === "") return true;
  const needle = query.toLowerCase();
  return (
    value.key.toLowerCase().includes(needle) ||
    (value.value !== null && value.value.toLowerCase().includes(needle))
  );
};

/** The number beside a scope's name: its own values, or what a search matches in it. */
export function scopeCount(scope: VaultScope, query: string): number {
  if (query === "") return scope.kind === "managed" ? 0 : scope.values.length;
  return scope.values.filter((value) => matches(value, query)).length;
}

export interface VaultSections {
  readonly plain: ReadonlyArray<VaultValue>;
  readonly sensitive: ReadonlyArray<VaultValue>;
}

/** A scope's values that match a search, plain then sensitive, each by key (a managed one as made). */
export function scopeSections(scope: VaultScope, query: string): VaultSections {
  const shown = scope.values.filter((value) => matches(value, query));
  const ordered =
    scope.kind === "managed" ? shown : shown.toSorted((a, b) => a.key.localeCompare(b.key));
  return {
    plain: ordered.filter((value) => !value.sensitive),
    sensitive: ordered.filter((value) => value.sensitive),
  };
}

/** Whether the view says nothing reads this value yet. */
export function isUnread(view: VaultView, scope: VaultScope, key: string): boolean {
  return view.notLive.some(
    (item) => item.kind === "unread" && item.key === key && sameScopeRef(item.scope, scope.ref),
  );
}

export type VaultValueLine =
  | { readonly kind: "value"; readonly text: string; readonly tail: string | null }
  /** A plain value that is the empty string: said so, never a blank line. */
  | { readonly kind: "empty"; readonly tail: string | null }
  | { readonly kind: "sensitive"; readonly text: string };

const NOTHING_READS_YET = "nothing reads it yet";

/**
 * A closed row's second line: the plain value (with what is not live yet), or for a sensitive
 * one what it is and when it was set — never dots.
 */
export function valueLine(
  view: VaultView,
  scope: VaultScope,
  value: VaultValue,
  nowMs: number,
): VaultValueLine {
  const unread = isUnread(view, scope, value.key);
  if (!value.sensitive) {
    const tail = unread ? NOTHING_READS_YET : null;
    return (value.value ?? "") === ""
      ? { kind: "empty", tail }
      : { kind: "value", text: value.value ?? "", tail };
  }
  if (value.madeByZerops) return { kind: "sensitive", text: "Sensitive · made by Zerops" };
  const when = agoWords(value.changedAt ?? value.createdAt, nowMs);
  if (unread)
    return { kind: "sensitive", text: `Added ${when ?? "lately"} · ${NOTHING_READS_YET}` };
  return { kind: "sensitive", text: when === null ? "Sensitive" : `Sensitive · set ${when}` };
}

/** How an open row says where one reader stands. */
export function readerStateWords(state: VaultReader["state"]): string {
  switch (state) {
    case "live":
      return "live";
    case "restart":
      return "started before this change — restart";
    case "unknown":
      return "start not known";
  }
}

/** A managed service's hostname in a reference: Zerops writes it as it is. */
export interface VaultReference {
  /** How its own service, or any service for Shared and managed values, reads it. */
  readonly own: string;
  /** How another service reads a service's own value; null for Shared and managed ones. */
  readonly other: string | null;
}

export function referenceFor(scope: VaultScope, key: string): VaultReference {
  if (scope.kind === "managed") return { own: ref(`${scope.hostname ?? ""}_${key}`), other: null };
  if (scope.hostname === null) return { own: ref(key), other: null };
  return { own: ref(key), other: ref(`${scope.hostname}_${key}`) };
}

// ── what is not live yet ────────────────────────────────────────────────────

export interface VaultTarget {
  readonly scopeId: string;
  /** The row to open; null to show the scope (what a service reads is at its foot). */
  readonly valueId: string | null;
}

/** Where clicking a not-live item goes: the value it names, else the service whose yaml it is. */
export function notLiveTarget(view: VaultView, item: VaultNotLive): VaultTarget | null {
  switch (item.kind) {
    case "restart": {
      for (const scope of view.scopes) {
        const value = scope.values.find(
          (candidate) =>
            item.keys.includes(candidate.key) &&
            candidate.readers.some(
              (reader) => reader.serviceId === item.serviceId && reader.state === "restart",
            ),
        );
        if (value !== undefined) return { scopeId: scope.id, valueId: value.id };
      }
      return { scopeId: item.serviceId, valueId: null };
    }
    case "unread": {
      const scope = scopeOfRef(view, item.scope);
      if (scope === undefined) return null;
      const value = scope.values.find((candidate) => candidate.key === item.key);
      return { scopeId: scope.id, valueId: value?.id ?? null };
    }
    case "missing":
    case "self":
      return { scopeId: item.serviceId, valueId: null };
  }
}

/**
 * The Vault's one line about values its apps don't run yet: how many, and what makes them live:
 * the Mate with the next message, else a restart the person does. `null` when nothing waits on a
 * restart (a deploy-only fact is the open row's to say).
 */
export function notLiveLine(
  items: ReadonlyArray<VaultNotLive>,
  mateName: string | null,
): {
  readonly text: string;
  readonly restarts: ReadonlyArray<{ readonly serviceId: string; readonly hostname: string }>;
} | null {
  const restarts = items.filter(
    (item): item is Extract<VaultNotLive, { kind: "restart" }> => item.kind === "restart",
  );
  if (restarts.length === 0) return null;
  const count = new Set(restarts.flatMap((item) => item.keys)).size;
  const hosts = joinNames(restarts.map((item) => item.hostname));
  const fact = count === 1 ? "1 value isn't live yet" : `${count} values aren't live yet`;
  const fix =
    mateName === null ? `restart ${hosts}` : `${mateName} restarts ${hosts} with your next message`;
  return {
    text: `${fact} — ${fix}`,
    restarts: restarts.map(({ serviceId, hostname }) => ({ serviceId, hostname })),
  };
}

export const RESTART_CONFIRM = (host: string) =>
  `${host} restarts now. Its containers restart one by one.`;

// ── what a write means ──────────────────────────────────────────────────────

const reads = (hosts: ReadonlyArray<string>) =>
  `${joinNames(hosts)} ${hosts.length > 1 ? "read" : "reads"} it`;

/** The line under a saved row: who runs the previous value, or that nothing reads it yet. */
export function impactLine(impact: VaultImpact): string | null {
  if (impact.restart.length > 0) {
    return `${reads(impact.restart.map((service) => service.hostname))} · a restart applies it`;
  }
  return impact.unread ? NOTHING_READS_YET : null;
}

export interface VaultReviewLine {
  readonly mark: "+" | "~" | "−";
  readonly key: string;
  readonly consequence: string;
  /** A removal that services still read: it needs the person's explicit yes. */
  readonly guarded: boolean;
}

/** One change of an edit as text, with what it means once applied. */
export function reviewLine(write: VaultWrite, impact: VaultImpact): VaultReviewLine {
  if (write.kind === "remove") {
    const hosts = impact.literal.map((service) => service.hostname);
    return {
      mark: "−",
      key: write.key,
      consequence:
        hosts.length === 0
          ? "nothing reads it"
          : `${reads(hosts)} — ${hosts.length > 1 ? "they" : "it"} would get the literal text`,
      guarded: hosts.length > 0,
    };
  }
  const hosts = impact.restart.map((service) => service.hostname);
  return {
    mark: write.kind === "add" ? "+" : "~",
    key: write.key,
    consequence:
      hosts.length > 0
        ? `${reads(hosts)} — restart ${joinNames(hosts)}`
        : impact.unread
          ? NOTHING_READS_YET
          : "nothing reads it",
    guarded: false,
  };
}

/** The guard a removal shows while services read the value. */
export function removeGuardWords(
  key: string,
  hostnames: ReadonlyArray<string>,
): ReadonlyArray<VaultWordPart> {
  const many = hostnames.length > 1;
  return [
    ...hostnames.flatMap((host, index) => {
      const joiner = index === 0 ? [] : index === hostnames.length - 1 ? [t(" and ")] : [t(", ")];
      return [...joiner, strong(host)];
    }),
    t(many ? " read " : " reads "),
    code(key),
    t(
      many
        ? ". After their next restart they'd get the literal text "
        : ". After its next restart it'd get the literal text ",
    ),
    code(ref(key)),
    t("."),
  ];
}

/**
 * What a refused write says: the account's own sentence when it gave one, else words for the
 * platform's code.
 */
export function refusalWords(
  errorCode: string | null,
  scope: VaultScope,
  key: string,
  reason: string | null,
): string {
  if (reason !== null && reason !== "") return reason;
  switch (errorCode) {
    case "projectEnvDuplicateKey":
      return `${key} already exists`;
    case "userDataDuplicateKey":
      return `${scopeName(scope)} already has ${key} in its values or zerops.yml`;
    case "projectEnvKeyInvalid":
      return KEY_FORMAT_WORDS;
    default:
      return "Zerops refused it";
  }
}
