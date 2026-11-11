/**
 * The two asks a Mate raises about its application's production, read from their sources: creating
 * the services production lacks (`service.create`), and releasing what waits for it
 * (`release.offer`). Neither gives the Mate any authority: the person creates with their own
 * access, and releases in the review every other door opens. What each card says is read from
 * HQ's plan, the flow's releases, the operation that creates and HQ's decision record — never
 * remembered by a card, so a reload draws the same.
 */
import type { ServiceCreation } from "@t3tools/client-runtime/data";
import type { ReleaseEndedEvent } from "@t3tools/client-runtime/zerops";
import { formatRunClock } from "@t3tools/client-runtime/zerops";
import type { ReleaseServicePlan } from "@t3tools/shared/hqRelease";

import { type AskState, answeredWords, namesWords, notNowWords } from "../../ask/ask.logic";
import { serviceTypeWords } from "../vault/vaultGroups.logic";
import type { ProposalDecision } from "./proposal.logic";

// ---------------------------------------------------------------------------
// service.create
// ---------------------------------------------------------------------------

/** "Create db in production", "Create db and cache in production". */
export function serviceCreateTitle(services: ReadonlyArray<string>): string {
  return `Create ${namesWords(services)} in production`;
}

/** On the card, under its Production chip, the place is already said: "Create db and cache". */
export function serviceCreateCardTitle(services: ReadonlyArray<string>): string {
  return `Create ${namesWords(services)}`;
}

/**
 * What a service HQ's plan creates is, as a person reads it, from the settings the plan holds:
 * "Database · PostgreSQL 18, highly available". `null` where the plan names no type.
 */
export function plannedServiceWords(settings: Readonly<Record<string, unknown>>): string | null {
  const type = typeof settings.type === "string" ? settings.type.trim() : "";
  if (type === "") return null;
  const words = serviceTypeWords(type);
  return settings.mode === "HA" ? `${words}, highly available` : words;
}

/** HQ's plan as the create card reads it. */
export type ServiceCreatePlan =
  /** HQ has not answered what production lacks. */
  | { readonly kind: "reading" }
  /** HQ's plan cannot be read now: why, in HQ's words. */
  | { readonly kind: "unreadable"; readonly words: string }
  | { readonly kind: "ready"; readonly plan: ReleaseServicePlan };

/** The plan narrowed to the asked services it still creates: what the card's import runs. */
export function askedCreations(
  plan: ReleaseServicePlan,
  services: ReadonlyArray<string>,
): ReleaseServicePlan {
  return {
    ...plan,
    operations: plan.operations.filter(
      (operation) => operation.kind === "create" && services.includes(operation.service),
    ),
  };
}

/** The create this tab runs for the card, as its operation says it stands. */
export type ServiceCreateRun =
  | { readonly kind: "none" }
  /** Sent, or accepted and its processes not ended: `sinceMs` once Zerops took it. */
  | { readonly kind: "working"; readonly sinceMs: number | undefined }
  /** Every process of it finished: they exist, before HQ's plan is read again. */
  | { readonly kind: "created" }
  | { readonly kind: "failed"; readonly words: string };

/**
 * A create this tab runs, from its operation's record (`serviceCreation`): the one reading every
 * surface that follows a create says it by. `sending` covers the press before the operation has a
 * record.
 */
export function serviceCreateRunOf(creation: ServiceCreation, sending: boolean): ServiceCreateRun {
  const { progress } = creation;
  if (progress.stage === "unknown")
    return sending ? { kind: "working", sinceMs: undefined } : { kind: "none" };
  if (
    progress.stage === "submitting" ||
    progress.stage === "accepted" ||
    progress.stage === "reflected" ||
    (progress.stage === "uncertain" && progress.next === "asking-owner")
  )
    return { kind: "working", sinceMs: creation.acceptedAtMs };
  if (progress.stage === "done" && progress.outcome === "succeeded") return { kind: "created" };
  return {
    kind: "failed",
    words:
      serviceCreateTrouble({
        stage: progress.stage,
        ...("outcome" in progress ? { outcome: progress.outcome } : {}),
        ...("reason" in progress ? { reason: progress.reason } : {}),
      }) ?? "Zerops did not create it.",
  };
}

export interface ServiceCreateRow {
  readonly label: string;
  readonly value: string;
}

export interface ServiceCreateView {
  readonly state: AskState;
  /** The asked services production still lacks, as HQ's plan says; all of them until it answers. */
  readonly remaining: ReadonlyArray<string>;
  /** What exactly happens, one fact a row. */
  readonly rows: ReadonlyArray<ServiceCreateRow>;
  /** Why the press cannot be pressed yet; absent when it can. */
  readonly blocked: string | undefined;
  /** Whether a failed card offers *Try again*: a new press, by someone who may. */
  readonly retry: boolean;
}

const runsWords = (services: ReadonlyArray<string>) =>
  `${namesWords(services)} ${services.length === 1 ? "runs" : "run"} in production`;

/**
 * The create card from its sources. Done once HQ's plan creates none of the asked services (they
 * exist, whoever made them) or HQ recorded the approval done; working while this tab's create
 * runs, with the time since Zerops took it; failed in Zerops' words, with *Try again*; someone
 * else's where HQ does not offer the viewer the release; else waiting, its press held until HQ's
 * plan is read.
 */
export function serviceCreateView(input: {
  readonly services: ReadonlyArray<string>;
  readonly plan: ServiceCreatePlan;
  /** HQ's offer of the release to the viewer; `undefined` while HQ has not said. */
  readonly permission: { readonly allowed: boolean; readonly reason?: string } | undefined;
  readonly decision: ProposalDecision | undefined;
  /** HQ answered what was decided of it: until then nothing is offered. */
  readonly decisionKnown: boolean;
  readonly run: ServiceCreateRun;
  readonly nowMs: number;
  /** The release production runs, where one does: what a creation leaves as it is. */
  readonly liveTag: string | undefined;
  /** Who decided it, by name, and when, as the conversation's clock says it. */
  readonly by: string | null;
  readonly at: string | null;
}): ServiceCreateView {
  const { services, plan, decision, run } = input;
  const created =
    plan.kind === "ready"
      ? plan.plan.operations.flatMap((operation) =>
          operation.kind === "create" ? [operation] : [],
        )
      : [];
  const remaining =
    plan.kind === "ready"
      ? services.filter((service) => created.some((operation) => operation.service === service))
      : services;
  const rows: Array<ServiceCreateRow> = [
    ...services.map((service) => {
      const operation = created.find((entry) => entry.service === service);
      return {
        label: service,
        // Until HQ's plan answers, what it is stays unsaid: the row holds its place. HQ reads no
        // plan for someone it does not offer the release.
        value:
          plan.kind === "reading" && input.permission?.allowed !== false
            ? ""
            : plan.kind === "ready" && operation === undefined
              ? "runs in production"
              : ((operation === undefined ? null : plannedServiceWords(operation.settings)) ??
                "a new service"),
      };
    }),
    {
      label: "billed",
      value:
        remaining.length <= 1
          ? "one more service, by these settings"
          : `${String(remaining.length)} more services, by these settings`,
    },
    {
      label: "deploys",
      value:
        input.liveTag === undefined ? "nothing" : `nothing: production stays on ${input.liveTag}`,
    },
  ];
  const mayCreate = input.permission?.allowed === true;
  const view = (state: AskState, more: Partial<ServiceCreateView> = {}): ServiceCreateView => ({
    state,
    remaining,
    rows,
    blocked: undefined,
    retry: false,
    ...more,
  });
  const settled = decision !== undefined && decision.state !== "declined";

  if (run.kind === "working") {
    const elapsed =
      run.sinceMs === undefined ? "" : ` ${formatRunClock(input.nowMs - run.sinceMs)}`;
    return view({
      kind: "working",
      words: `Creating ${namesWords(remaining.length === 0 ? services : remaining)} in production…${elapsed}`,
      pressed: null,
    });
  }
  if (
    run.kind === "created" ||
    (plan.kind === "ready" && remaining.length === 0) ||
    decision?.state === "done"
  )
    // The line says it once: what it would have done is no longer a plan.
    return view(
      {
        kind: "done",
        words: settled
          ? answeredWords(runsWords(services), input.by, input.at)
          : runsWords(services),
        told: null,
      },
      { rows: [], remaining: [] },
    );
  if (run.kind === "failed")
    return view({ kind: "failed", words: run.words }, { retry: mayCreate });
  if (decision?.state === "declined")
    return view({ kind: "notNow", words: notNowWords(input.by, input.at) });
  if (input.permission?.allowed === false)
    return view({
      kind: "othersToAnswer",
      words: input.permission.reason ?? "Only someone who can release to production can create it.",
    });
  const blocked = !input.decisionKnown
    ? "Reading what was decided…"
    : input.permission === undefined
      ? "Reading your access to production…"
      : plan.kind === "reading"
        ? "Reading what production lacks…"
        : plan.kind === "unreadable"
          ? plan.words
          : undefined;
  if (decision?.state === "failed")
    return view({ kind: "failed", words: decision.message }, { retry: mayCreate, blocked });
  // Approved in a tab that is gone: HQ's plan still creates it, so it was not created.
  if (decision?.state === "running" && plan.kind === "ready")
    return view(
      { kind: "failed", words: `Zerops did not create ${namesWords(remaining)}.` },
      { retry: mayCreate },
    );
  if (decision?.state === "running")
    return view({ kind: "working", words: "Reading what production lacks…", pressed: null });
  return view({ kind: "waiting" }, { blocked });
}

// ---------------------------------------------------------------------------
// release.offer
// ---------------------------------------------------------------------------

/** "Release v0.1.6 to production". */
export function releaseOfferTitle(suggestion: string): string {
  return `Release ${suggestion} to production`;
}

/** On the card, under its Production chip, the place is already said: "Release v0.1.6". */
export function releaseOfferCardTitle(suggestion: string): string {
  return `Release ${suggestion}`;
}

/**
 * The card's one quiet line over its changes: how many go out and since which release, and what
 * the release creates first. "2 changes since v0.1.5 · creates cache first". `null` where the
 * card knows none of it yet.
 */
export function releaseOfferSummary(input: {
  readonly changes: number;
  readonly live: string | undefined;
  readonly creates: ReadonlyArray<string>;
}): string | null {
  const count =
    input.changes === 0
      ? undefined
      : `${input.changes} ${input.changes === 1 ? "change" : "changes"}`;
  const parts = [
    count === undefined
      ? input.live === undefined
        ? undefined
        : `${input.live} is live now`
      : input.live === undefined
        ? count
        : `${count} since ${input.live}`,
    input.creates.length === 0 ? undefined : `creates ${namesWords(input.creates)} first`,
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? null : parts.join(" · ");
}

/** The live release offer as the card reads it from the application's flow. */
export interface ReleaseOfferLive {
  /** The recipe's `main` HQ's offer was read at; `undefined` while it is not read. */
  readonly head: string | undefined;
  /** The release name HQ suggests now; empty while HQ has not offered. */
  readonly suggestion: string;
  /** Whether Release is offered now, and why not where it is not. */
  readonly gate: { readonly allowed: boolean; readonly reason?: string } | undefined;
  /** HQ's offer of the release to the viewer; `undefined` while HQ has not said. */
  readonly permission: { readonly allowed: boolean; readonly reason?: string } | undefined;
  /** The release on its way to production now. */
  readonly inFlight: string | undefined;
  /** How many changes wait for production, where HQ counted them. */
  readonly waiting: number | undefined;
}

export interface ReleaseOfferView {
  readonly state: AskState;
  /** The release the card names: the live offer's where it moved on, else the ask's. */
  readonly suggestion: string;
  /** Collapsed to its title and one line: another ask, or nothing, took its place. */
  readonly collapsed: boolean;
  /** `main` moved since the Mate asked and no newer ask covers it: what the card now covers. */
  readonly moved: string | undefined;
  /** Why *Review release* cannot be pressed yet; absent when it can. */
  readonly blocked: string | undefined;
  /** Whether a failed card offers *Review release* again. */
  readonly again: boolean;
}

/** "v0.1.6 is live on shop.example.com", without the scheme; "v0.1.6 is live" where unread. */
function liveWords(tag: string, address: string | undefined): string {
  const host = address?.replace(/^https?:\/\//u, "").replace(/\/$/u, "");
  return host === undefined || host === "" ? `${tag} is live` : `${tag} is live on ${host}`;
}

/**
 * The release card from its sources. A release made after the Mate asked speaks first: live
 * (done), on its way (working), or not live with the cause the flow knows (failed, *Review
 * release* again). Else Not now as HQ records it; replaced where a newer ask stands in the
 * conversation or nothing waits any more; someone else's where HQ does not offer the viewer the
 * release; else waiting — re-read against the live offer where `main` moved on.
 */
export function releaseOfferView(input: {
  readonly params: { readonly head: string; readonly suggestion: string };
  /** When the Mate asked: the card's own moment in the conversation. */
  readonly askedAt: string;
  readonly live: ReleaseOfferLive | undefined;
  /** How the application's releases ended, as the flow says (`releaseEndedEvents`). */
  readonly ended: ReadonlyArray<ReleaseEndedEvent>;
  /** The releases made, newest first: their names and when HQ made them. */
  readonly releases: ReadonlyArray<{ readonly tag: string; readonly taggedAt: string }>;
  /** A newer release ask stands in the conversation. */
  readonly newerAsk: boolean;
  readonly decision: ProposalDecision | undefined;
  readonly decisionKnown: boolean;
  /** Where production answers, once known. */
  readonly address: string | undefined;
  readonly by: string | null;
  readonly at: string | null;
}): ReleaseOfferView {
  const { params, live, decision } = input;
  const asked = Date.parse(input.askedAt);
  const movedOn = live?.head !== undefined && live.head !== params.head;
  const suggestion = movedOn && live.suggestion.trim() !== "" ? live.suggestion : params.suggestion;
  const view = (state: AskState, more: Partial<ReleaseOfferView> = {}): ReleaseOfferView => ({
    state,
    suggestion,
    collapsed: false,
    moved: undefined,
    blocked: undefined,
    again: false,
    ...more,
  });
  const mayReview = live?.permission?.allowed !== false;

  // What was released after the ask says how it came out: the first release that did not fail,
  // else the newest that did.
  const after = input.releases
    .filter((release) => Date.parse(release.taggedAt) > asked)
    .toReversed();
  const endOf = (tag: string) => input.ended.find((event) => event.tag === tag);
  const went = after.find((release) => endOf(release.tag)?.outcome !== "failed");
  if (went !== undefined) {
    if (endOf(went.tag)?.outcome === "live")
      return view(
        { kind: "done", words: liveWords(went.tag, input.address), told: null },
        { suggestion: went.tag },
      );
    // The newest release with no end yet is on its way; an earlier one production moved past.
    return went.tag === input.releases[0]?.tag
      ? view(
          { kind: "working", words: `Releasing ${went.tag} to production…`, pressed: null },
          { suggestion: went.tag },
        )
      : view(
          { kind: "done", words: `Released as ${went.tag}`, told: null },
          { suggestion: went.tag },
        );
  }
  if (
    live?.inFlight !== undefined &&
    !input.releases.some((release) => release.tag === live.inFlight)
  )
    return view(
      { kind: "working", words: `Releasing ${live.inFlight} to production…`, pressed: null },
      { suggestion: live.inFlight },
    );
  const failed = after.at(-1);
  if (failed !== undefined) {
    const cause = endOf(failed.tag)?.cause;
    return view(
      {
        kind: "failed",
        words: `${failed.tag} didn't go live${cause === undefined ? "" : `: ${cause}`}`,
      },
      { again: mayReview && live?.gate?.allowed === true, suggestion: failed.tag },
    );
  }
  if (decision?.state === "declined")
    return view({ kind: "notNow", words: notNowWords(input.by, input.at) }, { collapsed: true });
  if (input.newerAsk)
    return view(
      { kind: "replaced", words: "Main moved on: see the newer ask" },
      { collapsed: true, suggestion: params.suggestion },
    );
  if (live?.gate !== undefined && live.waiting === 0 && !live.gate.allowed)
    return view(
      { kind: "replaced", words: "Nothing waits for production any more" },
      { collapsed: true, suggestion: params.suggestion },
    );
  if (live?.permission?.allowed === false)
    return view({
      kind: "othersToAnswer",
      words: live.permission.reason ?? "Only someone who can release to production can do this.",
    });
  const blocked = !input.decisionKnown
    ? "Reading what was decided…"
    : live === undefined || live.gate === undefined
      ? "Reading what waits for production…"
      : live.gate.allowed
        ? undefined
        : (live.gate.reason ?? "Release is not offered now.");
  return view(
    { kind: "waiting" },
    {
      blocked,
      // The card's own line counts what waits: this one only says the ask is older than it.
      moved: movedOn ? "Main moved on since: this covers what waits now." : undefined,
    },
  );
}

/** What a create that ended says of itself; `null` once every service it began exists. */
export function serviceCreateTrouble(end: {
  readonly stage: string;
  readonly outcome?: string;
  readonly reason?: string | null;
}): string | null {
  switch (end.stage) {
    case "done":
      return end.outcome === "succeeded" ? null : (end.reason ?? "Zerops did not create it.");
    case "refused":
      return end.reason ?? "Zerops refused the import.";
    case "unsent":
      return end.reason ?? "Zerops did not take the import. Try again.";
    default:
      return "The create could not be followed. Check production's services before trying again.";
  }
}
