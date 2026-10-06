/**
 * One project's flow, in the one order every surface draws it: Mates (with
 * their preview) → pull requests → `main` → production, a group stage as a
 * side branch of `main`, and the one next step (the owner, 2026-09-23).
 *
 * The projects page, the left menu and a Mate's conversation each drew a leg
 * of this from the same reads and came to different answers: for one project
 * the menu said production had "Nothing deployed yet" while the page said it
 * ran `055a7e8`. So what a stop runs, what `main` holds and what the person is
 * asked to do next are decided here once, and a surface only lays them out.
 *
 * ## What a stop runs
 *
 * Whether anything runs is the platform's pushed deployment (`stopDeployment`,
 * D6); the deploy half's version name (`environmentRow`) names it and colours
 * it only once the platform confirms that version runs — the precedence `stopView`
 * draws the menu with. An unread or failed runtime answer stands on every surface. The page read the name
 * alone, and a service's `appVersionName` can name a commit the platform does
 * not run: `fsadfdasfsa`'s production named `055a7e8`, the merge waiting for
 * its first release, while nothing was live there.
 *
 * ## The next step
 *
 * Exactly one, worst first: a Mate waiting on an answer, then a deploy that
 * failed, then a pull request the person can merge, then one that cannot land,
 * then a release, then a first task for a Mate nobody has spoken to.
 * Everything `projectAttention` already decides — the waiting Mate, the failed
 * deploy, the blocked change, the release — is taken from it, words and all;
 * this adds only the steps it has no kind for.
 *
 * An environment nobody added is never a step: a missing stage or production
 * is a quiet slot with *Add* (`environmentSlots`), not a thing that waits on
 * anybody (the owner, 2026-09-28 and 2026-10-05).
 *
 * ## Creations under way
 *
 * A Mate, a stage or a production the platform accepted and the listing does
 * not hold yet (the group tree's `pending`) is drawn from its birth: a Mate
 * after the listed ones, a production as being set up, and a stage beside the
 * listed stages. Once the listing holds the project, its listed member stands
 * in its place.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module groupFlow
 */

import type { EnvironmentBirth } from "@t3tools/shared/hqDeploys";
import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";

import {
  CHECKING_WHAT_RUNS,
  type Deployment,
  NOTHING_DEPLOYED,
  runningTone,
  runningVersion,
  stopView,
  deploymentReadFailed,
} from "./flow/deployment.ts";
import { pullRequestBlocked, type PullRequestBlocked } from "./gitTab.ts";
import type { GroupEnvironmentTier } from "./groupEnvironments.ts";
import type { ZeropsMateFace } from "./groups.ts";
import type { DeployedVersion, EnvironmentRow, GroupRowTone } from "./groupRows.ts";
import type { HqJob } from "./hq/environments.ts";
import type { Shown } from "./knowledge/known.ts";
import {
  PROJECT_ALL_CLEAR,
  projectAttention,
  type ProjectAttentionItem,
} from "./projectAttention.ts";
import {
  changeShowsReview,
  changeState,
  type ChangeState,
  type FlowPullRequest,
} from "./projectFlow.ts";
import type { ZeropsPublicRoute } from "./publicRoutes.ts";
import { shortCommit, type ReleaseGate } from "./release.ts";
import { REVIEW_LABEL, REVIEW_RELEASE_LABEL } from "./reviewVerdict.ts";
import { firstDeploy, stopImport, type FirstDeploy, type PlatformService } from "./stopComing.ts";

/** One Mate of the project, as the flow's first column shows it. */
export interface GroupFlowMate {
  readonly projectId: string;
  readonly name: string;
  /** The URL of the pair's stage half ({@link pairPreviewRoute}); `undefined` where it has none. */
  readonly preview: string | undefined;
  /** It has stopped and asks something — its face reads `needs`. */
  readonly waiting: boolean;
  /** Its last run stopped on an error: its face reads `needs` too, but it asks nothing. */
  readonly failed?: boolean;
  /** Somebody has spoken into its conversation (`ZeropsAgentActivity.subject` is present). */
  readonly talked: boolean;
  /** It works — a turn, or helpers it started: its changes ask for nothing until it rests. */
  readonly working?: boolean;
  /** Present while it is being created: where its birth has got to. */
  readonly coming?: GroupFlowComing;
}

/** A creation under way, drawn until the listing holds it. */
export interface GroupFlowComing {
  /** The face its person picked for a Mate, worn asleep while it comes up. */
  readonly face?: ZeropsMateFace | undefined;
  /** Its creation stopped before the platform took it: the words say so. */
  readonly failed?: boolean | undefined;
}

/** A creation under way in the group, as its birth knows it (`ZeropsGroupPendingMember`). */
export interface GroupFlowPending extends GroupFlowComing {
  readonly projectId: string;
  readonly kind: RoleProjectKind;
  /** What the person called the environment. */
  readonly name: string;
}

/** One group stage or the production, as the surfaces hold it. */
export interface GroupFlowStopInput {
  readonly projectStatus?: string | undefined;
  readonly services?: ReadonlyArray<PlatformService> | undefined;
  readonly projectId: string;
  readonly name: string;
  readonly tier: GroupEnvironmentTier;
  /** Its row, where HQ records the environment and its deploys (`environmentRowInputsOf`). */
  readonly row: EnvironmentRow | undefined;
  /** The platform's pushed answer (`ZeropsProjectFlowValue.deployments`); `undefined` unread. */
  readonly deployment: Shown<Deployment> | undefined;
  /** Its first public route's URL. */
  readonly route: string | undefined;
}

export interface GroupFlowInput {
  readonly groupId: string;
  /** In the group tree's order. */
  readonly mates: ReadonlyArray<GroupFlowMate>;
  /** Every open pull request of the project, code and recipe. */
  readonly pullRequests: ReadonlyArray<FlowPullRequest>;
  /** The ones that have landed. */
  readonly merged: ReadonlyArray<FlowPullRequest>;
  /** Every group stage and the production the project holds, declared or not. */
  readonly stops: ReadonlyArray<GroupFlowStopInput>;
  readonly release: {
    /** The flow's own gate (`ZeropsReleaseOffer.gate`). */
    readonly gate: ReleaseGate;
    /** The tag a release would take (`releaseOffer`). */
    readonly suggestion: string;
    /** How many changes are merged and not live (`releaseContentsSummary(...).total`). */
    readonly waiting: number;
    /** Whether that is only how many at least (`releaseContentsSummary(...).atLeast`). */
    readonly waitingAtLeast: boolean;
    /** Production's services whose commit cannot be told (`releaseReads`' `untold`). */
    readonly untold: ReadonlyArray<string>;
    /** The release tag on its way to production (`releaseInFlight`). */
    readonly inFlight?: string | undefined;
  };
  /**
   * Whether any of the project's code repositories has a commit on `main`; `undefined` where it
   * was not read, as no caller reads it today. A merged code change proves it either way.
   */
  readonly mainHasCode: boolean | undefined;
  /** The commit `main` is at; `undefined` where it was not read. */
  readonly mainHead: string | undefined;
  /** Its creations under way the listing does not hold yet (the group tree's `pending`). */
  readonly pending: ReadonlyArray<GroupFlowPending>;
}

/** An open pull request, with what is stopping it and the one word for where it stands. */
export interface GroupFlowPullRequest {
  readonly pull: FlowPullRequest;
  readonly blocked: PullRequestBlocked | null;
  readonly state: ChangeState | undefined;
  /** It shows its *Review* where it is listed (`changeShowsReview`). */
  readonly review: boolean;
}

export interface GroupFlowMain {
  /** Short; `undefined` where `main` was not read. */
  readonly head: string | undefined;
  /** `undefined` where nothing says either way. */
  readonly hasCode: boolean | undefined;
  /** Changes merged and not live. */
  readonly notLive: number;
  /** Whether that is only how many at least: HQ stopped counting. */
  readonly notLiveAtLeast: boolean;
}

/** Where one stop's last deploy stands. */
export type GroupFlowStopState = "checking" | "empty" | "deploying" | "deployed" | "failed";

export interface GroupFlowStop {
  readonly projectId: string;
  readonly name: string;
  readonly state: GroupFlowStopState;
  /** What it runs; `undefined` for nothing, or nothing known yet. */
  readonly version: DeployedVersion | undefined;
  /** What feeds it — `main` for a stage, `release` for a production; `undefined` undeclared. */
  readonly source: string | undefined;
  readonly route: string | undefined;
  /** The runtime answer while the flow names nothing, or while its read failed. */
  readonly readLine?: string;
  /** A runtime attempt ended without an answer, even if serving metadata is still unread. */
  readonly readFailed?: true;
  /**
   * A stage that runs nothing: its first deploy on its way, or failed (`stageFirstDeploy`).
   * `undefined` while HQ has none under way.
   */
  readonly firstDeploy?: Exclude<FirstDeploy, { readonly kind: "awaited" }> | undefined;
  /** HQ bringing it up (`EnvironmentRow.birth`), which says whether it is coming up. */
  readonly birth?: EnvironmentBirth | null;
}

export type GroupFlowProduction =
  /** No production: nothing is said of it, and nothing waits on it. */
  | { readonly kind: "absent" }
  /** Its creation is under way and the listing does not hold it yet; nothing is offered. */
  | { readonly kind: "creating"; readonly line: string; readonly creation: GroupFlowPending }
  | {
      /** `deploying`: a deploy is running on it, whatever it ran before. */
      readonly kind: "checking" | "empty" | "deploying" | "live";
      readonly stop: GroupFlowStop;
      readonly line: string;
    }
  | {
      /**
       * The last deploy failed. `candidate` still carries what a release
       * would tag where one is offered (D28) — the failure does not hide the
       * new release that might clear it.
       */
      readonly kind: "deploy-failed";
      readonly stop: GroupFlowStop;
      readonly line: string;
      readonly candidate: { readonly tag: string; readonly waiting: number } | undefined;
    }
  | {
      /** A release is tagged and production does not run it yet; no second one is offered. */
      readonly kind: "releasing";
      readonly stop: GroupFlowStop;
      readonly line: string;
      readonly tag: string;
    }
  | {
      readonly kind: "ready-to-release";
      readonly stop: GroupFlowStop;
      readonly line: string;
      readonly candidate: { readonly tag: string; readonly waiting: number };
    };

export type GroupNextStepKind =
  | "answer-mate"
  | "fix-mate"
  | "fix-deploy"
  | "merge"
  | "unblock"
  | "release"
  | "first-task"
  | "none";

export type GroupNextStepTarget =
  | NonNullable<ProjectAttentionItem["target"]>
  | { readonly kind: "release"; readonly tag: string };

export interface GroupNextStep {
  readonly kind: GroupNextStepKind;
  readonly text: string;
  readonly verb: string | undefined;
  readonly target: GroupNextStepTarget | undefined;
}

export interface GroupFlow {
  readonly groupId: string;
  /** The listed Mates, then the ones being created (`coming`). */
  readonly mates: ReadonlyArray<GroupFlowMate>;
  /** Every open change, code and recipe, newest first. */
  readonly pullRequests: ReadonlyArray<GroupFlowPullRequest>;
  readonly main: GroupFlowMain;
  /** Zero or more (D16), in the order the project holds them. */
  readonly stages: ReadonlyArray<GroupFlowStop>;
  /** Stages being created that the listing does not hold yet, oldest first. */
  readonly creatingStages: ReadonlyArray<GroupFlowPending>;
  readonly production: GroupFlowProduction;
  readonly nextStep: GroupNextStep;
}

/** Production's line while its creation is under way. */
export const PRODUCTION_SETTING_UP = "Setting up production…";
/** Production's line while a deploy runs on it. */
export const PRODUCTION_DEPLOYING = "Deploying…";
/** A stage's line while its creation is under way (`stopComing.ts`). */
export { STAGE_SETTING_UP } from "./stopComing.ts";

/** Newest first — the one a person is most likely waiting on. */
function byNewest(left: FlowPullRequest, right: FlowPullRequest): number {
  return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") || right.number - left.number;
}

function flowPullRequestOf(
  pull: FlowPullRequest,
  mate: GroupFlowMate | undefined,
): GroupFlowPullRequest {
  return {
    pull,
    blocked: pullRequestBlocked(pull),
    state: changeState(pull),
    review: changeShowsReview(pull, mate),
  };
}

/** What a stop runs and how it went, by the rules `stopView` draws the page with (`runningVersion`, `runningTone`). */
function stopOf(input: GroupFlowStopInput): GroupFlowStop {
  const { deployment, row } = input;
  const base = {
    projectId: input.projectId,
    name: input.name,
    source: row?.source,
    route: input.route,
    ...(row?.birth === undefined ? {} : { birth: row.birth }),
  };
  if (deployment?.state === "known" && !deploymentReadFailed(deployment)) {
    if (deployment.value.kind === "none") return { ...base, state: "empty", version: undefined };
    // A build runs now: what it builds is the stop's answer, whatever the row read before it.
    if (deployment.value.kind === "deploying") {
      const { version } = deployment.value;
      return {
        ...base,
        state: "deploying",
        version: version.label === undefined ? undefined : version,
      };
    }
    return {
      ...base,
      state: runningState(runningTone(deployment.value.version, row)),
      version: runningVersion(deployment.value.version, row),
    };
  }
  if (!deploymentReadFailed(deployment) && row?.version.label !== undefined)
    return {
      ...base,
      state: runningState(runningTone(undefined, row)),
      version: runningVersion(undefined, row),
    };
  return {
    ...base,
    state: "checking",
    version: undefined,
    // Access still being verified is a read not made yet: no failure for a chip to say.
    ...(deploymentReadFailed(deployment) && !awaitingAccess(deployment)
      ? { readFailed: true as const }
      : {}),
    readLine: stopView({
      deployment: deployment ?? { state: "unread", waitingFor: null },
      row,
      nowMs: 0,
    }).line,
  };
}

const awaitingAccess = (deployment: Shown<Deployment> | undefined): boolean =>
  deployment?.state === "withheld" && deployment.reason === "access-unverified";

/** A stage known to run nothing, with where its first deploy stands (`stageFirstDeploy`). */
function withFirstDeploy(stop: GroupFlowStop, input: GroupFlowStopInput): GroupFlowStop {
  // Only a stage that runs nothing, or nothing known yet, waits for a first deploy.
  if (deploymentReadFailed(input.deployment)) return stop;
  if (input.tier !== "stage" || (stop.state !== "empty" && stop.state !== "checking")) return stop;
  const first = stageFirstDeploy({
    birth: input.row?.birth,
    projectStatus: input.projectStatus,
    services: input.services,
    deployment: input.deployment,
    deploys: input.row?.deploys,
    keyGap: input.row?.keyGap ?? false,
  });
  return first === undefined ? stop : { ...stop, firstDeploy: first };
}

/**
 * Where a stage's first deploy stands, the one reading every surface says it by — its cell, the
 * menu, its own page: only for a stage known to run nothing — a build HQ did not make that Zerops
 * ended failed, or as HQ's records of it say (`firstDeploy`). `undefined` while HQ has none under
 * way, or nothing can be promised.
 */
export function stageSettingUp(input: {
  readonly birth?: EnvironmentBirth | null | undefined;
  readonly projectStatus?: string | undefined;
  readonly services?: ReadonlyArray<PlatformService> | undefined;
}): ReturnType<typeof stopImport> {
  return stopImport({
    birth: input.birth,
    projectStatus: input.projectStatus,
    services: input.services,
  });
}

export function stageFirstDeploy(input: {
  /** HQ bringing it up (`EnvironmentRow.birth`): its setting up is said only while it does. */
  readonly birth?: EnvironmentBirth | null | undefined;
  /** Its project's status, as the platform lists it. */
  readonly projectStatus?: string | undefined;
  /** Its services as the platform lists them; with them, nothing is said while it is being made. */
  readonly services?: ReadonlyArray<PlatformService> | undefined;
  /** What it runs, as the platform pushed it (`ZeropsProjectFlowValue.deployments`). */
  readonly deployment: Shown<Deployment> | undefined;
  /** HQ's newest job of each of its services (`EnvironmentRow.deploys`); `undefined` undeclared. */
  readonly deploys: ReadonlyArray<HqJob> | undefined;
  /** HQ holds no deploy key that works for it (`EnvironmentRow.keyGap`). */
  readonly keyGap: boolean;
}): Exclude<FirstDeploy, { readonly kind: "awaited" }> | undefined {
  const { deployment } = input;
  // Something runs or builds there: no first deploy to wait for.
  if (deployment?.state === "known" && deployment.value.kind !== "none") return undefined;
  // A build HQ did not make, which Zerops ended failed with nothing running: Zerops' word on it,
  // however long ago it was asked. One HQ made is its job's to say (`firstDeploy`).
  const failedBuild =
    deployment?.state === "known" && deployment.value.kind === "none"
      ? deployment.value.failedBuild
      : undefined;
  if (
    failedBuild !== undefined &&
    !(input.deploys ?? []).some((job) => job.processId === failedBuild.processId)
  )
    return { kind: "failed", reason: failedBuild.reason };
  const step = stageSettingUp(input);
  if (step !== undefined) return { kind: "setting-up", step };
  if (deployment?.state !== "known") return undefined;
  if (input.deploys === undefined) return undefined;
  const first = firstDeploy({ deploys: input.deploys, keyGap: input.keyGap });
  return first.kind === "awaited" ? undefined : first;
}

function runningState(tone: GroupRowTone): GroupFlowStopState {
  switch (tone) {
    case "bad":
      return "failed";
    case "pending":
      return "deploying";
    default:
      return "deployed";
  }
}

function productionOf(stop: GroupFlowStop | undefined, input: GroupFlowInput): GroupFlowProduction {
  const creation = input.pending.find((entry) => entry.kind === "production");
  if (stop === undefined && creation !== undefined)
    return { kind: "creating", line: PRODUCTION_SETTING_UP, creation };
  if (stop === undefined) return { kind: "absent" };
  const line =
    stop.state === "checking"
      ? (stop.readLine ?? CHECKING_WHAT_RUNS)
      : (stop.version?.label ?? NOTHING_DEPLOYED);
  const candidate = releaseOffered(input)
    ? { tag: input.release.suggestion, waiting: input.release.waiting }
    : undefined;
  if (stop.state === "failed") return { kind: "deploy-failed", stop, line, candidate };
  if (stop.state === "checking") return { kind: "checking", stop, line };
  if (input.release.inFlight !== undefined)
    return { kind: "releasing", stop, line, tag: input.release.inFlight };
  if (candidate !== undefined) return { kind: "ready-to-release", stop, line, candidate };
  if (stop.state === "deploying") return { kind: "deploying", stop, line: PRODUCTION_DEPLOYING };
  return { kind: stop.state === "empty" ? "empty" : "live", stop, line };
}

/** Release is offered where something is counted, or where what production runs cannot be told. */
function releaseOffered(input: GroupFlowInput): boolean {
  const { gate, waiting, untold } = input.release;
  return gate.allowed && (waiting > 0 || untold.length > 0);
}

/** The one step, worst first; `projectAttention` decides every kind it has. */
function nextStepOf(
  input: GroupFlowInput,
  pullRequests: ReadonlyArray<GroupFlowPullRequest>,
  stages: ReadonlyArray<GroupFlowStop>,
  production: GroupFlowProduction,
): GroupNextStep {
  // A failed stage is a failed stop too (owner, 2026-09-25): somebody has to
  // look at its build, so it is the deploy to fix — after production's own
  // failure, which reaches people. The release still does not wait on it
  // (D28): `production` keeps its candidate whatever a stage does.
  const failedProduction =
    production.kind === "deploy-failed"
      ? [{ projectId: production.stop.projectId, name: production.stop.name }]
      : [];
  const failedStages = stages
    .filter((stage) => stage.state === "failed")
    .map((stage) => ({ projectId: stage.projectId, name: stage.name }));
  const attention = projectAttention({
    waitingMates: input.mates.filter((mate) => mate.waiting && mate.failed !== true),
    failedMates: input.mates.filter((mate) => mate.failed === true),
    failedStops: [...failedProduction, ...failedStages],
    pullRequests: input.pullRequests,
    notLive: input.release.waiting,
    notLiveAtLeast: input.release.waitingAtLeast,
    canRelease:
      production.kind !== "absent" && production.kind !== "creating" && input.release.gate.allowed,
    mateNames: new Map(input.mates.map((mate) => [mate.projectId, mate.name])),
  });
  const first = (kind: ProjectAttentionItem["kind"]) =>
    attention.find((item) => item.kind === kind);

  const waiting = first("mate-waiting");
  if (waiting !== undefined) return fromAttention("answer-mate", waiting);
  const stopped = first("mate-failed");
  if (stopped !== undefined) return fromAttention("fix-mate", stopped);
  const failed = first("deploy-failed");
  if (failed !== undefined) return fromAttention("fix-deploy", failed);

  const mergeable = pullRequests.find(
    (entry) => entry.pull.mergeability === "mergeable" && entry.review,
  )?.pull;
  if (mergeable !== undefined)
    return {
      kind: "merge",
      text: `Change #${String(mergeable.number)} waits for your merge`,
      // The door to the change's review, which merges it (pass 16, R1).
      verb: REVIEW_LABEL,
      target: { kind: "change", repository: mergeable.repository, number: mergeable.number },
    };

  const blocked = first("change-blocked");
  if (blocked !== undefined) return fromAttention("unblock", blocked);
  const notLive = first("not-live");
  if (notLive !== undefined)
    return {
      kind: "release",
      text: notLive.text,
      verb: REVIEW_RELEASE_LABEL,
      target: { kind: "release", tag: input.release.suggestion },
    };

  const untouched =
    input.pullRequests.length === 0 &&
    input.merged.length === 0 &&
    !input.mates.some((mate) => mate.talked);
  const fresh = untouched ? input.mates[0] : undefined;
  if (fresh !== undefined)
    return {
      kind: "first-task",
      text: `Give ${fresh.name} a first task`,
      verb: `Open ${fresh.name}`,
      target: { kind: "mate", projectId: fresh.projectId },
    };

  return { kind: "none", text: PROJECT_ALL_CLEAR, verb: undefined, target: undefined };
}

function fromAttention(kind: GroupNextStepKind, item: ProjectAttentionItem): GroupNextStep {
  return { kind, text: item.text, verb: item.verb, target: item.target };
}

/** One project's flow, from what the surfaces already read for it. */
export function groupFlow(input: GroupFlowInput): GroupFlow {
  const open = [...input.pullRequests].sort(byNewest);
  const mates = new Map(input.mates.map((mate) => [mate.projectId, mate] as const));
  const pullRequests = open.map((pull) => flowPullRequestOf(pull, mates.get(pull.mateProjectId)));
  const landedCode = input.merged.some((pull) => pull.kind === "code");
  const main: GroupFlowMain = {
    head: input.mainHead === undefined ? undefined : shortCommit(input.mainHead),
    hasCode: input.mainHasCode ?? (landedCode ? true : undefined),
    notLive: input.release.waiting,
    notLiveAtLeast: input.release.waitingAtLeast,
  };
  const stops = input.stops.map((stop) => withFirstDeploy(stopOf(stop), stop));
  const stages = stops.filter((_, index) => input.stops[index]?.tier === "stage");
  const productionStop = stops.find((_, index) => input.stops[index]?.tier === "production");
  const production = productionOf(productionStop, input);
  // The listed member wins: a creation the listing already holds is drawn from there.
  const listed = new Set([...input.mates, ...input.stops].map((entry) => entry.projectId));
  const pending = input.pending.filter((entry) => !listed.has(entry.projectId));
  const comingMates = pending
    .filter((entry) => entry.kind === "mate")
    .map((entry): GroupFlowMate => ({
      projectId: entry.projectId,
      name: entry.name,
      preview: undefined,
      waiting: false,
      talked: false,
      coming: {
        ...(entry.face === undefined ? {} : { face: entry.face }),
        ...(entry.failed === true ? { failed: true } : {}),
      },
    }));
  return {
    groupId: input.groupId,
    mates: [...input.mates, ...comingMates],
    pullRequests,
    main,
    stages,
    creatingStages: pending.filter((entry) => entry.kind === "stage"),
    production,
    nextStep: nextStepOf(input, pullRequests, stages, production),
  };
}

/**
 * A Mate's preview: the public route of its pair's stage half (spec-mate
 * §10.10) — `appstage` beside `appdev`, `todoappstage` beside `todoapp`.
 *
 * A route whose service merely ends in `stage` is not one: without its dev
 * half in the same project it is a service somebody named that way.
 */
export function pairPreviewRoute(
  routes: ReadonlyArray<ZeropsPublicRoute>,
  hostnames: ReadonlyArray<string>,
): ZeropsPublicRoute | undefined {
  const held = new Set(hostnames);
  return routes.find((route) => {
    const base = /^(.+)stage$/u.exec(route.service)?.[1];
    return base !== undefined && (held.has(`${base}dev`) || held.has(base));
  });
}
