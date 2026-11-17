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
import { type SecretRecipe, readSecretRecipe, secretRecipeWords } from "./secretGenerate";
import type { ZeropsOperation } from "@t3tools/client-runtime/zerops/model";

import {
  type AskState,
  type AskWhere,
  NOT_NOW,
  namesWords,
  notNowWords,
} from "../../ask/ask.logic";

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
  /**
   * The application's stage or production it goes to (`zerops_propose_env secret=true`): written
   * with the person's own access to that project. Absent: the Mate's own vault.
   */
  readonly environment?: VaultAskEnvironment;
  /**
   * The running services the card restarts once it is saved, so they run the new value: the ones
   * zcp named for stage or production, and those the vault's references say read it.
   */
  readonly restart?: ReadonlyArray<VaultAskRestart>;
  /** A random secret's recipe (`secretGenerate.ts`): the card makes the value at the press. */
  readonly generate?: string;
}

/** The stage or production an ask's vault is in. */
export interface VaultAskEnvironment {
  readonly kind: "stage" | "production";
  readonly projectId: string;
  /** As Mate's menu names it: "Production", a stage by its own name. */
  readonly name: string;
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
    ...(request.environment === undefined ? {} : { environment: request.environment }),
    ...(request.restart === undefined || request.restart.length === 0
      ? {}
      : { restart: request.restart }),
    ...(request.generate === undefined ? {} : { generate: request.generate }),
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
  | { readonly kind: "filled"; readonly held: VaultValue };

/** Where the asked value stands, read off the vault. */
export function vaultAskState(view: VaultView, ask: VaultAsk): VaultAskState {
  if (isMateOwned(ask.key)) return { kind: "reserved" };
  if (view.status === "unread") return { kind: "reading" };
  const scope = askScope(view, ask);
  if (scope === undefined) return view.complete ? { kind: "unplaced" } : { kind: "reading" };
  const held = scope.values.find((value) => value.key === ask.key) ?? null;
  const written = held === null ? null : (held.changedAt ?? held.createdAt);
  if (held !== null && written !== null && Date.parse(written) >= Date.parse(ask.askedAt)) {
    return { kind: "filled", held };
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

/** The same vault: the same scope, in the same project (the Mate's own, or one stage or production). */
const sameVault = (
  left: Pick<VaultAsk, "scope" | "environment">,
  right: Pick<VaultAskActivityPayload, "scope" | "environment">,
): boolean =>
  sameScope(left.scope, right.scope) &&
  left.environment?.projectId === right.environment?.projectId;

/**
 * The engine's record of the ask a call made: the first ask of that key and vault recorded since
 * the call began. Every ask is the engine's (zcp only answers the call), so a call with none has
 * no card: the record is where what the person said lives.
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
    if (payload.key !== ask.key || !sameVault(ask, payload) || at < since) continue;
    if (found === null || at < found.at) found = { at, payload };
  }
  return found?.payload ?? null;
}

// ---------------------------------------------------------------------------
// The ask's card, and its answer in the run that asked
// ---------------------------------------------------------------------------

/** What the value is, as people name it: the agent's label, else its key. */
export function vaultAskLabel(ask: Pick<VaultAsk, "key" | "label">): string {
  return ask.label ?? ask.key;
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

/** What an answered ask still needs, in the run that asked: the apps to restart for its value. */
interface VaultAskResultRow {
  readonly title: string;
  readonly restart: ReadonlyArray<VaultAskRestart>;
}

/**
 * The run's row for an answered ask, off the engine's record and the vault: only what the ask's
 * own card does not say (a state is said once) — an app that runs the value it started with, to
 * restart. Nothing for a value no app needs restarting for, for Not now, or while still asked.
 */
export function vaultAskResult(
  ask: VaultAsk,
  engine: VaultAskActivityPayload["state"],
  view: VaultView,
): VaultAskResultRow | null {
  // A value for stage or production restarts its readers from its own card, and `view` is the
  // Mate's own vault.
  if (ask.environment !== undefined) return null;
  if (engine !== "saved" || view.status === "unread") return null;
  const held = askScope(view, ask)?.values.find((value) => value.key === ask.key);
  const restart = (held?.readers ?? [])
    .filter((reader) => reader.state === "restart")
    .map(({ serviceId, hostname }) => ({ serviceId, hostname }));
  return restart.length === 0 ? null : { title: vaultAskLabel(ask), restart };
}

/** The restart a result row offers, in words. */
export function vaultAskRestartWords(restart: ReadonlyArray<VaultAskRestart>): string {
  return `restart ${namesWords(restart.map((service) => service.hostname))} to use it`;
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
      ...(payload.environment === undefined ? {} : { environment: payload.environment }),
      ...(payload.restart === undefined || payload.restart.length === 0
        ? {}
        : { restart: payload.restart }),
      ...(payload.generate === undefined ? {} : { generate: payload.generate }),
    },
  };
}

// ---------------------------------------------------------------------------
// The card, in both its homes: the conversation, and above the composer
// ---------------------------------------------------------------------------

/**
 * A press on the card that is still under way in this tab; `restart`, the services that read the
 * value restarting once it is saved.
 */
export type VaultAskPress = "save" | "restart" | "useGiven" | "notNow";

/**
 * What the card reads. What the person said lives in the engine's record (`record`: saved or
 * declined, who and when) and whether the key is there in the vault (`vault`), so a reload or
 * another device draws the same card. This tab adds only operations: a press still under way and
 * how the last one was refused — never an answer.
 */
export interface VaultAskSource {
  readonly ask: VaultAsk;
  readonly mateName: string;
  readonly record: Pick<VaultAskActivityPayload, "state" | "answer">;
  readonly vault: VaultAskState;
  readonly pending: VaultAskPress | null;
  readonly refusal: string | null;
  /** A person's name by their Zerops user id. */
  readonly nameOf: (subject: string) => string | undefined;
  /** A time as the conversation's clock says it. */
  readonly clock: (atMs: number) => string;
  /**
   * Why this person cannot give a value for stage or production (they cannot change that project);
   * `null` where they can, or while it is not known.
   */
  readonly readOnly?: string | null;
}

export interface VaultAskView {
  readonly state: AskState;
  readonly where: AskWhere;
  readonly title: string;
  readonly why: string | null;
  /**
   * The field to type the value into (`ready` once the vault says where it goes), the value given
   * in the Vault since it was asked, or nothing.
   */
  readonly body:
    | { readonly kind: "field"; readonly ready: boolean }
    | { readonly kind: "given"; readonly words: string }
    | { readonly kind: "none" };
  /** The main press, which a failure's Try again repeats; `null` offers Not now alone. */
  readonly main: { readonly label: string; readonly does: "save" | "useGiven" } | null;
  readonly warning: string | null;
  /** A value for stage or production: always kept hidden, and offered generated. */
  readonly elsewhere: boolean;
  /**
   * A random secret the card makes at the press, in place of the field until the person chooses
   * their own value: what it makes in words, the press that adds it, and how to make it.
   */
  readonly made: {
    readonly words: string;
    readonly label: string;
    readonly recipe: SecretRecipe;
  } | null;
}

const SAVE = { label: "Save to vault", does: "save" } as const;
const USE_GIVEN = { label: "Use that one", does: "useGiven" } as const;

/**
 * The card an ask draws, from its sources: the engine's record first (saved, declined, closed),
 * then this tab's press under way and its refusal, then the vault — given since it was asked, a
 * name it would hide, a service it no longer has, or open to take the value.
 */
export function vaultAskView(source: VaultAskSource): VaultAskView {
  if (source.ask.environment !== undefined)
    return environmentAskView(source, source.ask.environment);
  const { ask, mateName, record, vault } = source;
  const shared = ask.scope.kind === "shared";
  const host = ask.scope.kind === "service" ? ask.scope.hostname : null;
  const vaultName = `${host ?? mateName}'s vault`;
  const frame = {
    where: { scope: "mate", detail: host ?? "every app" },
    // In people's words ("Add Stripe secret key to Milo's vault"), never its variable's name.
    title: `Add ${vaultAskLabel(ask)} to ${vaultName}`,
    why: ask.reason,
    warning: vaultAskWarning(ask, mateName),
    elsewhere: false,
    made: null,
  } as const;
  const none = { kind: "none" } as const;
  const by =
    record.answer?.by.kind === "person" ? (source.nameOf(record.answer.by.subject) ?? null) : null;
  const held = vault.kind === "open" || vault.kind === "filled" ? vault.held : null;
  const hidden = held?.sensitive === true ? " · hidden" : "";
  const restart = (ask.restart ?? []).map((service) => service.hostname);
  const restarting = restart.length === 0 ? null : namesWords(restart);

  if (record.state === "saved") {
    const unrestarted = record.answer?.notRestarted;
    const fact = [
      `In ${vaultName}${hidden}`,
      unrestarted === undefined ? null : `${unrestarted} didn't restart`,
      by === null ? null : `set by ${by}`,
    ];
    return {
      ...frame,
      state: {
        kind: "done",
        words: fact.filter((part) => part !== null).join(" · "),
        told: `${mateName} hears: ${ask.key} is saved for ${shared ? "every app" : host}${unrestarted === undefined ? "" : `, and ${unrestarted} didn't restart`}`,
      },
      body: none,
      main: null,
    };
  }
  if (record.state === "declined") {
    const at = record.answer === null ? null : source.clock(record.answer.at);
    return {
      ...frame,
      state: { kind: "notNow", words: notNowWords(by, at) },
      body: none,
      main: null,
    };
  }
  if (record.state === "closed") {
    const words = `${mateName} isn't waiting on this any more.`;
    return { ...frame, state: { kind: "replaced", words }, body: none, main: null };
  }

  const settledInVault = vault.kind === "reserved" || vault.kind === "unplaced";
  const body: VaultAskView["body"] =
    vault.kind === "filled"
      ? { kind: "given", words: `Added in the Vault since ${mateName} asked${hidden}` }
      : settledInVault
        ? none
        : { kind: "field", ready: vault.kind === "open" };
  const main =
    vault.kind === "filled"
      ? restarting === null
        ? USE_GIVEN
        : { label: `Restart ${restarting}`, does: "useGiven" as const }
      : settledInVault
        ? null
        : restarting === null
          ? SAVE
          : { label: `Save and restart ${restarting}`, does: "save" as const };
  const open = { ...frame, body, main };

  if (source.pending !== null) {
    const working: AskState =
      source.pending === "notNow"
        ? { kind: "working", words: NOT_NOW, pressed: "notNow" }
        : {
            kind: "working",
            words:
              source.pending === "save"
                ? "Saving to vault…"
                : source.pending === "restart"
                  ? `Restarting ${restarting ?? "it"}…`
                  : `Telling ${mateName}…`,
            pressed: "main",
          };
    return { ...open, state: working };
  }
  if (source.refusal !== null) return { ...open, state: { kind: "failed", words: source.refusal } };
  if (vault.kind === "reserved") {
    const words = `${ask.key} is a name ${mateName} keeps for itself, so the vault won't list it.`;
    return { ...open, state: { kind: "failed", words } };
  }
  if (vault.kind === "unplaced") {
    const words = `${host ?? "This vault"} isn't in this project any more.`;
    return { ...open, state: { kind: "failed", words } };
  }
  return { ...open, state: { kind: "waiting" } };
}

/**
 * The card for a secret asked for in the application's stage or production: titled by its name
 * ("Add AUTH_SECRET"), its chip the environment (Production in the risk colour), written hidden with
 * the person's own access to that project, then the services that read it restarted — the one
 * press says which ("Save and restart api"). A value written there since it was asked restarts
 * them and tells the Mate. Only someone who can change that project gives it.
 */
function environmentAskView(
  source: VaultAskSource,
  environment: VaultAskEnvironment,
): VaultAskView {
  const { ask, mateName, record, vault } = source;
  const host = ask.scope.kind === "service" ? ask.scope.hostname : null;
  const place = `${environment.name}, for ${host ?? "every app"}`;
  const restart = (ask.restart ?? []).map((service) => service.hostname);
  const restarting = restart.length === 0 ? null : namesWords(restart);
  const frame = {
    where: { scope: environment.kind, detail: host ?? "every app" },
    title: `Add ${ask.key}`,
    why: ask.reason,
    warning: vaultAskWarning(ask, mateName),
    elsewhere: true,
    made: null,
  } as const;
  const none = { kind: "none" } as const;
  const by =
    record.answer?.by.kind === "person" ? (source.nameOf(record.answer.by.subject) ?? null) : null;

  if (record.state === "saved") {
    const unrestarted = record.answer?.notRestarted;
    const fact = [
      `In ${place} · hidden`,
      unrestarted === undefined ? null : `${unrestarted} didn't restart`,
      by === null ? null : `set by ${by}`,
    ];
    return {
      ...frame,
      state: {
        kind: "done",
        words: fact.filter((part) => part !== null).join(" · "),
        told: `${mateName} hears: ${ask.key} is saved in ${environment.name}${unrestarted === undefined ? "" : `, and ${unrestarted} didn't restart`}`,
      },
      body: none,
      main: null,
    };
  }
  if (record.state === "declined") {
    const at = record.answer === null ? null : source.clock(record.answer.at);
    return {
      ...frame,
      state: { kind: "notNow", words: notNowWords(by, at) },
      body: none,
      main: null,
    };
  }
  if (record.state === "closed") {
    const words = `${mateName} isn't waiting on this any more.`;
    return { ...frame, state: { kind: "replaced", words }, body: none, main: null };
  }

  const settledInVault = vault.kind === "reserved" || vault.kind === "unplaced";
  const body: VaultAskView["body"] =
    vault.kind === "filled"
      ? { kind: "given", words: `Added in ${environment.name} since ${mateName} asked` }
      : settledInVault
        ? none
        : { kind: "field", ready: vault.kind === "open" };
  const main: VaultAskView["main"] =
    vault.kind === "filled"
      ? { label: restarting === null ? "Use that one" : `Restart ${restarting}`, does: "useGiven" }
      : settledInVault
        ? null
        : {
            label:
              restarting === null
                ? `Save to ${environment.name}`
                : `Save and restart ${restarting}`,
            does: "save",
          };
  const recipe = readSecretRecipe(ask.generate);
  const made =
    recipe === null || body.kind !== "field"
      ? null
      : {
          words: secretRecipeWords(recipe),
          label: restarting === null ? `Add ${ask.key}` : `Add and restart ${restarting}`,
          recipe,
        };
  const open = { ...frame, body, main, made };

  if (source.pending !== null) {
    const words =
      source.pending === "save"
        ? `Saving to ${environment.name}…`
        : source.pending === "restart"
          ? `Restarting ${restarting ?? "it"}…`
          : `Telling ${mateName}…`;
    const working: AskState =
      source.pending === "notNow"
        ? { kind: "working", words: NOT_NOW, pressed: "notNow" }
        : { kind: "working", words, pressed: "main" };
    return { ...open, state: working };
  }
  if (source.refusal !== null) return { ...open, state: { kind: "failed", words: source.refusal } };
  if (vault.kind === "reserved") {
    const words = `${ask.key} is a name ${mateName} keeps for itself, so the vault won't list it.`;
    return { ...open, state: { kind: "failed", words } };
  }
  if (vault.kind === "unplaced") {
    const words = `${host ?? "That service"} isn't in ${environment.name} any more.`;
    return { ...open, state: { kind: "failed", words } };
  }
  if (source.readOnly !== undefined && source.readOnly !== null) {
    return {
      ...open,
      body: none,
      main: null,
      made: null,
      state: { kind: "othersToAnswer", words: source.readOnly },
    };
  }
  return { ...open, state: { kind: "waiting" } };
}

/**
 * Which conversation row holds the card of an ask the engine recorded at `askedAt`: the latest
 * call that asked for that key and vault before then (`useAskReveal` takes the last row it holds).
 */
export function vaultAskRowHolds(
  ask: Pick<VaultAsk, "key" | "scope" | "askedAt" | "environment">,
): (row: { readonly kind: string; readonly operation?: unknown }) => boolean {
  const until = Date.parse(ask.askedAt);
  return (row) => {
    if (row.kind !== "vault-request" && row.kind !== "operation") return false;
    const asked = vaultAskOf(row.operation as ZeropsOperation);
    return (
      asked !== null &&
      asked.key === ask.key &&
      sameScope(asked.scope, ask.scope) &&
      asked.environment?.projectId === ask.environment?.projectId &&
      Date.parse(asked.askedAt) <= until
    );
  };
}
