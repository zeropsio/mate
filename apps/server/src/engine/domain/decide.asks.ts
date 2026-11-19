/**
 * The asks answered on a card (a vault value, a secret, an origin, a mirror): their outcomes, their words and what settles them.
 *
 * @module engine/domain/decide.asks
 */
import * as Schema from "effect/Schema";
import { wakeId as deriveWakeId } from "@t3tools/contracts";
import { HqRemoteUrl } from "@t3tools/shared/hqChanges";

import type { Command } from "./command.ts";
import type {
  ConversationState,
  OpenRequest,
  MirrorAsk,
  OriginAsk,
  SecretAsk,
  VaultAsk,
} from "./state.ts";
import { Rejected, type StepBuilder } from "./decide.step.ts";

/** How a value asked of the person ended: put in the vault, or not given. */
export type VaultOutcome = "saved" | "declined";
/**
 * Where the person keeps an origin's code: `connected`, on GitHub — HQ mounts it through the
 * organization's GitHub app; `declined`, in Mate — GitHub is not connected, only followed.
 */
export type OriginOutcome = "connected" | "declined";
/**
 * How a repository asked to be connected to GitHub ended: `connected`, at the GitHub address HQ
 * shows as its remote — the person's client set it itself; `declined`, not now.
 */
export type MirrorOutcome =
  | { readonly kind: "connected"; readonly url: string }
  | {
      readonly kind: "declined";
    };

/** An answer that says only how it ended (`{ outcome }`), as one of `outcomes`; anything more is none. */
const cardOutcome = <Outcome extends string>(
  answer: unknown,
  outcomes: ReadonlyArray<Outcome>,
): Outcome | null => {
  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) return null;
  const keys = Object.keys(answer);
  const outcome = (answer as { readonly outcome?: unknown }).outcome;
  return keys.length === 1 && outcomes.some((known) => known === outcome)
    ? (outcome as Outcome)
    : null;
};

/** One repository's address however written: `https://github.com/A/b.git/` is `github.com/a/b`. */
const originAddressKey = (url: string): string =>
  url
    .replace(/^https:\/\//iu, "")
    .replace(/\/+$/u, "")
    .replace(/\.git$/iu, "")
    .toLowerCase();

export const sameOriginAddress = (a: string, b: string): boolean =>
  originAddressKey(a) === originAddressKey(b);

/**
 * Closes the open origin asks `settled` picks, none of them answered by the person: their card
 * draws nothing and the conversation waits on them no more.
 */
export const settleOrigins = (
  b: StepBuilder,
  settled: (asked: NonNullable<OpenRequest["origin"]>) => boolean,
): void => {
  for (const request of Object.values(b.state.requests)) {
    if (request.origin === undefined || !settled(request.origin)) continue;
    b.emit({
      _tag: "RequestClosed",
      runId: request.runId,
      requestId: request.id,
      state: "dismissed",
    });
  }
};

/**
 * Closes the open asks to connect `repo` to GitHub, none of them answered by the person: their
 * card draws nothing and the conversation waits on them no more.
 */
export const settleMirrors = (b: StepBuilder, repo: string): void => {
  for (const request of Object.values(b.state.requests)) {
    if (request.mirror?.repo !== repo) continue;
    b.emit({
      _tag: "RequestClosed",
      runId: request.runId,
      requestId: request.id,
      state: "dismissed",
    });
  }
};

const sameScope = (left: VaultAsk["scope"], right: VaultAsk["scope"]): boolean =>
  left.kind === "shared"
    ? right.kind === "shared"
    : right.kind === "service" && right.hostname === left.hostname;

/** Whether a card still asks the person for `ask`'s value in `ask`'s vault. */
export const vaultAskOpen = (
  state: ConversationState,
  ask: Pick<VaultAsk, "key" | "scope">,
): boolean =>
  Object.values(state.requests).some(
    ({ vault }) =>
      vault !== undefined && vault.key === ask.key && sameScope(vault.scope, ask.scope),
  );

/** Whether a card still asks the person for `ask`'s secret in the same stage or production vault. */
export const secretAskOpen = (
  state: ConversationState,
  ask: Pick<SecretAsk, "key" | "scope" | "environment">,
): boolean =>
  Object.values(state.requests).some(
    ({ secret }) =>
      secret !== undefined &&
      secret.key === ask.key &&
      secret.environment.projectId === ask.environment.projectId &&
      sameScope(secret.scope, ask.scope),
  );

/** Where an asked value goes, as people and the agent read it: `Shared/KEY`, `api/KEY`. */
export const vaultPlace = (ask: Pick<VaultAsk, "key" | "scope">): string =>
  `${ask.scope.kind === "shared" ? "Shared" : ask.scope.hostname}/${ask.key}`;

/** Where a stage or production secret goes: `Production · Shared/KEY`. */
const secretPlace = (ask: Pick<SecretAsk, "key" | "scope" | "environment">): string =>
  `${ask.environment.name} · ${vaultPlace(ask)}`;

/** The longest service name and restart reason the agent's line on a secret carries. */
const HOSTNAME_MAX = 64;
const RESTART_REASON_MAX = 280;

/** How a stage or production secret ended: saved (with what restarted and what did not). */
export type SecretOutcome =
  | ({ readonly kind: "saved" } & SavedRestarts)
  | { readonly kind: "declined" };

/** What the person's card restarted after a save, and the service it did not, with why. */
interface SavedRestarts {
  readonly restarted?: ReadonlyArray<string>;
  readonly notRestarted?: NotRestartedService;
}

type NotRestartedService = { readonly hostname: string; readonly reason: string };

/**
 * After "saved to …": the services the card restarted — so an agent told to restart them once the
 * message says saved does not restart them again — and the one that did not restart, with why.
 */
const restartWords = ({ restarted, notRestarted }: SavedRestarts): string =>
  `${restarted === undefined || restarted.length === 0 ? "" : `; the person's card restarted ${restarted.join(", ")}, which run it — do not restart ${restarted.length === 1 ? "it" : "them"} again`}${notRestarted === undefined ? "" : `; ${notRestarted.hostname} didn't restart: ${notRestarted.reason}`}`;

/**
 * The agent's line on a secret it asked for in stage or production: where it went, what restarted
 * and what did not, or that it was not given. Never a value.
 */
export const secretAnswerWords = (
  ask: Pick<SecretAsk, "key" | "scope" | "environment">,
  outcome: SecretOutcome,
): string =>
  outcome.kind === "declined"
    ? `Secret request for ${ask.key} in ${ask.environment.name}: declined.`
    : `Secret request for ${ask.key}: saved to ${secretPlace(ask)}${restartWords(outcome)}.`;

/** The longest list of restarted services the agent's line carries. */
const RESTARTED_MAX = 32;

/** What restarted and what did not, off an answer — bounded; `null` for a malformed one. */
const savedRestarts = (restarted: unknown, notRestarted: unknown): SavedRestarts | null => {
  const failure = notRestarted === undefined ? undefined : restartFailure(notRestarted);
  if (failure === null) return null;
  if (
    restarted !== undefined &&
    (!Array.isArray(restarted) || restarted.some((each) => typeof each !== "string"))
  )
    return null;
  const names = (restarted as ReadonlyArray<string> | undefined)
    ?.slice(0, RESTARTED_MAX)
    .map((name) => name.slice(0, HOSTNAME_MAX));
  return {
    ...(names === undefined || names.length === 0 ? {} : { restarted: names }),
    ...(failure === undefined ? {} : { notRestarted: failure }),
  };
};

/**
 * A secret's answer: declined, or saved into the very project it was asked for, with what
 * restarted and what did not. An answer naming no project or another one — a client that wrote
 * elsewhere — is none.
 */
const secretOutcome = (
  answer: unknown,
  ask: Pick<SecretAsk, "environment">,
): SecretOutcome | null => {
  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) return null;
  const { outcome, projectId, restarted, notRestarted } = answer as Record<string, unknown>;
  if (outcome === "declined") return { kind: "declined" };
  if (outcome !== "saved" || projectId !== ask.environment.projectId) return null;
  const restarts = savedRestarts(restarted, notRestarted);
  return restarts === null ? null : { kind: "saved", ...restarts };
};

/** A service the person's card did not restart after a save, and why — bounded; `null` for none. */
const restartFailure = (notRestarted: unknown): NotRestartedService | null => {
  if (typeof notRestarted !== "object" || notRestarted === null) return null;
  const { hostname, reason } = notRestarted as Record<string, unknown>;
  if (typeof hostname !== "string" || typeof reason !== "string") return null;
  return {
    hostname: hostname.slice(0, HOSTNAME_MAX),
    reason: reason.replace(/\s+/gu, " ").trim().slice(0, RESTART_REASON_MAX),
  };
};

/**
 * A value's answer: saved or declined, a save perhaps with what the card restarted and the service
 * it did not (`{ outcome: "saved", restarted?, notRestarted? }`); anything more is none.
 */
const vaultOutcome = (
  answer: unknown,
): ({ readonly outcome: VaultOutcome } & SavedRestarts) | null => {
  const plain = cardOutcome<VaultOutcome>(answer, ["saved", "declined"]);
  if (plain !== null) return { outcome: plain };
  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) return null;
  const { outcome, restarted, notRestarted, ...rest } = answer as Record<string, unknown>;
  if (outcome !== "saved" || Object.keys(rest).length > 0) return null;
  const restarts = savedRestarts(restarted, notRestarted);
  return restarts === null ? null : { outcome: "saved", ...restarts };
};

/**
 * The agent's line on a value it asked for: where it went, what restarted and what did not, or
 * that it was not given. Never a value.
 */
export const vaultAnswerWords = (
  ask: Pick<VaultAsk, "key" | "scope">,
  outcome: VaultOutcome,
  restarts: SavedRestarts = {},
): string =>
  `Secret request for ${ask.key}: ${outcome === "saved" ? `saved to ${vaultPlace(ask)}${restartWords(restarts)}` : "declined"}.`;

/**
 * The agent's line on an origin it asked for: where the person keeps the code, in the words zcp's
 * `zerops_origin` names (kept on GitHub, kept in Mate, followed), and connected or not, which a zcp
 * older than those words reads. Never a token.
 */
export const originAnswerWords = (
  ask: Pick<OriginAsk, "url" | "repo">,
  outcome: OriginOutcome,
): string =>
  `Origin request for ${ask.url}: ${outcome === "connected" ? `kept on GitHub, connected as ${ask.repo}` : "kept in Mate and only followed, not connected"}.`;

/** The agent's line on a repository it asked to connect to GitHub: where it went, or that it did not. */
export const mirrorAnswerWords = (ask: Pick<MirrorAsk, "repo">, outcome: MirrorOutcome): string =>
  outcome.kind === "connected"
    ? `The person connected ${ask.repo} to GitHub at ${outcome.url}.`
    : `The person declined connecting ${ask.repo} to GitHub.`;

/** The longest remote address the agent's line carries (as `EngineAnswer`'s). */
const REMOTE_URL_MAX = 512;
const isRemoteUrl = Schema.is(HqRemoteUrl);

/**
 * A remote address as HQ keeps one — https, a host, no whitespace, credentials, query or fragment
 * — normalized; `null` for any other, or one too long.
 */
const remoteAddress = (url: unknown): string | null =>
  typeof url === "string" && url.length <= REMOTE_URL_MAX && isRemoteUrl(url)
    ? new URL(url).href
    : null;

/** A mirror ask's answer (`{ outcome: "connected", url }` or `{ outcome: "declined" }`); anything more is none. */
const mirrorOutcome = (answer: unknown): MirrorOutcome | null => {
  if (cardOutcome(answer, ["declined"]) === "declined") return { kind: "declined" };
  if (typeof answer !== "object" || answer === null || Array.isArray(answer)) return null;
  const { outcome, url, ...rest } = answer as Record<string, unknown>;
  const address = remoteAddress(url);
  return outcome === "connected" && address !== null && Object.keys(rest).length === 0
    ? { kind: "connected", url: address }
    : null;
};

/**
 * An ask on a card is answered there: the person's client does the work as them (writes the
 * value, connects the origin), and the engine is told only how it ended. The record keeps who and
 * when in the engine's own words — never the client's, which could carry a value or a token — and
 * the agent hears its line in a run of its own, a wake that joins the run that asked while that is
 * the latest — and goes on for whom that run acted, as a self turn does: an answer to a task's ask
 * is the task's work, held to its limits.
 */
const answerOnCard = (
  b: StepBuilder,
  request: OpenRequest,
  ended: {
    readonly declined: boolean;
    readonly summary: string;
    readonly wake: string;
    readonly text: string;
  },
): void => {
  b.emit({
    _tag: "RequestAnswered",
    runId: request.runId,
    requestId: request.id,
    by: b.envelope.principal,
    summary: ended.summary,
  });
  if (ended.declined) {
    b.emit({
      _tag: "RequestClosed",
      runId: request.runId,
      requestId: request.id,
      state: "declined",
    });
  }
  const wake = deriveWakeId(b.state.conversationId, ended.wake, request.id);
  const joins = request.runId === b.state.latestRunId ? request.runId : null;
  b.emit({
    _tag: "WakeArmed",
    wakeId: wake,
    kind: ended.wake,
    dueAt: b.now,
    cron: null,
    principal: joins === null ? b.envelope.principal : request.principal,
    joins,
    text: ended.text,
  });
  b.result = { ...b.result, requestId: request.id, runId: request.runId, wakeId: wake };
};

export const answerVault = (
  b: StepBuilder,
  request: OpenRequest,
  command: Extract<Command, { _tag: "Answer" }>,
): void => {
  const answered = vaultOutcome(command.answer);
  if (answered === null || request.vault === undefined) {
    throw new Rejected(
      "not-answerable",
      "A value asked of the person is answered saved or declined, never with the value.",
    );
  }
  const { outcome, ...restarts } = answered;
  const { notRestarted } = restarts;
  answerOnCard(b, request, {
    declined: outcome === "declined",
    summary:
      outcome === "saved"
        ? `Saved to ${vaultPlace(request.vault)}${notRestarted === undefined ? "" : `; ${notRestarted.hostname} didn't restart`}`
        : "Declined",
    wake: VAULT_ANSWER_WAKE,
    text: vaultAnswerWords(request.vault, outcome, restarts),
  });
};

export const answerSecret = (
  b: StepBuilder,
  request: OpenRequest,
  command: Extract<Command, { _tag: "Answer" }>,
): void => {
  const outcome =
    request.secret === undefined ? null : secretOutcome(command.answer, request.secret);
  if (outcome === null || request.secret === undefined) {
    throw new Rejected(
      "not-answerable",
      "A secret for stage or production is answered declined, or saved into the project it was asked for — never with the value.",
    );
  }
  answerOnCard(b, request, {
    declined: outcome.kind === "declined",
    summary:
      outcome.kind === "declined"
        ? "Declined"
        : `Saved to ${secretPlace(request.secret)}${outcome.notRestarted === undefined ? "" : `; ${outcome.notRestarted.hostname} didn't restart`}`,
    wake: VAULT_ANSWER_WAKE,
    text: secretAnswerWords(request.secret, outcome),
  });
};

export const answerOrigin = (
  b: StepBuilder,
  request: OpenRequest,
  command: Extract<Command, { _tag: "Answer" }>,
): void => {
  const outcome = cardOutcome<OriginOutcome>(command.answer, ["connected", "declined"]);
  if (outcome === null || request.origin === undefined) {
    throw new Rejected(
      "not-answerable",
      "An origin asked of the person is answered kept on GitHub or in Mate, never with a token.",
    );
  }
  answerOnCard(b, request, {
    declined: outcome === "declined",
    summary: outcome === "connected" ? "Kept on GitHub" : "Kept in Mate",
    wake: ORIGIN_ANSWER_WAKE,
    text: originAnswerWords(request.origin, outcome),
  });
};

export const answerMirror = (
  b: StepBuilder,
  request: OpenRequest,
  command: Extract<Command, { _tag: "Answer" }>,
): void => {
  const outcome = mirrorOutcome(command.answer);
  if (outcome === null || request.mirror === undefined) {
    throw new Rejected(
      "not-answerable",
      "A repository asked to be connected to GitHub is answered connected at its address or declined, never with a token.",
    );
  }
  answerOnCard(b, request, {
    declined: outcome.kind === "declined",
    summary: outcome.kind === "connected" ? `Connected to ${outcome.url}` : "Declined",
    wake: MIRROR_ANSWER_WAKE,
    text: mirrorAnswerWords(request.mirror, outcome),
  });
};

/** The wake that tells the agent how a value it asked for ended. */
export const VAULT_ANSWER_WAKE = "vault-answer";
/** The wake that tells the agent how an origin it asked for ended. */
export const ORIGIN_ANSWER_WAKE = "origin-answer";
/** The wake that tells the agent how a repository it asked to connect to GitHub ended. */
export const MIRROR_ANSWER_WAKE = "mirror-answer";
