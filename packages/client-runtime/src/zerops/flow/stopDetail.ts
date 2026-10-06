/**
 * Every sentence a stop's page says (rule R5): its verdict, the line under its name, its service
 * rows and the quiet label over its older releases. The page draws; it never composes.
 *
 * The verdict reads the same `StopView` the menu and the projects page read, so a stop has one
 * word for its state wherever it is shown.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module flow/stopDetail
 */
import {
  firstDeployLine,
  firstDeployTone,
  STAGE_SETTING_UP,
  type FirstDeploy,
} from "../stopComing.ts";
import type { GroupEnvironmentTier } from "../groupEnvironments.ts";
import {
  deployedVersion,
  environmentRow,
  type DeployedVersion,
  type EnvironmentServiceState,
  type GroupRowTone,
} from "../groupRows.ts";
import { type HqJob, jobFailed, jobInFlight } from "../hq/environments.ts";
import { deployFollowText } from "../hq/deployAnswer.ts";
import { deployLogTarget, type DeployLogTarget } from "../hq/deployLog.ts";
import type { Shown } from "../knowledge/known.ts";
import { cannotTellWhatRuns, changesNotLive } from "../projectAttention.ts";
import { serviceDashboardUrl } from "../serviceMap.ts";
import type { ZeropsPublicRoute, ZeropsRouteOffer } from "../publicRoutes.ts";
import { sameCommit } from "../versionName.ts";
import {
  releaseInFlightReason,
  shortCommit,
  RELEASE_NOTHING_NEW_ON_MAIN,
  type FlowReleaseRow,
} from "../release.ts";
import {
  NOTHING_DEPLOYED,
  stopView,
  type Deployment,
  type SettledDeployment,
  type StopService,
  type StopView,
} from "./deployment.ts";

export type StopVerdictTone = "off" | "busy" | "failed" | "ok";

/** The one sentence a stop's page opens with, its tone, and at most one verb. */
export interface StopVerdict {
  readonly tone: StopVerdictTone;
  readonly text: string;
  readonly detail: string | undefined;
  readonly verb:
    | { readonly kind: "release"; readonly tag: string }
    | { readonly kind: "run-again" }
    | null;
}

/** A deploy of the stop that failed: what it deployed, where, and what runs on instead. */
export interface StopFailedDeploy {
  readonly label: string;
  readonly service: string;
  /** The commit it deployed. */
  readonly sha: string | undefined;
  /** What still runs on that service, when something other than the failed deploy is known to. */
  readonly running: ServiceRuns | undefined;
  /**
   * The deploy *Run again* asks HQ for: the service's newest deploy, while HQ records it failed
   * and it is this one. `undefined` for any other.
   */
  readonly redeploy: RunAgain | undefined;
  /** HQ's words for why, from its record of that deploy; `undefined` where it keeps none. */
  readonly message: string | undefined;
}

/**
 * What *Run again* asks HQ for: `service` at `sha` once more, after the job `after` — the service's
 * newest — which the next one HQ's stream brings takes the place of.
 */
export interface RunAgain {
  readonly service: string;
  readonly sha: string;
  readonly after: string;
}

export interface StopFailure extends StopFailedDeploy {
  /** Whether this person may ask HQ to run it again (`redeploy`). */
  readonly mayRunAgain: boolean;
}

/** `text · since`, or the text alone while how long is not known. */
const withSince = (text: string, since: string | undefined): string =>
  since === undefined ? text : `${text} · ${since}`;

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/** The deploy key a stop's verdict speaks of (`stopVerdict`'s `keyGap`). */
export type StopKeyGap = NonNullable<Parameters<typeof stopVerdict>[0]["keyGap"]>;

/**
 * What a stop's verdict says of its deploy key, as HQ records it (main E07): a key that no longer
 * works, to anyone; no key, only to one HQ's rule does not let keep one (`keep_deploy_token`) —
 * one it does is offered the mint itself — and nothing while that is not known.
 */
export function stopKeyGap(input: {
  readonly keyHeld: boolean;
  readonly keyInvalid: boolean;
  /** Whether this person may keep the stop's deploy key; `undefined` while not known. */
  readonly mayKeep: boolean | undefined;
  /** The Zerops project's name. */
  readonly project: string;
}): StopKeyGap | undefined {
  if (input.keyInvalid) return { kind: "invalid", project: input.project };
  if (!input.keyHeld && input.mayKeep === false) return { kind: "missing", project: input.project };
  return undefined;
}

/** Where a stage HQ holds for a deploy key is finished, by one who may keep its key. */
const FINISH_HELD_STAGE = "Finish setting it up from its project's menu on the Projects page.";

/** What a stop's page says first: the first state that holds, in the order a person needs them. */
export function stopVerdict(input: {
  readonly tier: GroupEnvironmentTier;
  readonly view: StopView;
  /** The tag in flight; production only. */
  readonly releasing: string | undefined;
  readonly failed: StopFailure | undefined;
  /** Changes merged to main that production does not run. */
  readonly waiting: number;
  /** Whether that is only how many at least: HQ stopped counting (`movedCount`). */
  readonly waitingAtLeast: boolean;
  /** Production's services whose commit cannot be told (`releaseReads`' `untold`). */
  readonly untold: ReadonlyArray<string>;
  readonly release: {
    readonly offered: boolean;
    readonly tag: string | undefined;
    /** Why it is not offered, as its gate says; `undefined` while it is. */
    readonly reason: string | undefined;
  };
  /** How long ago production's release went out, already said (e.g. `2h ago`). */
  readonly releasedAge: string | undefined;
  /** How long the stop's version has run, already said; a stage's detail. */
  readonly since: string | undefined;
  /** Whether a stage runs main's head commit; stage only. */
  readonly atMainHead: boolean;
  /**
   * The deploy key HQ deploys the stop with, where it keeps HQ from deploying — missing, or no
   * longer working — and the Zerops project whose Full access mints one; `undefined` while it
   * works.
   */
  readonly keyGap: { readonly kind: "missing" | "invalid"; readonly project: string } | undefined;
  /** A stage that runs nothing: where its first deploy stands (`GroupFlowStop.firstDeploy`). */
  readonly firstDeploy?: FirstDeploy | undefined;
}): StopVerdict {
  const { tier, view } = input;
  const quiet = { detail: undefined, verb: null } as const;
  if (tier === "production" && input.releasing !== undefined)
    return { tone: "busy", text: releaseInFlightReason(input.releasing), ...quiet };
  if (view.tone === "pending") return { tone: "busy", text: view.word, ...quiet };
  // HQ deploys nothing without a key that works, so the failures that follow are not said, and
  // nothing is asked again.
  if (input.keyGap !== undefined) {
    const { kind, project } = input.keyGap;
    return {
      tone: "failed",
      text: kind === "missing" ? "It has no deploy key yet." : "Its deploy key no longer works.",
      detail: `Someone with Full access to the ${project} project in Zerops mints ${kind === "missing" ? "one" : "a new one"} here.`,
      verb: null,
    };
  }
  if (input.failed !== undefined) {
    const { label, service, running, redeploy, message, mayRunAgain } = input.failed;
    // HQ's words for why say more than what still runs, which the service's row says too.
    return {
      tone: "failed",
      text: `The deploy of ${label} failed on ${service}.`,
      detail:
        message ??
        (running === undefined
          ? undefined
          : withSince(`${running.label} still runs`, running.since)),
      verb: redeploy !== undefined && mayRunAgain ? { kind: "run-again" } : null,
    };
  }
  const releaseVerb =
    tier === "production" &&
    (input.waiting > 0 || input.untold.length > 0) &&
    input.release.offered &&
    input.release.tag !== undefined
      ? ({ kind: "release", tag: input.release.tag } as const)
      : null;
  if (view.version === undefined) {
    // Its own import still runs: set up first, as the menu and its cell say — never Checking, nor
    // that a merge deploys it (HQ queues its first deploy of main as the import ends, `firstDeploy`).
    if (tier === "stage" && input.firstDeploy?.kind === "setting-up")
      return { tone: "busy", text: STAGE_SETTING_UP, ...quiet };
    if (view.line !== NOTHING_DEPLOYED) return { tone: "off", text: view.line, ...quiet };
    // A stage's first deploy asked for says where it stands, as its cell and the menu do.
    const first = tier === "stage" ? firstDeployLine(input.firstDeploy) : undefined;
    if (first !== undefined) {
      // Why it failed, only where the job's own words say it (`firstDeployFailure`); held for a
      // key, where one who may keep it finishes it (`halfMadeGroupEnvironments`) — one who may
      // not is told who mints it, by `keyGap` above.
      const why =
        input.firstDeploy?.kind === "failed"
          ? input.firstDeploy.reason
          : input.firstDeploy?.kind === "held"
            ? FINISH_HELD_STAGE
            : undefined;
      return {
        tone: firstDeployTone(input.firstDeploy),
        text: `${first}.`,
        ...quiet,
        ...(why === undefined ? {} : { detail: why }),
      };
    }
    // An empty production moves by its first release, offered as soon as main has something.
    return {
      tone: "off",
      text: `${NOTHING_DEPLOYED}.`,
      detail: tier === "stage" ? "The next merge to main deploys here." : undefined,
      verb: releaseVerb,
    };
  }
  const label = view.version.label ?? view.line;
  if (tier === "stage") {
    // The commit it runs, and for how long: at main's head the sentence names neither, so the
    // detail always says the commit; behind it, a sentence naming the commit already said it.
    const commit =
      !input.atMainHead && view.version.commit === label ? undefined : view.version.commit;
    return {
      tone: "ok",
      text: input.atMainHead ? "Stage runs the head of main." : `Stage runs ${label}.`,
      detail: commit === undefined ? input.since : withSince(commit, input.since),
      verb: null,
    };
  }
  if (input.waiting > 0)
    return {
      tone: "busy",
      text: `${changesNotLive(input.waiting, input.waitingAtLeast)}.`,
      detail: `Production runs ${label}`,
      verb: releaseVerb,
    };
  // Nothing counted, and what some service runs cannot be told: never "already runs it".
  if (input.untold.length > 0)
    return {
      tone: "busy",
      text: `${cannotTellWhatRuns(input.untold)}.`,
      detail: `Production runs ${label}`,
      verb: releaseVerb,
    };
  // Nothing waits: production runs what is merged — unless the release is not offered, whose gate
  // says why, and what is merged is not known to be what runs.
  return {
    tone: "ok",
    text: input.release.reason ?? RELEASE_NOTHING_NEW_ON_MAIN,
    detail: input.releasedAge === undefined ? label : `${label} · released ${input.releasedAge}`,
    verb: null,
  };
}

/**
 * The line under a stop's name: where its code comes from, and how many services run it.
 * `source` is the environment row's (`EnvironmentRow.source`): `release`, `a + b`, or `—` for none.
 */
export function stopMetaLine(input: {
  readonly tier: GroupEnvironmentTier;
  readonly source: string;
  readonly services: number;
}): string {
  const from =
    input.tier === "production"
      ? "Moves on release"
      : input.source === "" || input.source === "—"
        ? "Nothing yet"
        : `Follows ${input.source}`;
  return input.services > 0 ? `${from} · ${plural(input.services, "service", "services")}` : from;
}

const CARD_GROUPS = {
  waiting: "Waiting for release",
  services: "Services",
  releases: "Releases",
  deploys: "Deploys",
} as const;

/**
 * A group of the stop's card, under its label: `Services · 2`; the label alone while uncounted, and
 * `+` where the count is only how many at least.
 */
export function stopCardTitle(
  group: keyof typeof CARD_GROUPS,
  count: number | undefined,
  atLeast?: boolean,
): string {
  return count === undefined
    ? CARD_GROUPS[group]
    : `${CARD_GROUPS[group]} · ${String(count)}${atLeast === true ? "+" : ""}`;
}

/** Said, muted, beside a stage's Deploys: what they are read from. */
export const DEPLOYS_ASIDE = "on main";

/** A card group with nothing in it. */
export const NONE_YET = "None yet";

/** A service with no public address and none to offer. */
export const NOT_PUBLIC_YET = "Not public yet";

/** What a link into a stop's page says on hover, wherever it stands. */
export function openStopLabel(tier: GroupEnvironmentTier): string {
  return `Open ${tier}`;
}

/** The quiet label that shows a production's older releases. */
export function earlierReleasesLabel(count: number): string {
  return `Show ${plural(count, "earlier release", "earlier releases")}`;
}

/** One code service of a stop, as its page draws it. */
export interface StopServiceRow {
  readonly hostname: string;
  readonly serviceId?: string;
  /** The repository its tier builds it from, in the group's org. */
  readonly repository: string;
  readonly sha: string | undefined;
  readonly commit: string | undefined;
  /** `deployed with <name>` when the app version names one, else `head of main` where it is. */
  readonly line: string | undefined;
  readonly tone: GroupRowTone;
  readonly word: string;
  /**
   * The word, and how long it has run when the platform says; `undefined` for a service that runs
   * nothing, whose commit's place already says so.
   */
  readonly status: string | undefined;
  /**
   * What the service runs now — through a build, what ran before it — and how long it has, when
   * the platform says; the name HQ's record gives while the platform's is not read. `undefined` for
   * nothing known to run.
   */
  readonly runs: ServiceRuns | undefined;
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  readonly offers: ReadonlyArray<ZeropsRouteOffer>;
  /** Its newest deploy, while HQ records it as failed: its job, its commit, and HQ's words for why. */
  readonly failed:
    | { readonly jobId: string; readonly sha: string; readonly message: string | undefined }
    | undefined;
  /** Its newest job, while it says what its row does not (`jobOf`). */
  readonly job: StopServiceJob | undefined;
  /** Its newest deploy's durable platform handles, including once it went live. */
  readonly deployLog?: DeployLogTarget | undefined;
  /** What it runs, where that is not what HQ last made it run (`driftOf`). */
  readonly drift: StopServiceDrift | undefined;
}

/**
 * A service's newest job, said where it is not what the service runs: waiting its turn,
 * submitting, building, or ended without running it — its build failed, HQ refused or skipped it —
 * when, and HQ's words for why.
 */
export interface StopServiceJob {
  readonly state: HqJob["state"];
  readonly line: string;
  readonly reason: string | undefined;
  /** Explicit new operation while following waits or ended unresolved. */
  readonly redeploy?: RunAgain;
}

/**
 * A service running a version HQ did not make for it (the deploy-jobs design): HQ never overwrites
 * it; a person deploys HQ's commit again, or looks at it in Zerops.
 */
export interface StopServiceDrift {
  readonly line: string;
  /**
   * HQ's live commit there, deployed again by *Run again*; none where a newer job of another
   * commit stands for the service, which HQ asks again instead.
   */
  readonly redeploy: RunAgain | undefined;
  /** The service's page in Zerops; none while its id is not known. */
  readonly zerops: string | undefined;
}

/** The service's newest job, said where it is not live (`StopServiceJob`). */
export function jobOf(
  job: HqJob | undefined,
  age: (iso: string) => string,
): StopServiceJob | undefined {
  if (job === undefined || job.sha === null) return undefined;
  const commit = shortCommit(job.sha);
  const reason = job.reason?.trim() || undefined;
  const ended = age(job.endedAt ?? job.at);
  switch (job.state) {
    case "queued":
      return { state: job.state, line: `${commit} queued`, reason: undefined };
    case "submitting": {
      const waiting = deployFollowText(job);
      return {
        state: job.state,
        line: waiting === undefined ? `Submitting ${commit}` : `${commit}: ${waiting}`,
        reason: undefined,
        ...(waiting === undefined || job.service === null
          ? {}
          : { redeploy: { service: job.service, sha: job.sha, after: job.id } }),
      };
    }
    case "unresolved":
      return {
        state: job.state,
        line: `${commit}: ${deployFollowText(job)}`,
        reason: undefined,
        ...(job.service === null
          ? {}
          : { redeploy: { service: job.service, sha: job.sha, after: job.id } }),
      };
    case "building":
      return { state: job.state, line: `Building ${commit}`, reason: undefined };
    case "failed":
      return { state: job.state, line: `${commit} failed ${ended}`, reason };
    case "refused":
      return { state: job.state, line: `HQ refused ${commit} ${ended}`, reason };
    case "skipped":
      return { state: job.state, line: `HQ skipped ${commit} ${ended}`, reason };
    default:
      return undefined;
  }
}

/**
 * A service that runs a version HQ did not make for it: one HQ put live there, and the platform now
 * runs another, while no job of HQ's is under way to change it.
 */
export function driftOf(state: EnvironmentServiceState): StopServiceDrift | undefined {
  const live = state.deploy?.live;
  const latest = state.deploy?.latest;
  if (
    live === null ||
    live === undefined ||
    live.sha === null ||
    live.appVersionId === null ||
    state.activeVersionId === undefined ||
    state.activeVersionId === null ||
    state.activeVersionId === live.appVersionId ||
    (latest !== undefined && jobInFlight(latest)) ||
    (latest?.state === "unresolved" && latest.appVersionId === state.activeVersionId)
  ) {
    return undefined;
  }
  const runs = deployedVersion(state.appVersionName).label;
  // HQ asks again only the service's newest job: its live commit, while the newest is of it.
  const newest = latest ?? live;
  return {
    line:
      runs === undefined
        ? `${state.hostname} runs a version HQ did not deploy`
        : `${state.hostname} runs “${runs}”, which HQ did not deploy`,
    redeploy:
      newest.sha === live.sha
        ? { service: state.hostname, sha: live.sha, after: newest.id }
        : undefined,
    zerops: state.serviceId === undefined ? undefined : serviceDashboardUrl(state.serviceId),
  };
}

/**
 * The services an environment's tier declares that its project lacks, as the platform lists them
 * (audit D2): a person deleted one, or a recipe delta did not import it — HQ never adds one by
 * itself, so each is a person's to add. None while the recipe or the project's listing is unread.
 */
export function notInZerops(input: {
  readonly recipeServices: ReadonlyArray<string> | undefined;
  readonly platform: Shown<ReadonlyArray<StopService>>;
}): ReadonlyArray<string> {
  const { recipeServices, platform } = input;
  if (recipeServices === undefined || platform.state !== "known") return [];
  return recipeServices.filter(
    (hostname) => !platform.value.some((service) => service.hostname === hostname),
  );
}

/** A version a service runs, and how long it has run, already said. */
export interface ServiceRuns {
  readonly label: string;
  readonly since: string | undefined;
}

/** Said under a stage service's commit where it is main's head and no release names it. */
const HEAD_OF_MAIN = "head of main";

function commitLine(version: DeployedVersion, mainHead: string | undefined): string | undefined {
  if (version.name !== undefined) return `deployed with ${version.name}`;
  return sameCommit(version.sha, mainHead) ? HEAD_OF_MAIN : undefined;
}

const UNREAD: Shown<Deployment> = { state: "unread", waitingFor: null };

/**
 * What the platform says a service runs — through a build, what ran before it; `null` where it
 * does not say, the platform not read or nothing stating what ran before the build.
 */
function settledOf(deployment: Shown<Deployment>): SettledDeployment | null {
  if (deployment.state !== "known") return null;
  const { value } = deployment;
  return value.kind === "deploying" ? value.previous : value;
}

/**
 * The version a service's row names: what the platform says it runs, HQ's record's while the
 * platform is not read — never the one a build is deploying, which runs nothing yet, and none
 * while nothing states what ran before that build.
 */
function settledVersionOf(
  deployment: Shown<Deployment>,
  settled: SettledDeployment | null,
  read: DeployedVersion,
): DeployedVersion {
  if (deployment.state !== "known") return read;
  return settled?.kind === "running" ? settled.version : NO_VERSION;
}

const NO_VERSION = deployedVersion(undefined);

function runsOf(
  deployment: Shown<Deployment>,
  settled: SettledDeployment | null,
  read: DeployedVersion,
  age: (iso: string) => string,
): ServiceRuns | undefined {
  if (deployment.state !== "known")
    return read.label === undefined ? undefined : { label: read.label, since: undefined };
  if (settled?.kind !== "running" || settled.version.label === undefined) return undefined;
  const { activatedAt } = settled;
  return {
    label: settled.version.label,
    since: activatedAt === null ? undefined : age(activatedAt),
  };
}

/**
 * Each service's deployment, as the platform lists it. A listing not read yet, failing or
 * withheld is each service's answer too: it says why the service's state is unknown, where an
 * empty listing would read as nothing running.
 */
function platformDeployments(
  platform: Shown<ReadonlyArray<StopService>>,
): (hostname: string) => Shown<Deployment> {
  if (platform.state !== "known") return () => platform;
  const listed = new Map(platform.value.map((entry) => [entry.hostname, entry.deployment]));
  return (hostname) => listed.get(hostname) ?? UNREAD;
}

/** A deploy HQ records as failed, as a row carries it: its commit, and HQ's words where it has some. */
function failedOf(latest: HqJob | undefined): StopServiceRow["failed"] {
  if (latest === undefined || latest.sha === null || !jobFailed(latest)) return undefined;
  const message = latest.reason?.trim();
  return {
    jobId: latest.id,
    sha: latest.sha,
    message: message === undefined || message === "" ? undefined : message,
  };
}

/**
 * A stop's code services, one row each: those its tiers build from a repository. A database, a
 * cache or a bucket is never deployed from one, so it has no row. The state is the menu's
 * (`stopView` over that one service), so a service reads the same word on the page as in the menu.
 */
export function serviceRows(input: {
  /** HQ's name for the environment. */
  readonly environment: string;
  readonly services: ReadonlyArray<EnvironmentServiceState>;
  readonly platform: Shown<ReadonlyArray<StopService>>;
  /** The head commit of `main` a stage follows; `undefined` for a production or while unread. */
  readonly mainHead: string | undefined;
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  readonly offers: ReadonlyArray<ZeropsRouteOffer>;
  readonly nowMs: number;
  readonly age: (iso: string) => string;
  /** A stage that runs nothing: where its first deploy stands, said where a service runs none. */
  readonly firstDeploy?: FirstDeploy | undefined;
}): ReadonlyArray<StopServiceRow> {
  const deploymentOf = platformDeployments(input.platform);
  const code = input.services
    .flatMap(({ repository, ...state }) =>
      repository === undefined ? [] : [{ ...state, repository }],
    )
    .sort((left, right) => left.hostname.localeCompare(right.hostname, "en"));
  return code.map((state) => {
    const { hostname } = state;
    const deployment = deploymentOf(hostname);
    // What HQ's record names: the version a build deploys, while one runs.
    const read = deployedVersion(state.appVersionName);
    const settled = settledOf(deployment);
    const version = settledVersionOf(deployment, settled, read);
    // The service's own row: `stopView` reads only its version and tone, which the one service
    // and HQ's record of its deploys decide; the row's name, tier and source go unread.
    const row = environmentRow({
      projectId: "",
      name: input.environment,
      tier: "stage",
      sources: [],
      services: [state],
    });
    const { tone, word, activatedAt } = stopView({ deployment, row, nowMs: input.nowMs });
    return {
      hostname,
      ...(state.serviceId === undefined ? {} : { serviceId: state.serviceId }),
      repository: state.repository,
      // As the name spells it: it keys the deploy-run read, which must not move as main's head
      // arrives, and the run is matched with `sameCommit`.
      sha: version.sha,
      commit: version.commit,
      line: commitLine(version, input.mainHead),
      tone,
      word:
        word === NOTHING_DEPLOYED ||
        (input.firstDeploy?.kind === "setting-up" && version.label === undefined)
          ? (firstDeployLine(input.firstDeploy) ?? word)
          : word,
      status:
        word === NOTHING_DEPLOYED
          ? undefined
          : activatedAt === null
            ? word
            : `${word} · ${input.age(activatedAt)}`,
      runs: runsOf(deployment, settled, read, input.age),
      routes: input.routes.filter((route) => route.service === hostname),
      offers: input.offers.filter((offer) => offer.service === hostname),
      failed: failedOf(state.deploy?.latest),
      job: jobOf(state.deploy?.latest, input.age),
      ...(state.deploy === undefined ? {} : { deployLog: deployLogTarget(state.deploy.latest) }),
      drift: driftOf(state),
    };
  });
}

/**
 * The deploy of the stop that failed, if one did.
 *
 * A production's is the newest release whose deploy failed and that is newer than the one it runs
 * (`FlowReleaseRow.failedEntry`): a release that failed never becomes what a service runs, so its
 * failure sits on a commit none of the stop's rows carries, and the service runs on what it ran.
 * A release that failed before the live one is history.
 *
 * Otherwise — and always on a stage — a service whose newest deploy HQ records as failed: it names
 * that commit, and what the service still runs, where that is another one.
 *
 * Either is asked again (`redeploy`) only while it is the service's newest deploy and failed.
 */
export function stopFailedDeploy(input: {
  readonly tier: GroupEnvironmentTier;
  readonly rows: ReadonlyArray<StopServiceRow>;
  /** The group's releases, newest first. */
  readonly releases: ReadonlyArray<FlowReleaseRow>;
}): StopFailedDeploy | undefined {
  /** The service's failed deploy HQ records, where it is of `commit`. */
  const recordOf = (service: string, commit: string | undefined) => {
    const failed = input.rows.find((row) => row.hostname === service)?.failed;
    return failed !== undefined && sameCommit(commit, failed.sha) ? failed : undefined;
  };
  if (input.tier === "production") {
    const live = input.releases.findIndex((release) => release.standing === "live");
    const newer = live === -1 ? input.releases : input.releases.slice(0, live);
    const failed = newer.find((release) => release.failedEntry !== undefined);
    if (failed?.failedEntry !== undefined) {
      const { service, commit } = failed.failedEntry;
      const record = recordOf(service, commit);
      return {
        label: failed.tag,
        service,
        sha: commit,
        running: input.rows.find((row) => row.hostname === service)?.runs,
        redeploy:
          record === undefined ? undefined : { service, sha: record.sha, after: record.jobId },
        message: record?.message,
      };
    }
  }
  const row = input.rows.find((entry) => entry.failed !== undefined);
  if (row?.failed === undefined) return undefined;
  const { failed, hostname } = row;
  return {
    label: shortCommit(failed.sha),
    service: hostname,
    sha: failed.sha,
    running: sameCommit(row.sha, failed.sha) ? undefined : row.runs,
    redeploy: { service: hostname, sha: failed.sha, after: failed.jobId },
    message: failed.message,
  };
}

/** What a stage's deploy history says beside the commit that stage runs. */
export const RUNNING_HERE = "Running here";
