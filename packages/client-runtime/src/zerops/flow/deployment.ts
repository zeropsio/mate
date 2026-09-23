/**
 * What a stop runs, as a fact (DESIGN §4.7 "Deployment", D6).
 *
 * Existence comes from the platform's deployment facet, not from the group's
 * deploy pass, and without Gitea. A native frame states the active version's
 * id, status and times but not its source or name (A14): a version whose
 * source nobody has stated yet is pending, never running and never none. The
 * pass's REST read (`userData`) still names a version where it answered first.
 *
 * The project's running processes say the rest (A11). While a `stack.build`
 * runs for a service, the service is deploying the version it builds, whose
 * name is the commit on a Mate's deploys. Once the active version's id is the
 * one a build named, that name is what runs, the build over or not.
 *
 * The one negative, "Nothing deployed yet", is earned: only a complete listing
 * whose every runtime service is observed with no active deploy, and a
 * complete process listing with no build for it, says it. A facet not yet read
 * is `unread`, and the stop holds its line; a facet the platform will not show
 * fails the stop rather than proving it empty.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module flow/deployment
 */
import { isZcpService } from "../containerAddress.ts";
import { serviceRecordToZeropsService } from "../data/dto.ts";
import type {
  CollectionRead,
  IngestionStamp,
  InterestState,
  LeaseAdmissionError,
  ProcessRecord,
  ServiceDeployInfo,
  ServiceRecord,
  ServiceRef,
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
import type { FailureReason, Freshness, Known, Shown, Stamp } from "../knowledge/known.ts";
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
    }
  /** A build for the service runs: the version it builds, named by the build (A11). */
  | { readonly kind: "deploying"; readonly version: DeployedVersion };

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

/** What one service contributes to its stop. */
type ServiceAnswer =
  | { readonly kind: "not-a-stop" }
  | { readonly kind: "pending" }
  /** The platform shows the service but will not say what it runs: no answer, never a none. */
  | { readonly kind: "withheld"; readonly reason: string; readonly atMs: number }
  | { readonly kind: "none"; readonly asOf: Stamp }
  /** An active version whose source nobody stated (A14): only a build's name can say it runs. */
  | { readonly kind: "unstated"; readonly deploy: ServiceDeployInfo; readonly asOf: Stamp }
  | { readonly kind: "running"; readonly deploy: ServiceDeployInfo; readonly asOf: Stamp };

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
  if (runsNothing(deploy)) return { kind: "none", asOf };
  // A version whose source nobody stated may be that `NONE` one: a native
  // frame names only its id, status and times (A14). Neither running nor none.
  if (deploy.source === null) return { kind: "unstated", deploy, asOf };
  return { kind: "running", deploy, asOf };
}

/** The worst of the reads a stop needs, which is what vouches for it. */
type SourceState =
  | { readonly kind: "observing" }
  | { readonly kind: "establishing"; readonly sinceMs: number }
  | { readonly kind: "paused"; readonly reason: "background" | "offline" | "no-leases" }
  | { readonly kind: "recovering"; readonly retryAtMs: number; readonly attempt: number }
  | {
      readonly kind: "failed";
      readonly failure: FailureReason;
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
        failure: { kind: "transport", detail: interest.reason },
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
          failure: source.failure,
          attempt: source.attempts,
          retryAtMs: source.retryAtMs,
        },
        sinceMs: nowMs,
      };
  }
}

/** What a stop, or its list of services, is while no value is known for it (DESIGN §3.5). */
function notYetKnown<T>(source: SourceState, nowMs: number): Known<T> {
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
        failure: source.failure,
        atMs: nowMs,
        attempt: source.attempts,
        retryAtMs: source.retryAtMs,
      };
  }
}

/** One runtime service of a stop, and what it runs: the deployment is a fact per service (D6). */
export interface StopService {
  readonly service: ServiceRef;
  readonly hostname: string;
  readonly deployment: Shown<Deployment>;
}

/** What a stop is read from: its project's listings, and what its builds named. */
export interface StopReads {
  readonly services: CollectionRead<ServiceRecord>;
  /** The project's running processes. */
  readonly processes: CollectionRead<ProcessRecord>;
  /** Every app version a build named, by id: a name outlives its build (A11). */
  readonly names: ReadonlyMap<string, string>;
  /** Why the platform took no demand for the running processes; they are never read then. */
  readonly refused: LeaseAdmissionError["reason"] | null;
}

/** A `stack.build` the platform reports running, and the app version it builds (A11). */
interface RunningBuild {
  readonly serviceIds: ReadonlyArray<string>;
  readonly appVersionId: string | null;
  readonly name: string | null;
  readonly asOf: Stamp;
}

/** What the project's processes say of its services' deploys. */
interface StopBuilds {
  readonly builds: ReadonlyArray<RunningBuild>;
  /** Whether the listing is complete enough to prove that no build runs. */
  readonly complete: boolean;
}

function runningBuilds(read: CollectionRead<ProcessRecord>): StopBuilds {
  let complete =
    read.query.status === "observed" && read.query.coverage.kind === "exhausted-traversal";
  const builds: Array<RunningBuild> = [];
  for (const knowledge of read.value) {
    // A process the platform no longer shows builds nothing anybody can see.
    if (knowledge.knowledge === "unavailable") continue;
    const identity = knowledge.knowledge === "observed" ? knowledge.record.identity : null;
    // A process not read far enough to say what it does may be a build.
    if (
      knowledge.knowledge !== "observed" ||
      identity?.knowledge !== "observed" ||
      identity.fields.serviceIds === undefined
    ) {
      complete = false;
      continue;
    }
    if (identity.fields.actionName !== "stack.build") continue;
    const pipeline = knowledge.record.pipeline;
    const appVersion = pipeline.knowledge === "observed" ? pipeline.fields.appVersion : null;
    builds.push({
      serviceIds: identity.fields.serviceIds,
      appVersionId: appVersion?.id ?? null,
      name: appVersion?.name ?? null,
      asOf: toStamp(identity.stamp),
    });
  }
  return { builds, complete };
}

/**
 * The names the running builds give their app versions, over the ones held: the same map while
 * no build names anything new.
 */
export function buildNames(
  held: ReadonlyMap<string, string>,
  processes: CollectionRead<ProcessRecord>,
): ReadonlyMap<string, string> {
  return namedBy(held, runningBuilds(processes).builds);
}

function namedBy(
  held: ReadonlyMap<string, string>,
  builds: ReadonlyArray<RunningBuild>,
): ReadonlyMap<string, string> {
  let names = held;
  for (const { appVersionId, name } of builds) {
    if (appVersionId === null || name === null || names.get(appVersionId) === name) continue;
    names = new Map([...names, [appVersionId, name]]);
  }
  return names;
}

/** What one listed service contributes to its stop's list. */
type ListedService =
  | { readonly kind: "not-a-stop" }
  /** Listed, but not read far enough to say whether it is a runtime service. */
  | { readonly kind: "unidentified" }
  | { readonly kind: "stop"; readonly stop: StopService };

/** The active version a facet states, whatever its source. */
function activeVersionId(answer: ServiceAnswer): string | null {
  return answer.kind === "running" || answer.kind === "unstated" ? answer.deploy.id : null;
}

/** What a stop's services are measured against: its builds, and every name one gave. */
interface StopContext extends StopBuilds {
  readonly names: ReadonlyMap<string, string>;
  readonly source: SourceState;
  readonly nowMs: number;
}

function serviceDeployment(
  answer: Exclude<ServiceAnswer, { readonly kind: "not-a-stop" }>,
  serviceId: string,
  context: StopContext,
): Shown<Deployment> {
  const { builds, complete, names, source, nowMs } = context;
  const known = (value: Deployment, asOf: Stamp): Shown<Deployment> => ({
    state: "known",
    value,
    asOf,
    coverage: "complete",
    freshness: freshnessOf(source, nowMs),
  });
  const active = activeVersionId(answer);
  // A build whose version is already the active one has deployed: the service runs it.
  const build = builds.find(
    ({ serviceIds, appVersionId }) =>
      serviceIds.includes(serviceId) && (appVersionId === null || appVersionId !== active),
  );
  if (build !== undefined)
    return known(
      { kind: "deploying", version: deployedVersion(build.name ?? undefined) },
      build.asOf,
    );
  switch (answer.kind) {
    case "running":
    case "unstated": {
      const named = active === null ? undefined : names.get(active);
      if (named !== undefined)
        return known(
          {
            kind: "running",
            activatedAt: answer.deploy.activatedAt,
            version: deployedVersion(named),
          },
          answer.asOf,
        );
      return answer.kind === "running"
        ? known(
            {
              kind: "running",
              activatedAt: answer.deploy.activatedAt,
              version: pushedVersion(answer.deploy),
            },
            answer.asOf,
          )
        : notYetKnown(source, nowMs);
    }
    case "none":
      // Nothing active is no proof while a build for it may be running unseen.
      return complete ? known({ kind: "none" }, answer.asOf) : notYetKnown(source, nowMs);
    case "withheld":
      return {
        state: "failed",
        failure: { kind: "refused", code: answer.reason, words: "" },
        atMs: answer.atMs,
        attempt: 1,
        retryAtMs: null,
      };
    case "pending":
      return notYetKnown(source, nowMs);
  }
}

function listedService(
  knowledge: CollectionRead<ServiceRecord>["value"][number],
  context: StopContext,
): ListedService {
  const answer = serviceAnswer(knowledge);
  if (answer.kind === "not-a-stop") return answer;
  if (knowledge.knowledge !== "observed") return { kind: "unidentified" };
  const service = serviceRecordToZeropsService(knowledge.record);
  if (service === null) return { kind: "unidentified" };
  const ref = knowledge.record.ref;
  return {
    kind: "stop",
    stop: {
      service: ref,
      hostname: service.name,
      deployment: serviceDeployment(answer, ref.serviceId, context),
    },
  };
}

/**
 * A stop's runtime services, by hostname, each with its own deployment. The list is known once the
 * project's listing is complete and every listed service is identified; one service still being
 * read holds its own deployment, never its neighbours'.
 */
export function stopServices(reads: StopReads, nowMs: number): Known<ReadonlyArray<StopService>> {
  const read = reads.services;
  const source = worstSource(read.observation.required);
  const stopBuilds = runningBuilds(reads.processes);
  const context: StopContext = {
    ...stopBuilds,
    names: namedBy(reads.names, stopBuilds.builds),
    // A service's deployment stands on both listings: its builds are the processes'.
    source:
      reads.refused === null
        ? worstSource([...read.observation.required, ...reads.processes.observation.required])
        : {
            kind: "failed",
            failure: { kind: "refused", code: reads.refused, words: "" },
            attempts: 1,
            retryAtMs: null,
          },
    nowMs,
  };
  const listed = read.value.map((knowledge) => listedService(knowledge, context));
  if (
    read.query.status !== "observed" ||
    read.query.coverage.kind !== "exhausted-traversal" ||
    listed.some((entry) => entry.kind === "unidentified")
  ) {
    return notYetKnown(source, nowMs);
  }
  return {
    state: "known",
    value: listed
      .flatMap((entry) => (entry.kind === "stop" ? [entry.stop] : []))
      .sort((left, right) => left.hostname.localeCompare(right.hostname)),
    asOf: toStamp(read.query.stamp),
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
  // A build runs now: what it builds is the stop's answer, whatever the row read before it.
  if (deployment.state === "known" && deployment.value.kind === "deploying") {
    const { version } = deployment.value;
    const word = deployWord("pending") ?? RUNNING_WORD;
    return {
      tone: "pending",
      word,
      line: version.label ?? word,
      version: version.label === undefined ? undefined : version,
      afterMs: 0,
    };
  }
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
