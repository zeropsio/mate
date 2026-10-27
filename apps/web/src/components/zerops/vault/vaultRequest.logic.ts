/**
 * A value the Mate asked the person for (`zerops_env action=request`): one only they have, typed
 * into the card and written straight to the vault — it never crosses the conversation, and it is
 * held nowhere but the field and the write. Whether it was given is read off the vault itself, so
 * a reload draws the card as it stands: the key in that vault, written since it was asked, is
 * given.
 */
import {
  VAULT_ASK_ACTIVITY_KIND,
  isMateOwned,
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
  /** What it is, in people's words ("Stripe secret key"); `null` from an older zcp. */
  readonly label: string | null;
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
    label: request.label ?? null,
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
  /**
   * A name the Mate and zcp keep for themselves (`isMateOwned`): the vault never lists one, so
   * a value saved under it could be neither seen nor removed. The card takes none.
   */
  | { readonly kind: "reserved" }
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
  if (isMateOwned(ask.key)) return { kind: "reserved" };
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

/**
 * A name a Zerops credential goes by: a Zerops token or password (`ZEROPS_TOKEN`,
 * `ZEROPS_TOKEN_PROD`), or zcp's own sign-in to Zerops (`ZCP_API_KEY`). Only these are said to look
 * like a Zerops sign-in; a name the Mate keeps for itself is told apart (`reserved`).
 */
const ZEROPS_SIGN_IN =
  /(^|_)ZEROPS_(.*_)?(TOKEN|PASSWORD|SECRET|API_KEY)(_|$)|^ZCP_(.*_)?(TOKEN|API_KEY|PASSWORD|SECRET)$/u;

/** Whether a key is named like a Zerops credential: the card warns before it is given. */
export function vaultAskLooksLikeZeropsSignIn(key: string): boolean {
  return ZEROPS_SIGN_IN.test(key.toUpperCase());
}

/** What the person said to the card here: put it in, or not now. Memory only. */
export type VaultAskSaid = "put" | "not-now";

export type VaultAskFace =
  | "reserved"
  | "reading"
  | "unplaced"
  | "open"
  | "put"
  | "filled"
  | "not-now";

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

const listed = (names: ReadonlyArray<string>): string =>
  names.length <= 1
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

// ---------------------------------------------------------------------------
// The ask in the composer's drawer, and its answer in the run that asked
// ---------------------------------------------------------------------------

/** What the value is, as people name it: the agent's label, else its key. */
export function vaultAskLabel(ask: Pick<VaultAsk, "key" | "label">): string {
  return ask.label ?? ask.key;
}

/** The agent's why as a phrase that follows the label: no capital, no full stop. */
const whyPhrase = (why: string): string => {
  const trimmed = why.trim().replace(/[.\s]+$/u, "");
  const first = trimmed.split(/\s/u)[0] ?? "";
  // "For the API." → "for the API", but an acronym or a name keeps its case.
  return first.length > 1 && first === first[0] + first.slice(1).toLowerCase()
    ? trimmed[0]!.toLowerCase() + trimmed.slice(1)
    : trimmed;
};

/** The drawer's one line: who needs what, and why, in the agent's words. */
export function vaultAskLine(ask: VaultAsk, mateName: string): string {
  const line = `${mateName} needs your ${vaultAskLabel(ask)}`;
  return ask.reason === null || ask.reason.trim() === ""
    ? line
    : `${line}, ${whyPhrase(ask.reason)}`;
}

/** The drawer's one plain sentence of what happens, in the state the vault says. */
export function vaultAskNote(
  ask: VaultAsk,
  state: VaultAskState["kind"],
  mateName: string,
): string {
  switch (state) {
    case "filled":
      return "You added it in the Vault.";
    case "reserved":
      return `${ask.key} is a name ${mateName} keeps for itself, so the vault won't list it.`;
    case "unplaced":
      return `${ask.scope.kind === "service" ? ask.scope.hostname : "This vault"} isn't in this project any more.`;
    default:
      return ask.scope.kind === "shared"
        ? "Goes to this project's vault for every app, never into this chat."
        : `Goes to ${ask.scope.hostname}'s vault, never into this chat.`;
  }
}

/** The one warning that matters: a Zerops sign-in is never the Mate's to have. */
export function vaultAskWarning(ask: Pick<VaultAsk, "key">, mateName: string): string | null {
  return vaultAskLooksLikeZeropsSignIn(ask.key)
    ? `Looks like a Zerops sign-in. ${mateName} never needs yours.`
    : null;
}

/** A service the result row offers to restart, so it runs the new value. */
export interface VaultAskRestart {
  readonly serviceId: string;
  readonly hostname: string;
}

/** The answered ask in the run that asked: what it is, how it ended, what still needs doing. */
export interface VaultAskResultRow {
  readonly title: string;
  readonly words: string;
  readonly restart: ReadonlyArray<VaultAskRestart>;
}

/**
 * The result row of an answered ask, off the engine's record and the vault: saved, it is added
 * for every app or for one, hidden when the vault keeps it so, and an app that runs the value it
 * started with is offered a restart; not given, "Not now". Nothing while it is still asked.
 */
export function vaultAskResult(
  ask: VaultAsk,
  engine: VaultAskActivityPayload["state"],
  view: VaultView,
): VaultAskResultRow | null {
  const title = vaultAskLabel(ask);
  if (engine === "declined") return { title, words: "Not now", restart: [] };
  if (engine !== "saved") return null;
  const held =
    view.status === "unread"
      ? undefined
      : askScope(view, ask)?.values.find((value) => value.key === ask.key);
  const place = ask.scope.kind === "shared" ? "every app" : ask.scope.hostname;
  const restart = (held?.readers ?? [])
    .filter((reader) => reader.state === "restart")
    .map(({ serviceId, hostname }) => ({ serviceId, hostname }));
  return {
    title,
    words: `added for ${place}${held?.sensitive === true ? " · hidden" : ""}`,
    restart,
  };
}

/** The restart a result row offers, in words. */
export function vaultAskRestartWords(restart: ReadonlyArray<VaultAskRestart>): string {
  return `restart ${listed(restart.map((service) => service.hostname))} to use it`;
}

/** The ask the composer's drawer holds: the oldest the engine keeps open, read as its words need. */
export function openVaultAsk(
  activities: ReadonlyArray<OrchestrationThreadActivity> | undefined,
): { readonly requestId: string; readonly ask: VaultAsk } | null {
  let oldest: {
    readonly at: number;
    readonly payload: VaultAskActivityPayload;
    readonly createdAt: string;
  } | null = null;
  for (const activity of activities ?? []) {
    if (activity.kind !== VAULT_ASK_ACTIVITY_KIND) continue;
    const payload = activity.payload as VaultAskActivityPayload;
    if (payload.state !== "open") continue;
    const at = Date.parse(activity.createdAt);
    if (oldest === null || at < oldest.at) oldest = { at, payload, createdAt: activity.createdAt };
  }
  if (oldest === null) return null;
  const { payload } = oldest;
  return {
    requestId: payload.requestId,
    ask: {
      key: payload.key,
      label: payload.label ?? null,
      scope: payload.scope,
      sensitive: payload.sensitive,
      reason: payload.reason,
      askedAt: oldest.createdAt,
    },
  };
}
