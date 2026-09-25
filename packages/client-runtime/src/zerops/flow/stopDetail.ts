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
import type { GroupEnvironmentTier } from "../groupEnvironments.ts";
import {
  deployedVersion,
  environmentRow,
  type DeployedVersion,
  type EnvironmentServiceState,
  type GroupRowTone,
} from "../groupRows.ts";
import type { Shown } from "../knowledge/known.ts";
import { changesNotLive } from "../projectAttention.ts";
import type { ZeropsPublicRoute, ZeropsRouteOffer } from "../publicRoutes.ts";
import {
  releaseInFlightReason,
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
  /** The commit it deployed, whose build is the job that failed. */
  readonly sha: string | undefined;
  /** What still runs on that service, when something other than the failed deploy is known to. */
  readonly running: ServiceRuns | undefined;
}

export interface StopFailure extends StopFailedDeploy {
  /** Whether the failed job is known, so it can be run again. */
  readonly jobKnown: boolean;
}

/** `text · since`, or the text alone while how long is not known. */
const withSince = (text: string, since: string | undefined): string =>
  since === undefined ? text : `${text} · ${since}`;

const plural = (count: number, one: string, many: string): string =>
  `${count} ${count === 1 ? one : many}`;

/** What a stop's page says first: the first state that holds, in the order a person needs them. */
export function stopVerdict(input: {
  readonly tier: GroupEnvironmentTier;
  readonly view: StopView;
  /** The tag in flight; production only. */
  readonly releasing: string | undefined;
  readonly failed: StopFailure | undefined;
  /** Changes merged to main that production does not run. */
  readonly waiting: number;
  readonly release: { readonly offered: boolean; readonly tag: string | undefined };
  /** How long ago production's release went out, already said (e.g. `2h ago`). */
  readonly releasedAge: string | undefined;
  /** How long the stop's version has run, already said; a stage's detail. */
  readonly since: string | undefined;
  /** Whether a stage runs main's head commit; stage only. */
  readonly atMainHead: boolean;
}): StopVerdict {
  const { tier, view } = input;
  const quiet = { detail: undefined, verb: null } as const;
  if (tier === "production" && input.releasing !== undefined)
    return { tone: "busy", text: releaseInFlightReason(input.releasing), ...quiet };
  if (view.tone === "pending") return { tone: "busy", text: view.word, ...quiet };
  if (input.failed !== undefined) {
    const { label, service, running, jobKnown } = input.failed;
    return {
      tone: "failed",
      text: `The deploy of ${label} failed on ${service}.`,
      detail:
        running === undefined ? undefined : withSince(`${running.label} still runs`, running.since),
      verb: jobKnown ? { kind: "run-again" } : null,
    };
  }
  const releaseVerb =
    tier === "production" &&
    input.waiting > 0 &&
    input.release.offered &&
    input.release.tag !== undefined
      ? ({ kind: "release", tag: input.release.tag } as const)
      : null;
  if (view.version === undefined) {
    if (view.line !== NOTHING_DEPLOYED) return { tone: "off", text: view.line, ...quiet };
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
      text: `${changesNotLive(input.waiting)}.`,
      detail: `Production runs ${label}`,
      verb: releaseVerb,
    };
  return {
    tone: "ok",
    text: RELEASE_NOTHING_NEW_ON_MAIN,
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

/** A group of the stop's card, under its label: `Services · 2`; the label alone while uncounted. */
export function stopCardTitle(group: keyof typeof CARD_GROUPS, count: number | undefined): string {
  return count === undefined ? CARD_GROUPS[group] : `${CARD_GROUPS[group]} · ${String(count)}`;
}

/** Said, muted, beside a stage's Deploys: what they are read from. */
export const DEPLOYS_ASIDE = "on main";

/** A card group with nothing in it. */
export const NONE_YET = "None yet";

/** A service with no public address and none to offer. */
export const NOT_PUBLIC_YET = "Not public yet";

/** What a service row's chevron does, for a screen reader. */
export function serviceBuildToggleLabel(hostname: string, open: boolean): string {
  return `${open ? "Hide" : "Show"} how ${hostname} was deployed`;
}

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
   * the platform says; the Gitea side's name while the platform's is not read. `undefined` for
   * nothing known to run.
   */
  readonly runs: ServiceRuns | undefined;
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  readonly offers: ReadonlyArray<ZeropsRouteOffer>;
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
  return version.sha !== undefined && version.sha === mainHead ? HEAD_OF_MAIN : undefined;
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
 * The version a service's row names: what the platform says it runs, the Gitea side's while the
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

/**
 * A stop's code services, one row each: those its tiers build from a repository. A database, a
 * cache or a bucket is never deployed from one, so it has no row. The state is the menu's
 * (`stopView` over that one service), so a service reads the same word on the page as in the menu.
 */
export function serviceRows(input: {
  /** The environment's name in `environments.yaml`, which the statuses name. */
  readonly environment: string;
  readonly services: ReadonlyArray<EnvironmentServiceState>;
  readonly platform: Shown<ReadonlyArray<StopService>>;
  /** The head commit of `main` a stage follows; `undefined` for a production or while unread. */
  readonly mainHead: string | undefined;
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  readonly offers: ReadonlyArray<ZeropsRouteOffer>;
  readonly nowMs: number;
  readonly age: (iso: string) => string;
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
    // What the Gitea side read: the version a build deploys, while one runs.
    const read = deployedVersion(state.appVersionName);
    const settled = settledOf(deployment);
    const version = settledVersionOf(deployment, settled, read);
    // The service's own row: `stopView` reads only its version and tone, which the one service
    // and the environment's statuses decide; the row's name, tier and source go unread.
    const row = environmentRow({
      projectId: "",
      name: input.environment,
      tier: "stage",
      sources: [],
      services: [state],
      environment: input.environment,
    });
    const { tone, word } = stopView({ deployment, row, nowMs: input.nowMs });
    const activatedAt =
      deployment.state === "known" && deployment.value.kind === "running"
        ? deployment.value.activatedAt
        : null;
    return {
      hostname,
      repository: state.repository,
      sha: version.sha,
      commit: version.commit,
      line: commitLine(version, input.mainHead),
      tone,
      word,
      status:
        word === NOTHING_DEPLOYED
          ? undefined
          : activatedAt === null
            ? word
            : `${word} · ${input.age(activatedAt)}`,
      runs: runsOf(deployment, settled, read, input.age),
      routes: input.routes.filter((route) => route.service === hostname),
      offers: input.offers.filter((offer) => offer.service === hostname),
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
 * Otherwise — and always on a stage — a service whose own running commit carries a failed deploy:
 * it names the version that failed, which is what it runs, so nothing else is said to run on.
 */
export function stopFailedDeploy(input: {
  readonly tier: GroupEnvironmentTier;
  readonly rows: ReadonlyArray<StopServiceRow>;
  /** The group's releases, newest first. */
  readonly releases: ReadonlyArray<FlowReleaseRow>;
}): StopFailedDeploy | undefined {
  if (input.tier === "production") {
    const live = input.releases.findIndex((release) => release.standing === "live");
    const newer = live === -1 ? input.releases : input.releases.slice(0, live);
    const failed = newer.find((release) => release.failedEntry !== undefined);
    if (failed?.failedEntry !== undefined) {
      const { service, commit } = failed.failedEntry;
      return {
        label: failed.tag,
        service,
        sha: commit,
        running: input.rows.find((row) => row.hostname === service)?.runs,
      };
    }
  }
  const row = input.rows.find((entry) => entry.tone === "bad");
  const label = row?.runs?.label ?? row?.commit;
  if (row === undefined || label === undefined) return undefined;
  return { label, service: row.hostname, sha: row.sha, running: undefined };
}

/** What a stage's deploy history says beside the commit that stage runs. */
export const RUNNING_HERE = "Running here";
