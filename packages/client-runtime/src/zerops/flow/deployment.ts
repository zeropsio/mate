/**
 * What a stop runs, as a fact (DESIGN §4.7 "Deployment", D6).
 *
 * Existence comes from the platform's deployment facet, not from the group's
 * deploy pass, and without Gitea. A native frame states the active version's
 * id, status and times but not its source or name (A14): a version whose
 * source nobody has stated yet is pending, never running and never none. The
 * pass's REST read (`userData`) names a version only where nothing else does.
 *
 * The project's running processes say the rest (A11). While a `stack.build`
 * runs for a service, the service is deploying the version it builds, whose
 * name is the commit on a Mate's deploys. Once the active version's id is the
 * one a build named, that name is what runs, the build over or not. A version
 * no build named is read from the service directly (`unnamedVersions`), which
 * states its source and, while it is the newest deploy started, its name.
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
import type { ZeropsServiceDeployedVersion } from "../data/deployedVersion.ts";
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
  type DeployedVersion,
  type EnvironmentRow,
  type GroupRowTone,
} from "../groupRows.ts";
import type { FailureReason, Freshness, Known, Shown, Stamp } from "../knowledge/known.ts";
import { knownPresentation, type KnownSurface } from "../knowledge/presentation.ts";
import { shortCommit } from "../release.ts";
import { sameCommit } from "../versionName.ts";

export type Deployment =
  /**
   * The deployment facet is observed and names no active deploy. `afterBuild`: a build of it was
   * seen to end while it was demanded, and nothing it built runs — its first deploy failed.
   */
  | { readonly kind: "none"; readonly afterBuild?: true }
  | {
      readonly kind: "running";
      /** When the active deploy was activated, as the platform pushed it. */
      readonly activatedAt: string | null;
      /** The pushed name, and the commit only where the platform named none. */
      readonly version: DeployedVersion;
    }
  /**
   * A build for the service runs: the version it builds, named by the build (A11), and what ran
   * when it started — `null` while nothing states that — which runs on if the build fails.
   */
  | {
      readonly kind: "deploying";
      readonly version: DeployedVersion;
      readonly previous: SettledDeployment | null;
    };

/** What a service runs with no build of it in the way. */
export type SettledDeployment = Exclude<Deployment, { readonly kind: "deploying" }>;

export const NOTHING_DEPLOYED = "Nothing deployed yet";
export const CHECKING_WHAT_RUNS = "Checking what runs here…";
/** A stop's word for a deploy nobody has reported a build status for. */
export const RUNNING_WORD = "Deployed";

/**
 * When the version a stop runs went live: `null` while it runs nothing, builds,
 * or nothing is known yet. A surface reads it here, never off the Known itself.
 */
export function deployActivatedAt(deployment: Shown<Deployment> | undefined): string | null {
  return deployment?.state === "known" && deployment.value.kind === "running"
    ? deployment.value.activatedAt
    : null;
}

/**
 * Whether a stop runs a version now, as the platform pushed it: `false` while it
 * runs nothing, builds, or nothing is known yet. A surface reads it here, never
 * off the Known itself.
 */
export function deployRuns(deployment: Shown<Deployment> | undefined): boolean {
  return deployment?.state === "known" && deployment.value.kind === "running";
}

/**
 * A deploy on its way on a stop: the version it builds and what served before
 * it. `undefined` while nothing builds, or nothing is known yet.
 */
export function deployBuilding(
  deployment: Shown<Deployment> | undefined,
): { readonly version: DeployedVersion; readonly previous: SettledDeployment | null } | undefined {
  if (deployment?.state !== "known" || deployment.value.kind !== "deploying") return undefined;
  return { version: deployment.value.version, previous: deployment.value.previous };
}

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
  readonly refused: ProcessRefusal | null;
  /**
   * What a direct read of each service said of an active version a push left unstated and nothing
   * named, by that version's id (A14, `unnamedVersions`).
   */
  readonly stated: ReadonlyMap<string, Shown<ZeropsServiceDeployedVersion>>;
}

/** The platform took no demand for a stop's running processes: why, and when it is asked again. */
export interface ProcessRefusal {
  readonly reason: LeaseAdmissionError["reason"];
  /** How many times in a row it refused. */
  readonly attempt: number;
  /** `null` for a demand it will never admit. */
  readonly retryAtMs: number | null;
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

/**
 * The services whose active version a push left unstated and no build named, each with that
 * version's id: only a direct read of the service can say what it is (A14).
 */
export function unnamedVersions(
  services: CollectionRead<ServiceRecord>,
  names: ReadonlyMap<string, string>,
): ReadonlyArray<{ readonly service: ServiceRef; readonly versionId: string }> {
  return services.value.flatMap((knowledge) => {
    const answer = serviceAnswer(knowledge);
    if (knowledge.knowledge !== "observed" || answer.kind !== "unstated") return [];
    const versionId = answer.deploy.id;
    return versionId === null || names.has(versionId)
      ? []
      : [{ service: knowledge.record.ref, versionId }];
  });
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

/** What a stop's services are measured against: its builds, every name one gave, what was read. */
interface StopContext extends StopBuilds {
  readonly names: ReadonlyMap<string, string>;
  readonly stated: StopReads["stated"];
  readonly source: SourceState;
  readonly nowMs: number;
}

/** The direct read of an active version the push left unstated, while it is one. */
function directReadOf(
  answer: ServiceAnswer,
  stated: StopReads["stated"],
): Shown<ZeropsServiceDeployedVersion> | undefined {
  return answer.kind === "unstated" && answer.deploy.id !== null
    ? stated.get(answer.deploy.id)
    : undefined;
}

/**
 * What the service's active version is, as far as anything states it: a build's name for it first,
 * else what the platform pushed, else what a direct read of the service said of that same version;
 * `null` while nothing names or sources it (A14).
 */
function activeDeployment(
  answer: ServiceAnswer,
  names: ReadonlyMap<string, string>,
  stated: StopReads["stated"],
): SettledDeployment | null {
  switch (answer.kind) {
    case "none":
      return { kind: "none" };
    case "running":
    case "unstated": {
      const { id, activatedAt } = answer.deploy;
      const named = id === null ? undefined : names.get(id);
      if (named !== undefined)
        return { kind: "running", activatedAt, version: deployedVersion(named) };
      if (answer.kind === "running")
        return { kind: "running", activatedAt, version: pushedVersion(answer.deploy) };
      const read = directReadOf(answer, stated);
      // An answer for another version says nothing of this one.
      if (read?.state !== "known" || read.value.activeId !== id) return null;
      return read.value.source === "NONE"
        ? { kind: "none" }
        : { kind: "running", activatedAt, version: deployedVersion(read.value.name ?? undefined) };
    }
    default:
      return null;
  }
}

function serviceDeployment(
  answer: Exclude<ServiceAnswer, { readonly kind: "not-a-stop" }>,
  serviceId: string,
  context: StopContext,
): Shown<Deployment> {
  const { builds, complete, names, stated, source, nowMs } = context;
  const known = (value: Deployment, asOf: Stamp): Shown<Deployment> => ({
    state: "known",
    value,
    asOf,
    coverage: "complete",
    freshness: freshnessOf(source, nowMs),
  });
  const active = activeVersionId(answer);
  const settled = activeDeployment(answer, names, stated);
  // A build whose version is already the active one has deployed: the service runs it.
  const build = builds.find(
    ({ serviceIds, appVersionId }) =>
      serviceIds.includes(serviceId) && (appVersionId === null || appVersionId !== active),
  );
  if (build !== undefined)
    return known(
      { kind: "deploying", version: deployedVersion(build.name ?? undefined), previous: settled },
      build.asOf,
    );
  switch (answer.kind) {
    case "running":
    case "unstated":
    case "none": {
      if (settled === null) {
        // A direct read that failed says why nothing states the version, and when it is tried again.
        const read = directReadOf(answer, stated);
        return read?.state === "failed" ? read : notYetKnown(source, nowMs);
      }
      // Nothing active is no proof while a build for it may be running unseen.
      if (settled.kind === "none" && !complete) return notYetKnown(source, nowMs);
      return known(settled, answer.asOf);
    }
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
    stated: reads.stated,
    // A service's deployment stands on both listings: its builds are the processes'.
    source:
      reads.refused === null
        ? worstSource([...read.observation.required, ...reads.processes.observation.required])
        : {
            kind: "failed",
            failure: { kind: "refused", code: reads.refused.reason, words: "" },
            attempts: reads.refused.attempt,
            retryAtMs: reads.refused.retryAtMs,
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

/**
 * Being read again: nothing new is known yet, nothing failed, and the source is not paused — a
 * paused source says so (`paused`), never revalidating.
 */
const rechecking = (shown: Shown<unknown>): boolean =>
  shown.state === "reading" || (shown.state === "unread" && shown.waitingFor === null);

/** Known to run nothing: the one answer a re-check keeps (F5). */
const knownNone = (
  shown: Shown<Deployment>,
): shown is Extract<Shown<Deployment>, { state: "known" }> =>
  shown.state === "known" && shown.value.kind === "none";

/** A build in flight: a re-check of the whole listing is no news of its end (run 5). */
const knownDeploying = (shown: Shown<Deployment>): boolean =>
  shown.state === "known" && shown.value.kind === "deploying";

/** A known answer, now being checked again: since when, kept from a check already under way. */
function revalidating<T>(
  held: Extract<Known<T>, { readonly state: "known" }>,
  nowMs: number,
): Extract<Known<T>, { readonly state: "known" }> {
  if (held.freshness.kind === "revalidating") return held;
  return { ...held, freshness: { kind: "revalidating", sinceMs: nowMs } };
}

/**
 * A stop read again, over what it showed: a re-check keeps the last answer where that answer was
 * "nothing deployed" (run 4, F5), or a build in flight (run 5) — the import's own no-code version, which a push names only by
 * its id (A14), then the account's store states, never ran anything either way. The listing read
 * again keeps the services it showed where each ran nothing, and a service checked again keeps its
 * none, revalidating, until an answer or a failure replaces it. A version is never held: one
 * activated with no build seen (a roll back) reads Checking until it is named, never as the old
 * one. A paused source stays paused. "Checking what runs here…" follows a none only as a version
 * arrives.
 */
export function heldThroughRecheck(
  shown: Known<ReadonlyArray<StopService>>,
  next: Known<ReadonlyArray<StopService>>,
  nowMs: number,
): Known<ReadonlyArray<StopService>> {
  if (shown.state !== "known") return next;
  if (rechecking(next)) {
    return shown.value.every(
      ({ deployment }) => knownNone(deployment) || knownDeploying(deployment),
    )
      ? revalidating(shown, nowMs)
      : next;
  }
  if (next.state !== "known") return next;
  let held = false;
  const value = next.value.map((service): StopService => {
    if (!rechecking(service.deployment)) return service;
    const before = shown.value.find(
      (entry) => entry.service.serviceId === service.service.serviceId,
    )?.deployment;
    if (before === undefined || !knownNone(before)) return service;
    held = true;
    return { ...service, deployment: revalidating(before, nowMs) };
  });
  return held ? { ...next, value } : next;
}

/**
 * How long a build seen to end with nothing running keeps saying what it said while it built,
 * before it reads as the first deploy failing. The socket promises no order between a process's
 * end and its service's new version: run 4 saw the version 0.3 s before the build's end (app
 * ACTIVE +1481.7 s, build finished +1482.0 s), and the other order is a success that would flash
 * "its first deploy failed" — the worst false alarm. 20 s is some 60 times that margin, and a
 * failure still shows within half a minute.
 */
export const AFTER_BUILD_GRACE_MS = 20_000;

/** A service seen building while its stop is demanded. */
export interface SeenBuild {
  /** What it said while it built, kept through the grace. */
  readonly building: Extract<Shown<Deployment>, { readonly state: "known" }>;
  /** When it was first seen to run nothing after the build; `null` while it builds. */
  readonly endedAtMs: number | null;
}

/**
 * A stop read again, over the services seen building: a service seen deploying and now known to
 * run nothing ran no build of its — its first deploy failed (`afterBuild`), which no running-process
 * listing keeps once the build is gone. Only after {@link AFTER_BUILD_GRACE_MS} with still nothing
 * running: until then it says what it said while it built, since its new version may be on its
 * way — and so does one whose answer is not known yet, its new version unstated or a listing read
 * again (run 5: "Checking what runs here…" for 1.2 s as a build ended). One running anything is
 * forgotten. Returns the services seen building, the stop as shown,
 * and when the store must read it again for a grace to run out (`null` for none).
 */
export function afterBuilds(
  built: ReadonlyMap<string, SeenBuild>,
  next: Known<ReadonlyArray<StopService>>,
  nowMs: number,
): {
  readonly built: ReadonlyMap<string, SeenBuild>;
  readonly shown: Known<ReadonlyArray<StopService>>;
  readonly wakeAtMs: number | null;
} {
  if (next.state !== "known") {
    // A re-check of the whole listing is no news of a build's end: a grace already running keeps
    // its end, so the stop is read again as it runs out.
    let wakeAtMs: number | null = null;
    for (const { endedAtMs } of built.values()) {
      if (endedAtMs === null) continue;
      const graceEndsAtMs = endedAtMs + AFTER_BUILD_GRACE_MS;
      if (nowMs < graceEndsAtMs && (wakeAtMs === null || graceEndsAtMs < wakeAtMs))
        wakeAtMs = graceEndsAtMs;
    }
    return { built, shown: next, wakeAtMs };
  }
  const seen = new Map(built);
  let changed = false;
  let wakeAtMs: number | null = null;
  const value = next.value.map((service): StopService => {
    const { deployment } = service;
    const id = service.service.serviceId;
    if (deployment.state === "known" && deployment.value.kind === "deploying") {
      seen.set(id, { building: deployment, endedAtMs: null });
      return service;
    }
    if (deployment.state === "known" && deployment.value.kind === "running") {
      seen.delete(id);
      return service;
    }
    const build = seen.get(id);
    if (build === undefined) return service;
    const endedAtMs = build.endedAtMs ?? nowMs;
    if (build.endedAtMs === null) seen.set(id, { ...build, endedAtMs });
    const graceEndsAtMs = endedAtMs + AFTER_BUILD_GRACE_MS;
    // Its new version not known yet, or nothing running yet: the deploy is still finishing.
    if (nowMs < graceEndsAtMs) {
      changed = true;
      wakeAtMs = wakeAtMs === null ? graceEndsAtMs : Math.min(wakeAtMs, graceEndsAtMs);
      return { ...service, deployment: build.building };
    }
    // Past the grace, what is not known reads as not known; only a known none failed.
    if (deployment.state !== "known") return service;
    changed = true;
    return { ...service, deployment: { ...deployment, value: { kind: "none", afterBuild: true } } };
  });
  return { built: seen, shown: changed ? { ...next, value } : next, wakeAtMs };
}

/** What a stop's row draws: the badge, its word, and the line under the name. */
export interface StopView {
  readonly tone: GroupRowTone;
  /** The badge's word, which its tooltip and accessible name carry. */
  readonly word: string;
  readonly line: string;
  /** What runs there, when anything is known to; the menu spells it out. */
  readonly version: DeployedVersion | undefined;
  /** When what runs there started running, where the platform says it runs and says when. */
  readonly activatedAt: string | null;
  /** How long the line waits before it shows: a quick answer never flickers a placeholder. */
  readonly afterMs: number;
}

/**
 * Whether two versions name the same deploy: by commit where both carry one — either may spell it
 * short, as a name written since 2026-09-30 does (`sameCommit`).
 */
const sameVersion = (left: DeployedVersion, right: DeployedVersion): boolean =>
  left.sha !== undefined && right.sha !== undefined
    ? sameCommit(left.sha, right.sha) || sameCommit(right.sha, left.sha)
    : left.label === right.label;

/**
 * What a running stop runs, the one precedence every surface names it by: the platform's answer,
 * and the deploy half's row where nothing else names it, or where it read the deploy the platform
 * names under a name of its own — the release every service of the stop runs
 * (`nameStopByRelease`), where the platform names one service's.
 */
export function runningVersion(
  runs: DeployedVersion | undefined,
  row: EnvironmentRow | undefined,
): DeployedVersion | undefined {
  const named = runs?.label === undefined ? undefined : runs;
  const read = row?.version.label === undefined ? undefined : row.version;
  const same = read !== undefined && named !== undefined && sameVersion(named, read);
  return same && read.name !== undefined ? read : (named ?? read);
}

/**
 * How the deploy a stop runs went, the one rule every surface colours a running stop by — its
 * page (`stopView`), the menu, the chips and the projects page's cards (`groupFlow`'s `stopOf`,
 * {@link stopTone}).
 *
 * A deploy of a commit only moves forward: a stop that runs a version is deployed. The row's
 * statuses are on the commit a service runs — its active version — and the broker never deploys
 * a commit a service already runs (gitea-mate grants it as live). So a `pending` there was read
 * before the version went active (run 4, 2026-10-02: active at +1478.7 s, success by +1482.9 s),
 * and never moves a running stop back to deploying, whether or not the platform's own answer is
 * known just now. A newer commit starts its own sequence, from the platform's build.
 *
 * A failure on the version the stop runs still says Failed. A row read at another version — the
 * one before, or a build that failed after its name moved (A11, A14) — names nothing there
 * (`runningVersion`) and fails nothing there; the platform says the stop runs, so it is deployed.
 * What the row still says is whether Gitea was read at all: a stop with no status read has no
 * colour and no word (`deployWord`).
 */
export function runningTone(
  runs: DeployedVersion | undefined,
  row: EnvironmentRow | undefined,
): GroupRowTone {
  const named = runs?.label === undefined ? undefined : runs;
  const read = row?.version.label === undefined ? undefined : row;
  if (read === undefined || read.tone === "neutral") return "neutral";
  const same = named === undefined || sameVersion(named, read.version);
  return read.tone === "bad" && same ? "bad" : "good";
}

/**
 * A stop's tone with no clock — what `stopView` colours it, for a surface that draws only the dot
 * and its word: a build the platform runs is deploying; a version it runs, or the row's while its
 * answer is on its way, is {@link runningTone}'s; nothing running, or nothing known, says nothing.
 */
export function stopTone(
  deployment: Shown<Deployment> | undefined,
  row: EnvironmentRow | undefined,
): GroupRowTone {
  if (deployment?.state === "known" && deployment.value.kind === "deploying") return "pending";
  // "Nothing deployed yet" is earned only by a complete answer; a partial one leaves the row's.
  if (deployment?.state === "known" && deployment.value.kind === "none") {
    if (deployment.coverage === "complete") return "neutral";
  }
  if (deployment?.state === "known" && deployment.value.kind === "running")
    return runningTone(deployment.value.version, row);
  return runningTone(undefined, row);
}

/**
 * A stop that runs something, named by `runningVersion` and coloured by `runningTone`.
 */
function runningView(
  runs: Extract<Deployment, { readonly kind: "running" }> | undefined,
  row: EnvironmentRow | undefined,
): StopView {
  const version = runningVersion(runs?.version, row);
  const tone = runningTone(runs?.version, row);
  return {
    tone,
    word: deployWord(tone) ?? RUNNING_WORD,
    line: version?.label ?? RUNNING_WORD,
    version,
    activatedAt: runs?.activatedAt ?? null,
    afterMs: 0,
  };
}

/**
 * A stop's row from its deployment and, where the deploy half read one, its
 * environment row. The platform decides whether anything runs and names it; the
 * row colours the version it read, and names it only where nothing else does. A
 * version the row read stands for a deploy while the platform's own answer is
 * still on its way — it is evidence of one, never of none.
 */
export function stopView(input: {
  readonly deployment: Shown<Deployment>;
  readonly row: EnvironmentRow | undefined;
  readonly nowMs: number;
}): StopView {
  const { deployment, row } = input;
  if (deployment.state === "known" && deployment.value.kind === "running")
    return runningView(deployment.value, row);
  // A build runs now: what it builds is the stop's answer, whatever the row read before it.
  if (deployment.state === "known" && deployment.value.kind === "deploying") {
    const { version } = deployment.value;
    const word = deployWord("pending") ?? RUNNING_WORD;
    return {
      tone: "pending",
      word,
      line: version.label ?? word,
      version: version.label === undefined ? undefined : version,
      activatedAt: null,
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
      activatedAt: null,
      afterMs: 0,
    };
  if (row !== undefined && row.version.label !== undefined) return runningView(undefined, row);
  const text = presentation.message?.text ?? CHECKING_WHAT_RUNS;
  return {
    tone: "neutral",
    word: text,
    line: text,
    version: undefined,
    activatedAt: null,
    afterMs: presentation.message?.afterMs ?? 0,
  };
}
