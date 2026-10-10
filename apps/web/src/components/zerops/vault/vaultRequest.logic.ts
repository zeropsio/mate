/**
 * A value the Mate asked the person for (`zerops_env action=request`): one only they have, typed
 * into the card and written straight to the vault — it never crosses the conversation, and it is
 * held nowhere but the field and the write. Whether it was given is read off the vault itself, so
 * a reload draws the card as it stands: the key in that vault, written since it was asked, is
 * given.
 */
import {
  VAULT_ASK_ACTIVITY_KIND,
  type VaultAskActivityPayload,
  type VaultScope,
  type VaultScopeRef,
  type VaultValue,
  type VaultView,
  type VaultWrite,
} from "@t3tools/client-runtime/data";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";

export interface VaultAsk {
  readonly key: string;
  /** Shared, or one service's own vault by its hostname — what the agent named. */
  readonly scope:
    | { readonly kind: "shared" }
    | { readonly kind: "service"; readonly hostname: string };
  readonly sensitive: boolean;
  /** One sentence for the person: what it is for and where to find it. */
  readonly reason: string | null;
  /** When it was asked: a write since then gives it. */
  readonly askedAt: string;
}

/** The ask an operation is: a request zcp took and found the key missing for; `null` otherwise. */
export function vaultAskOf(operation: ZeropsOperation): VaultAsk | null {
  const change = operation.envChange;
  const request = change?.request;
  if (operation.kind !== "env" || operation.phase !== "done") return null;
  if (change === undefined || change.action !== "request" || request === undefined) return null;
  if (request.alreadySet) return null;
  if (change.scope === "service" && change.service === undefined) return null;
  return {
    key: request.key,
    scope:
      change.scope === "project" || change.service === undefined
        ? { kind: "shared" }
        : { kind: "service", hostname: change.service },
    sensitive: request.sensitive,
    reason: request.reason ?? null,
    askedAt: operation.anchorAt,
  };
}

export type VaultAskState =
  /** The vault has not answered yet: nothing is known of the key. */
  | { readonly kind: "reading" }
  /** The service it names is not in the project. */
  | { readonly kind: "unplaced" }
  /** Asked and not given: where it goes, and the value it replaces when the key is held. */
  | {
      readonly kind: "open";
      readonly ref: VaultScopeRef;
      readonly scope: VaultScope;
      readonly held: VaultValue | null;
    }
  /** The key is in that vault, written since it was asked. */
  | { readonly kind: "filled" };

/** Where the asked value stands, read off the vault. */
export function vaultAskState(view: VaultView, ask: VaultAsk): VaultAskState {
  if (view.status === "unread") return { kind: "reading" };
  const scope = askScope(view, ask);
  if (scope === undefined) return view.complete ? { kind: "unplaced" } : { kind: "reading" };
  const held = scope.values.find((value) => value.key === ask.key) ?? null;
  const written = held === null ? null : (held.changedAt ?? held.createdAt);
  if (written !== null && Date.parse(written) >= Date.parse(ask.askedAt)) {
    return { kind: "filled" };
  }
  return { kind: "open", ref: scope.ref, scope, held };
}

/**
 * The one write a put makes: an add, or an update of the value the vault holds under that key —
 * `sensitive` always sent (Zerops turns a value plain when an update leaves it out). Secret is
 * the person's word on the card (the agent's flag only pre-selects it), and a held secret stays
 * secret whatever is chosen.
 */
export function vaultAskWrite(
  ask: VaultAsk,
  held: VaultValue | null,
  value: string,
  secret: boolean,
): Extract<VaultWrite, { kind: "add" | "update" }> {
  return held === null
    ? { kind: "add", key: ask.key, value, sensitive: secret }
    : { kind: "update", id: held.id, key: ask.key, value, sensitive: held.sensitive || secret };
}

/**
 * Who can read the value once it is in, and what never goes in, in our words beside the agent's:
 * a Shared value reaches every app of the project (the platform injects it), the Mate's own
 * included; an app's own reaches that app, which the Mate works in.
 */
export function vaultAskReach(ask: Pick<VaultAsk, "key" | "scope">, mateName: string): string {
  const reach =
    ask.scope.kind === "shared"
      ? `Every app in this project can read it, ${mateName} included.`
      : `${ask.scope.hostname} reads it, and ${mateName} can reach it.`;
  return `${reach} Never paste your own password or Zerops token.`;
}

/** A key named like a Zerops sign-in, or one Mate and zcp keep for themselves. */
const OWN_KEY = /(^|_)(ZEROPS|ZCP|MATE|GITEA)(_|$)|^GIT_TOKEN$/u;

/** Whether a key looks like the person's own Zerops sign-in: the card warns before it is given. */
export function vaultAskLooksOwn(key: string): boolean {
  return OWN_KEY.test(key.toUpperCase());
}

/** What the person said to the card here: put it in, or not now. Memory only. */
export type VaultAskSaid = "put" | "not-now";

export type VaultAskFace =
  | "reading"
  | "unplaced"
  | "open"
  | "put"
  | "filled"
  | "not-now"
  /** The engine's record: saved, or declined, as the person answered; or closed some other way. */
  | "saved"
  | "declined"
  | "closed";

/**
 * What the card draws: the person's own put says the Mate hears it next; given since (a reload, the
 * panel, the dashboard) it is simply in the vault; "Not now" folds what is still open.
 */
export function vaultAskFace(
  state: VaultAskState["kind"],
  said: VaultAskSaid | null,
): VaultAskFace {
  if (said === "put") return "put";
  if (state === "filled") return "filled";
  if (said === "not-now") return "not-now";
  return state;
}

/** Where it goes, as the card's second line says it: "Shared", "appdev". Secret is the person's. */
export function vaultAskWhere(ask: VaultAsk): string {
  return ask.scope.kind === "shared" ? "Shared" : ask.scope.hostname;
}

/** The scope an ask names, in a vault read. */
function askScope(view: VaultView, ask: VaultAsk): VaultScope | undefined {
  return view.scopes.find((candidate) =>
    ask.scope.kind === "shared"
      ? candidate.id === "shared"
      : candidate.hostname === ask.scope.hostname,
  );
}

const sameScope = (left: VaultAsk["scope"], right: VaultAskActivityPayload["scope"]): boolean =>
  left.kind === "shared"
    ? right.kind === "shared"
    : right.kind === "service" && right.hostname === left.hostname;

/**
 * The engine's record of the ask a call made: the first ask of that key and vault recorded since
 * the call began. None on a conversation the engine does not keep: the card then works as before
 * the engine, the Mate hearing of the value with the person's next message.
 */
export function engineVaultAskFor(
  activities: ReadonlyArray<OrchestrationThreadActivity> | undefined,
  ask: VaultAsk,
): VaultAskActivityPayload | null {
  const since = Date.parse(ask.askedAt);
  let found: { readonly at: number; readonly payload: VaultAskActivityPayload } | null = null;
  for (const activity of activities ?? []) {
    if (activity.kind !== VAULT_ASK_ACTIVITY_KIND) continue;
    const payload = activity.payload as VaultAskActivityPayload;
    const at = Date.parse(activity.createdAt);
    if (payload.key !== ask.key || !sameScope(ask.scope, payload.scope) || at < since) continue;
    if (found === null || at < found.at) found = { at, payload };
  }
  return found?.payload ?? null;
}

/**
 * What the card of an ask the engine keeps draws: the engine's record first, and the person's own
 * answer here until the record says so. Open, it stays the person's to answer even when the key
 * reached the vault some other way: only Save or Decline tells the Mate.
 */
export function vaultAskEngineFace(
  engine: VaultAskActivityPayload["state"],
  vault: VaultAskState["kind"],
  said: VaultAskSaid | null,
): VaultAskFace {
  if (engine === "saved" || (engine === "open" && said === "put")) return "saved";
  if (engine === "declined" || (engine === "open" && said === "not-now")) return "declined";
  if (engine === "closed") return "closed";
  return vault === "filled" ? "open" : vault;
}

const listed = (names: ReadonlyArray<string>): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

/**
 * What the person does for the value to take effect, by the platform's rules: a deploy activates
 * a reference (zerops.yaml is baked into the app version), a restart activates a changed value (a
 * running process keeps the environment it booted with). `null` before the vault is read.
 */
export function vaultAskPickUp(view: VaultView, ask: VaultAsk): string | null {
  if (view.status === "unread") return null;
  const held = askScope(view, ask)?.values.find((value) => value.key === ask.key);
  const readers = held?.readers ?? [];
  if (readers.length === 0) {
    return ask.scope.kind === "service"
      ? `It takes effect once ${ask.scope.hostname}'s zerops.yaml references it and ${ask.scope.hostname} is deployed.`
      : "It takes effect once a service's zerops.yaml references it and that service is deployed.";
  }
  const stale = readers
    .filter((reader) => reader.state !== "live")
    .map((reader) => reader.hostname);
  if (stale.length === 0) {
    return `${listed(readers.map((reader) => reader.hostname))} ${readers.length === 1 ? "uses" : "use"} it.`;
  }
  return `Restart ${listed(stale)} to use it: a running app keeps the value it started with.`;
}
