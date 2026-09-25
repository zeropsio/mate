/**
 * One project's flow, in the one order every surface draws it: Mates (with
 * their preview) → pull requests → `main` → production, a group stage as an
 * optional side branch of `main`, and the one next step (the owner,
 * 2026-09-23).
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
 * it, and stands for a deploy only while the platform's answer is still on its
 * way — the precedence `stopView` draws the menu with. The page read the name
 * alone, and a service's `appVersionName` can name a commit the platform does
 * not run: `fsadfdasfsa`'s production named `055a7e8`, the merge waiting for
 * its first release, while nothing was live there.
 *
 * ## The next step
 *
 * Exactly one, worst first: a Mate waiting on an answer, then a deploy that
 * failed, then a pull request the person can merge, then one that cannot land,
 * then a release, then adding the production, then a first task for a Mate
 * nobody has spoken to. Everything `projectAttention` already decides — the
 * waiting Mate, the failed deploy, the blocked change, the release — is taken
 * from it, words and all; this adds only the steps it has no kind for.
 *
 * *Add production* is offered once `main` has code, the recipe's production
 * tier is on `main`, and the person may create one. Before that production
 * reads "After the first merge", with no button: a production made from an
 * empty `main` has nothing a release could put in it.
 *
 * ## Creations under way
 *
 * A Mate, a stage or a production the platform accepted and the listing does
 * not hold yet (the group tree's `pending`) is drawn from its birth: a Mate
 * after the listed ones, a production as being set up — so *Add production*
 * is never offered twice for one — and a stage beside the listed stages. Once
 * the listing holds the project, its listed member stands in its place.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module groupFlow
 */

import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";

import type { BirthStep } from "./birth/birthStore.ts";
import { CHECKING_WHAT_RUNS, type Deployment, NOTHING_DEPLOYED } from "./flow/deployment.ts";
import { pullRequestBlocked, type PullRequestBlocked } from "./gitTab.ts";
import type { GroupEnvironmentTier, MissingEnvironmentRow } from "./groupEnvironments.ts";
import type { DeployedVersion, EnvironmentRow } from "./groupRows.ts";
import type { Shown } from "./knowledge/known.ts";
import {
  PROJECT_ALL_CLEAR,
  projectAttention,
  type ProjectAttentionItem,
} from "./projectAttention.ts";
import {
  changeState,
  flowVerbLabel,
  type ChangeState,
  type FlowPullRequest,
} from "./projectFlow.ts";
import type { ZeropsPublicRoute } from "./publicRoutes.ts";
import { shortCommit, type ReleaseGate } from "./release.ts";

/** One Mate of the project, as the flow's first column shows it. */
export interface GroupFlowMate {
  readonly projectId: string;
  readonly name: string;
  /** The URL of the pair's stage half ({@link pairPreviewRoute}); `undefined` where it has none. */
  readonly preview: string | undefined;
  /** It has stopped and asks something — its face reads `needs`. */
  readonly waiting: boolean;
  /** Somebody has spoken into its conversation (`ZeropsAgentActivity.subject` is present). */
  readonly talked: boolean;
  /** Present while it is being created: where its birth has got to. */
  readonly coming?: GroupFlowComing;
}

/** How far a creation under way has got (the birth store's step). */
export interface GroupFlowComing {
  readonly step: BirthStep;
  /** The step outlasted its cap: the words say so. */
  readonly overdue: boolean;
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
  readonly projectId: string;
  readonly name: string;
  readonly tier: GroupEnvironmentTier;
  /** Its row, where `environments.yaml` declares it and the deploy half read it. */
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
  /** The tiers the recipe on `main` offers and the project lacks (`missingEnvironmentRows`). */
  readonly missing: ReadonlyArray<Pick<MissingEnvironmentRow, "tier">>;
  readonly release: {
    /** The flow's own gate, both halves read (`flowReleaseGate`). */
    readonly gate: ReleaseGate;
    /** The tag a release would take (`releaseOffer`). */
    readonly suggestion: string;
    /** How many changes are merged and not live (`releaseContentsSummary(...).total`). */
    readonly waiting: number;
    /** The release tag on its way to production (`releaseInFlight`). */
    readonly inFlight?: string | undefined;
  };
  /**
   * Whether any of the project's code repositories has a commit on `main`,
   * from a default-branch read of each (`GET /repos/{org}/{repo}/branches/main`).
   * `undefined` where that was not read — today it is read only for a project
   * with a production (`planMainHeadReads`). A merged code change proves it
   * either way.
   */
  readonly mainHasCode: boolean | undefined;
  /** The commit `main` is at, from the same read; `undefined` where it was not read. */
  readonly mainHead: string | undefined;
  /**
   * Whether this person may add a production to this project now: the role is
   * still creatable (`creatableRoles`), the project's adds are offered, and the
   * account lets them create projects.
   */
  readonly productionAddable: boolean;
  /** Its creations under way the listing does not hold yet (the group tree's `pending`). */
  readonly pending: ReadonlyArray<GroupFlowPending>;
}

/** An open pull request, with what is stopping it and the one word for where it stands. */
export interface GroupFlowPullRequest {
  readonly pull: FlowPullRequest;
  readonly blocked: PullRequestBlocked | null;
  readonly state: ChangeState | undefined;
}

export interface GroupFlowMain {
  /** Short; `undefined` where `main` was not read. */
  readonly head: string | undefined;
  /** `undefined` where nothing says either way. */
  readonly hasCode: boolean | undefined;
  /** Changes merged and not live. */
  readonly notLive: number;
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
}

export type GroupFlowProduction =
  /** No production yet: `addable` says whether *Add production* is offered. */
  | { readonly kind: "absent"; readonly line: string; readonly addable: boolean }
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
  | "fix-deploy"
  | "merge"
  | "unblock"
  | "release"
  | "add-production"
  | "first-task"
  | "none";

export type GroupNextStepTarget =
  | NonNullable<ProjectAttentionItem["target"]>
  | { readonly kind: "release"; readonly tag: string }
  | { readonly kind: "add-production" };

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
  /** The open code changes, newest first. */
  readonly pullRequests: ReadonlyArray<GroupFlowPullRequest>;
  /** The open changes to the group repo's recipe, newest first — not a step of the flow. */
  readonly recipeChanges: ReadonlyArray<GroupFlowPullRequest>;
  readonly main: GroupFlowMain;
  /** Zero or more (D16), in the order the project holds them. */
  readonly stages: ReadonlyArray<GroupFlowStop>;
  /** Stages being created that the listing does not hold yet, oldest first. */
  readonly creatingStages: ReadonlyArray<GroupFlowPending>;
  readonly production: GroupFlowProduction;
  readonly nextStep: GroupNextStep;
}

/** Production's line before `main` has anything in it. */
export const PRODUCTION_AFTER_FIRST_MERGE = "After the first merge";
/** Production's line once `main` has code and no production is there. */
export const PRODUCTION_NOT_SET_UP = "Not set up";
/** Production's line while its creation is under way. */
export const PRODUCTION_SETTING_UP = "Setting up production…";
/** Production's line while a deploy runs on it. */
export const PRODUCTION_DEPLOYING = "Deploying…";
/** A stage's line while its creation is under way. */
export const STAGE_SETTING_UP = "Setting up a stage…";
/** Beside *Add production*, where the verb is: the Mate's part ends at the pull request. */
export const PRODUCTION_ADDED_HERE = "Production is added here, not by the Mate.";
/** The verb that adds it. */
export const ADD_PRODUCTION_LABEL = "Add production";
/** The step that asks for it. */
export const MAIN_WITHOUT_PRODUCTION = "main has code, no production yet";

/** Newest first — the one a person is most likely waiting on. */
function byNewest(left: FlowPullRequest, right: FlowPullRequest): number {
  return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") || right.number - left.number;
}

function flowPullRequestOf(pull: FlowPullRequest): GroupFlowPullRequest {
  return { pull, blocked: pullRequestBlocked(pull), state: changeState(pull) };
}

/** What a stop runs, by the precedence `stopView` draws the menu with. */
function stopOf(input: GroupFlowStopInput): GroupFlowStop {
  const { deployment, row } = input;
  const named = row !== undefined && row.version.label !== undefined ? row.version : undefined;
  const base = {
    projectId: input.projectId,
    name: input.name,
    source: row?.source,
    route: input.route,
  };
  if (deployment?.state === "known") {
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
    return { ...base, state: runningState(row), version: named ?? deployment.value.version };
  }
  if (named !== undefined) return { ...base, state: runningState(row), version: named };
  return { ...base, state: "checking", version: undefined };
}

function runningState(row: EnvironmentRow | undefined): GroupFlowStopState {
  switch (row?.tone) {
    case "bad":
      return "failed";
    case "pending":
      return "deploying";
    default:
      return "deployed";
  }
}

function productionOf(
  stop: GroupFlowStop | undefined,
  input: GroupFlowInput,
  main: GroupFlowMain,
): GroupFlowProduction {
  const creation = input.pending.find((entry) => entry.kind === "production");
  if (stop === undefined && creation !== undefined)
    return { kind: "creating", line: PRODUCTION_SETTING_UP, creation };
  if (stop === undefined) {
    const addable =
      main.hasCode === true &&
      input.productionAddable &&
      input.missing.some((row) => row.tier === "production");
    return {
      kind: "absent",
      line: main.hasCode === false ? PRODUCTION_AFTER_FIRST_MERGE : PRODUCTION_NOT_SET_UP,
      addable,
    };
  }
  const line =
    stop.state === "checking" ? CHECKING_WHAT_RUNS : (stop.version?.label ?? NOTHING_DEPLOYED);
  const candidate = releaseOffered(input)
    ? { tag: input.release.suggestion, waiting: input.release.waiting }
    : undefined;
  if (stop.state === "failed") return { kind: "deploy-failed", stop, line, candidate };
  if (input.release.inFlight !== undefined)
    return { kind: "releasing", stop, line, tag: input.release.inFlight };
  if (candidate !== undefined) return { kind: "ready-to-release", stop, line, candidate };
  if (stop.state === "checking") return { kind: "checking", stop, line };
  if (stop.state === "deploying") return { kind: "deploying", stop, line: PRODUCTION_DEPLOYING };
  return { kind: stop.state === "empty" ? "empty" : "live", stop, line };
}

function releaseOffered(input: GroupFlowInput): boolean {
  return input.release.gate.allowed && input.release.waiting > 0;
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
    waitingMates: input.mates.filter((mate) => mate.waiting),
    failedStops: [...failedProduction, ...failedStages],
    pullRequests: input.pullRequests,
    notLive: input.release.waiting,
    canRelease:
      production.kind !== "absent" && production.kind !== "creating" && input.release.gate.allowed,
    mateNames: new Map(input.mates.map((mate) => [mate.projectId, mate.name])),
  });
  const first = (kind: ProjectAttentionItem["kind"]) =>
    attention.find((item) => item.kind === kind);

  const waiting = first("mate-waiting");
  if (waiting !== undefined) return fromAttention("answer-mate", waiting);
  const failed = first("deploy-failed");
  if (failed !== undefined) return fromAttention("fix-deploy", failed);

  const mergeable = pullRequests.find((entry) => entry.pull.mergeability === "mergeable")?.pull;
  if (mergeable !== undefined)
    return {
      kind: "merge",
      text: `Pull request #${String(mergeable.number)} waits for your merge`,
      verb: flowVerbLabel("merge", false),
      target: { kind: "change", repository: mergeable.repository, number: mergeable.number },
    };

  const blocked = first("change-blocked");
  if (blocked !== undefined) return fromAttention("unblock", blocked);
  const notLive = first("not-live");
  if (notLive !== undefined)
    return {
      kind: "release",
      text: notLive.text,
      verb: `${flowVerbLabel("release", false)} ${input.release.suggestion}`,
      target: { kind: "release", tag: input.release.suggestion },
    };

  if (production.kind === "absent" && production.addable)
    return {
      kind: "add-production",
      text: MAIN_WITHOUT_PRODUCTION,
      verb: ADD_PRODUCTION_LABEL,
      target: { kind: "add-production" },
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
  const pullRequests = open.filter((pull) => pull.kind === "code").map(flowPullRequestOf);
  const recipeChanges = open.filter((pull) => pull.kind === "recipe").map(flowPullRequestOf);
  const landedCode = input.merged.some((pull) => pull.kind === "code");
  const main: GroupFlowMain = {
    head: input.mainHead === undefined ? undefined : shortCommit(input.mainHead),
    hasCode: input.mainHasCode ?? (landedCode ? true : undefined),
    notLive: input.release.waiting,
  };
  const stops = input.stops.map(stopOf);
  const stages = stops.filter((_, index) => input.stops[index]?.tier === "stage");
  const productionStop = stops.find((_, index) => input.stops[index]?.tier === "production");
  const production = productionOf(productionStop, input, main);
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
      coming: { step: entry.step, overdue: entry.overdue },
    }));
  return {
    groupId: input.groupId,
    mates: [...input.mates, ...comingMates],
    pullRequests,
    recipeChanges,
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
