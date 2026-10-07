/**
 * A value the Mate asked the person for (`zerops_env action=request`): one only they have, typed
 * into the card and written straight to the vault — it never crosses the conversation, and it is
 * held nowhere but the field and the write. Whether it was given is read off the vault itself, so
 * a reload draws the card as it stands: the key in that vault, written since it was asked, is
 * given.
 */
import type {
  VaultScope,
  VaultScopeRef,
  VaultValue,
  VaultView,
  VaultWrite,
} from "@t3tools/client-runtime/data";
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
  const scope = view.scopes.find((candidate) =>
    ask.scope.kind === "shared"
      ? candidate.id === "shared"
      : candidate.hostname === ask.scope.hostname,
  );
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
 * `sensitive` always sent, as asked (Zerops turns a value plain when an update leaves it out).
 */
export function vaultAskWrite(
  ask: VaultAsk,
  held: VaultValue | null,
  value: string,
): Extract<VaultWrite, { kind: "add" | "update" }> {
  return held === null
    ? { kind: "add", key: ask.key, value, sensitive: ask.sensitive }
    : { kind: "update", id: held.id, key: ask.key, value, sensitive: ask.sensitive };
}

/** What the person said to the card here: put it in, or not now. Memory only. */
export type VaultAskSaid = "put" | "not-now";

export type VaultAskFace = "reading" | "unplaced" | "open" | "put" | "filled" | "not-now";

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

/** Where it goes, as the card's second line says it: "Shared · sensitive", "appdev · plain". */
export function vaultAskWhere(ask: VaultAsk): string {
  const scope = ask.scope.kind === "shared" ? "Shared" : ask.scope.hostname;
  return `${scope} · ${ask.sensitive ? "sensitive" : "plain"}`;
}
