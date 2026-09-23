/**
 * What a stop runs, as a fact (DESIGN §4.7 "Deployment", D6).
 *
 * Existence comes from the platform's pushed deployment facet, not from the
 * group's deploy pass: the datastream already says whether a service has an
 * active deploy, when it was activated and what it is called, and it says so
 * without Gitea. The pass's REST read (`userData`) still names a version where
 * it answered first, because the pushed name is not yet confirmed to be the
 * app version's own name (OQ-3).
 *
 * The one negative, "Nothing deployed yet", is earned: only a complete listing
 * whose every runtime service is observed with no active deploy says it. A
 * facet not yet read is `unread`, and the stop holds its line; a facet the
 * platform will not show fails the stop rather than proving it empty.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module flow/deployment
 */
import { isZcpService } from "../api.ts";
import { serviceRecordToZeropsService } from "../data/dto.ts";
import type {
  CollectionRead,
  IngestionStamp,
  InterestState,
  ServiceDeployInfo,
  ServiceRecord,
} from "../data/types.ts";
import { deployWord } from "../groupDeploys.ts";
import {
  deployedCommit,
  deployedVersion,
  shortCommit,
  type DeployedVersion,
  type EnvironmentRow,
  type GroupRowTone,
} from "../groupRows.ts";
import type { Freshness, Known, Shown, Stamp } from "../knowledge/known.ts";
import { knownPresentation, type KnownSurface } from "../knowledge/presentation.ts";

export type Deployment =
  /** The deployment facet is observed and names no active deploy. */
  | { readonly kind: "none" }
  | {
      readonly kind: "running";
      /** When the active deploy was activated, as the platform pushed it. */
      readonly activatedAt: string | null;
      /** The pushed name, and the commit only where the platform named none. */
      readonly version: DeployedVersion;
    };

export const NOTHING_DEPLOYED = "Nothing deployed yet";
export const CHECKING_WHAT_RUNS = "Checking what runs here…";
/** A stop's word for a deploy nobody has reported a build status for. */
export const RUNNING_WORD = "Running";

export const DEPLOYMENT_SURFACE: KnownSurface<Deployment> = {
  subject: "what runs here",
  entity: "service",
  source: "zerops",
  checking: CHECKING_WHAT_RUNS,
  negative: (deployment) => (deployment.kind === "none" ? NOTHING_DEPLOYED : null),
};

/** The version a pushed deploy names: its name, else its commit. */
function pushedVersion(deploy: ServiceDeployInfo): DeployedVersion {
  const named = deployedVersion(deploy.name ?? undefined);
  if (named.label !== undefined) return named;
  const sha = deployedCommit(deploy.commit ?? undefined);
  if (sha === undefined) return named;
  const commit = shortCommit(sha);
  return { name: undefined, commit, sha, taggedBy: undefined, label: commit };
}

/**
 * A never-deployed runtime still carries an `ACTIVE` version whose source is
 * `NONE` (measured on `z3-eval`'s `s3git1`); it runs nothing.
 */
const runsNothing = (deploy: ServiceDeployInfo | null): deploy is null =>
  deploy === null || deploy.source === "NONE";

const toStamp = (stamp: IngestionStamp): Stamp => ({
  ordinal: stamp.receiptOrdinal,
  atMs: stamp.observedAtMs,
});

const newer = (left: Stamp | null, right: Stamp): Stamp =>
  left === null || right.ordinal > left.ordinal ? right : left;

/** What one service contributes to its stop. */
type ServiceAnswer =
  | { readonly kind: "not-a-stop" }
  | { readonly kind: "pending" }
  /** The platform shows the service but will not say what it runs: no answer, never a none. */
  | { readonly kind: "withheld"; readonly reason: string; readonly atMs: number }
  | { readonly kind: "none"; readonly asOf: Stamp }
  | {
      readonly kind: "running";
      readonly hostname: string;
      readonly deploy: ServiceDeployInfo;
      readonly asOf: Stamp;
    };

function serviceAnswer(knowledge: CollectionRead<ServiceRecord>["value"][number]): ServiceAnswer {
  // A service the platform no longer shows is not what the stop runs.
  if (knowledge.knowledge === "unavailable") return { kind: "not-a-stop" };
  if (knowledge.knowledge === "unresolved") return { kind: "pending" };
  const record = knowledge.record;
  const service = serviceRecordToZeropsService(record);
  if (service === null) return { kind: "pending" };
  // The platform's core and the Mate's own container deploy nothing the group declared.
  if (service.isSystem === true || isZcpService(service)) return { kind: "not-a-stop" };
  const facet = record.deployment;
  if (facet.knowledge === "unavailable")
    return { kind: "withheld", reason: facet.reason, atMs: facet.stamp.observedAtMs };
  if (facet.knowledge === "unresolved" || facet.fields.activeDeploy === undefined)
    return { kind: "pending" };
  const deploy = facet.fields.activeDeploy;
  const asOf = toStamp(facet.stamp);
  return runsNothing(deploy)
    ? { kind: "none", asOf }
    : { kind: "running", hostname: service.name, deploy, asOf };
}

/** The worst of the interests the listing needs, which is what vouches for it. */
type SourceState =
  | { readonly kind: "observing" }
  | { readonly kind: "establishing"; readonly sinceMs: number }
  | { readonly kind: "paused"; readonly reason: "background" | "offline" | "no-leases" }
  | { readonly kind: "recovering"; readonly retryAtMs: number; readonly attempt: number }
  | {
      readonly kind: "failed";
      readonly reason: string;
      readonly attempts: number;
      readonly retryAtMs: number | null;
    };

const SEVERITY: Record<SourceState["kind"], number> = {
  observing: 0,
  establishing: 1,
  paused: 2,
  recovering: 3,
  failed: 4,
};

function sourceOf(interest: InterestState): SourceState {
  switch (interest.status) {
    case "observing":
      return { kind: "observing" };
    case "establishing":
      return { kind: "establishing", sinceMs: interest.startedAtMs };
    case "paused":
      return { kind: "paused", reason: interest.reason };
    case "recovering":
      return { kind: "recovering", retryAtMs: interest.nextRetryAtMs, attempt: interest.attempt };
    case "failed":
      return {
        kind: "failed",
        reason: interest.reason,
        attempts: interest.attempts,
        retryAtMs: interest.retryAtMs,
      };
  }
}

function worstSource(required: ReadonlyArray<InterestState>): SourceState {
  let worst: SourceState = { kind: "observing" };
  for (const interest of required) {
    const source = sourceOf(interest);
    if (SEVERITY[source.kind] > SEVERITY[worst.kind]) worst = source;
  }
  return worst;
}

/** How current a value is, by the source that delivered it (DESIGN §3.5). */
function freshnessOf(source: SourceState, nowMs: number): Freshness {
  switch (source.kind) {
    case "observing":
      return { kind: "live" };
    case "establishing":
      return { kind: "revalidating", sinceMs: source.sinceMs };
    case "paused":
      return { kind: "paused", by: source.reason === "offline" ? "offline" : "background" };
    case "recovering":
      return {
        kind: "stale",
        reason: { kind: "source-recovering", retryAtMs: source.retryAtMs },
        sinceMs: nowMs,
      };
    case "failed":
      return {
        kind: "stale",
        reason: {
          kind: "revalidation-failed",
          failure: { kind: "transport", detail: source.reason },
          attempt: source.attempts,
          retryAtMs: source.retryAtMs,
        },
        sinceMs: nowMs,
      };
  }
}

/** What a stop is while no value is known for it (DESIGN §3.5). */
function notYetKnown(source: SourceState, nowMs: number): Known<Deployment> {
  switch (source.kind) {
    case "observing":
      return { state: "unread", waitingFor: null };
    case "establishing":
      return { state: "reading", sinceMs: source.sinceMs, attempt: 1 };
    case "recovering":
      return { state: "reading", sinceMs: source.retryAtMs, attempt: source.attempt };
    case "paused":
      return {
        state: "unread",
        waitingFor:
          source.reason === "background"
            ? "visible"
            : source.reason === "offline"
              ? "online"
              : null,
      };
    case "failed":
      return {
        state: "failed",
        failure: { kind: "transport", detail: source.reason },
        atMs: nowMs,
        attempt: source.attempts,
        retryAtMs: source.retryAtMs,
      };
  }
}

/**
 * One stop's deployment, from its project's service listing.
 *
 * The first runtime service with an active deploy, by hostname, names the
 * stop — the same rule `environmentRow` follows. `none` needs a complete
 * listing and every runtime service observed with nothing deployed.
 */
export function stopDeployment(
  read: CollectionRead<ServiceRecord> | undefined,
  nowMs: number,
): Known<Deployment> {
  if (read === undefined) return { state: "unread", waitingFor: null };
  const source = worstSource(read.observation.required);
  const answers = read.value.map(serviceAnswer);
  // Filtered into a fresh array, so the sort touches nothing else (`toSorted` is not in Hermes).
  const running = answers
    .filter((answer) => answer.kind === "running")
    .sort((left, right) => left.hostname.localeCompare(right.hostname))[0];
  if (running !== undefined)
    return {
      state: "known",
      value: {
        kind: "running",
        activatedAt: running.deploy.activatedAt,
        version: pushedVersion(running.deploy),
      },
      asOf: running.asOf,
      coverage: "complete",
      freshness: freshnessOf(source, nowMs),
    };
  const listed =
    read.query.status === "observed" && read.query.coverage.kind === "exhausted-traversal";
  if (!listed || answers.some((answer) => answer.kind === "pending"))
    return notYetKnown(source, nowMs);
  const withheld = answers.find((answer) => answer.kind === "withheld");
  if (withheld !== undefined)
    return {
      state: "failed",
      failure: { kind: "refused", code: withheld.reason, words: "" },
      atMs: withheld.atMs,
      attempt: 1,
      retryAtMs: null,
    };
  let asOf: Stamp | null = read.query.status === "observed" ? toStamp(read.query.stamp) : null;
  for (const answer of answers) if (answer.kind === "none") asOf = newer(asOf, answer.asOf);
  return {
    state: "known",
    value: { kind: "none" },
    asOf: asOf ?? { ordinal: 0, atMs: 0 },
    coverage: "complete",
    freshness: freshnessOf(source, nowMs),
  };
}

/** What a stop's row draws: the badge, its word, and the line under the name. */
export interface StopView {
  readonly tone: GroupRowTone;
  /** The badge's word, which its tooltip and accessible name carry. */
  readonly word: string;
  readonly line: string;
  /** What runs there, when anything is known to; the menu spells it out. */
  readonly version: DeployedVersion | undefined;
  /** How long the line waits before it shows: a quick answer never flickers a placeholder. */
  readonly afterMs: number;
}

function runningView(
  pushed: DeployedVersion | undefined,
  row: EnvironmentRow | undefined,
): StopView {
  const version = row !== undefined && row.version.label !== undefined ? row.version : pushed;
  const tone = row?.tone ?? "neutral";
  return {
    tone,
    word: deployWord(tone) ?? RUNNING_WORD,
    line: version?.label ?? RUNNING_WORD,
    version,
    afterMs: 0,
  };
}

/**
 * A stop's row from its deployment and, where the deploy half read one, its
 * environment row. The platform decides whether anything runs; the row names
 * it and colours it. A version the row read stands for a deploy while the
 * platform's own answer is still on its way — it is evidence of one, never of
 * none.
 */
export function stopView(input: {
  readonly deployment: Shown<Deployment>;
  readonly row: EnvironmentRow | undefined;
  readonly nowMs: number;
}): StopView {
  const { deployment, row } = input;
  if (deployment.state === "known" && deployment.value.kind === "running")
    return runningView(deployment.value.version, row);
  const presentation = knownPresentation(deployment, DEPLOYMENT_SURFACE, {
    nowMs: input.nowMs,
    updateOffered: false,
  });
  if (presentation.negative !== null)
    return {
      tone: "neutral",
      word: presentation.negative,
      line: presentation.negative,
      version: undefined,
      afterMs: 0,
    };
  if (row !== undefined && row.version.label !== undefined) return runningView(undefined, row);
  const text = presentation.message?.text ?? CHECKING_WHAT_RUNS;
  return {
    tone: "neutral",
    word: text,
    line: text,
    version: undefined,
    afterMs: presentation.message?.afterMs ?? 0,
  };
}
