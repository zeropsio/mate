/**
 * The projects page's decisions over `groupFlow` — which view, which steps
 * the strip lifts, which groups fold away, which cell a verb belongs in — the
 * words and the placement, not the pixels. The groups' order is the tree's
 * (`projectOrderPreference.ts`); nothing here reorders them.
 *
 * Every group is drawn in the one order its code travels: Mates (with their
 * preview) → pull requests → `main` → production, a group stage as an
 * optional side branch of `main` (the owner, 2026-09-23). What each step holds
 * and the one next step are `groupFlow`'s; this only decides how the page
 * lays a set of them out.
 */

import {
  botDisplayName,
  deployWord,
  environmentNameUnderGroup,
  hasMate,
  pairPreviewRoute,
  readZeropsGroupTags,
  releaseContentsSummary,
  releaseInFlightReason,
  type EnvironmentRow,
  type FlowPullRequest,
  type GroupEnvironmentTier,
  type GroupFlow,
  type GroupFlowInput,
  type GroupFlowStop,
  type GroupFlowStopState,
  type GroupNextStepKind,
  type GroupRowTone,
  type MissingEnvironmentRow,
  type ReleaseGate,
  type ZeropsEnvironmentRole,
  type ZeropsEnvironmentServices,
  type ZeropsGroup,
  type ZeropsPublicRoute,
  type ZeropsToolKind,
} from "@t3tools/client-runtime/zerops";
import {
  CHECKING_WHAT_RUNS,
  NOTHING_DEPLOYED,
  type Deployment,
} from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { mateFaceFor, type ZeropsAgentActivity } from "~/zerops/agentActivity";
import { creatableRoles } from "../ZeropsGroupTree.logic";
import type { ZeropsRowAction } from "../ZeropsProjectRow.logic";

/** What a tool is called where there is no project to name yet — the add verb. */
export const TOOL_LABEL: Record<ZeropsToolKind, string> = { gitea: "Gitea" };

/** The page's URL, shared with a Mate's conversation (the thread links here). */
export interface ProjectsSearch {
  /** Absent is the Overview. */
  readonly view?: "projects";
  /** The group whose card the Projects view scrolls to. */
  readonly group?: string;
}

/** `/zerops?view=projects&group=<groupId>`: anything else is the Overview. */
export function parseProjectsSearch(raw: Record<string, unknown>): ProjectsSearch {
  const group = typeof raw.group === "string" && raw.group.length > 0 ? raw.group : undefined;
  return {
    ...(raw.view === "projects" ? { view: "projects" as const } : {}),
    ...(group === undefined ? {} : { group }),
  };
}

/** The steps somebody has something to do for: the strip gathers them, the left menu dots them. */
const STRIP_STEPS: ReadonlySet<GroupNextStepKind> = new Set([
  "answer-mate",
  "fix-deploy",
  "merge",
  "unblock",
  "release",
  "add-production",
]);

/** Whether a next step waits on somebody — never a first task (the Mate is the way in) or none. */
export function nextStepAwaitsSomebody(kind: GroupNextStepKind): boolean {
  return STRIP_STEPS.has(kind);
}

/**
 * How many columns the wide "Next steps" strip takes for `count` steps: as
 * few rows as three columns allow, then as few columns as fill those rows
 * evenly — four steps are two by two, not three and one left alone.
 */
export function stripColumns(count: number): 1 | 2 | 3 {
  const rows = Math.max(1, Math.ceil(count / 3));
  return Math.min(3, Math.max(1, Math.ceil(count / rows))) as 1 | 2 | 3;
}

/** Where a group is drawn: a row (a card in Projects), or an "Only a Mate so far" tile. */
export type GroupPlacement = "row" | "tile";

/**
 * A group the page lays out, with what is settled about it. A group moves
 * between the rows and the tiles only on settled facts — never because a read
 * is still out or a Mate is reconnecting — so the list never reshuffles on its
 * own (design-system, 2026-09-10).
 */
export interface FoldedGroupInput {
  readonly flow: GroupFlow;
  /** Its Gitea side answered. Unread is not empty: a group is folded only on an answer. */
  readonly read: boolean;
  /** Every Mate's talk is known (`GroupMemberFacts.mate.talked`), so a first task is one. */
  readonly talkSettled: boolean;
  /** Where it was last drawn in this account's lifetime; `undefined` if never. */
  readonly placed: GroupPlacement | undefined;
}

export interface FoldedGroups<E> {
  /** One row (Overview) or one card (Projects) each. */
  readonly active: ReadonlyArray<E>;
  /** Only a Mate so far, nobody has spoken to it: a tile each. */
  readonly early: ReadonlyArray<E>;
  /** The ones whose next step is somebody's to take, in the order given. */
  readonly nextSteps: ReadonlyArray<E>;
}

/** Every Mate among a group's members is known to have been spoken to or not. */
export function talkSettled(members: ReadonlyArray<GroupMemberFacts>): boolean {
  return members.every((member) => member.mate === undefined || member.mate.talked !== undefined);
}

/**
 * A group with a Mate and nothing else — no pull request, nothing merged, no
 * stage, no production, nobody has spoken to its Mate — has one thing to say
 * ("give it a first task"), so it is a tile rather than a row of four empty
 * steps. Decided only on settled facts; until then it stays where it was last
 * drawn, and a group never drawn is a row.
 */
export function groupPlacement(entry: FoldedGroupInput): GroupPlacement {
  if (!entry.read || !entry.talkSettled) return entry.placed ?? "row";
  const { flow } = entry;
  const onlyAMate =
    flow.nextStep.kind === "first-task" &&
    flow.stages.length === 0 &&
    flow.production.kind === "absent" &&
    flow.recipeChanges.length === 0;
  return onlyAMate ? "tile" : "row";
}

export function foldGroups<E extends FoldedGroupInput>(entries: ReadonlyArray<E>): FoldedGroups<E> {
  return {
    active: entries.filter((entry) => groupPlacement(entry) === "row"),
    early: entries.filter((entry) => groupPlacement(entry) === "tile"),
    nextSteps: entries.filter((entry) => nextStepAwaitsSomebody(entry.flow.nextStep.kind)),
  };
}

/** The four steps of a group's flow, as the page's cells. */
export type FlowCell = "mates" | "pull-requests" | "main" | "production";

/**
 * The cell a group's next step is taken in, so its verb stands beside the
 * thing it acts on: a merge on the pull request, a release on production, an
 * answer on the Mate. A failed stage deploy sits under `main`, where the stage
 * is drawn. `undefined` where nothing waits, and for a first task: the Mate
 * itself is the way in, so no cell carries a verb for it.
 */
export function nextStepCell(flow: GroupFlow): FlowCell | undefined {
  const { nextStep } = flow;
  switch (nextStep.kind) {
    case "answer-mate":
      return "mates";
    case "merge":
    case "unblock":
      return "pull-requests";
    case "release":
    case "add-production":
      return "production";
    case "fix-deploy": {
      const target = nextStep.target;
      const onProduction =
        flow.production.kind !== "absent" &&
        flow.production.kind !== "creating" &&
        target?.kind === "stop" &&
        target.projectId === flow.production.stop.projectId;
      return onProduction ? "production" : "main";
    }
    case "first-task":
    case "none":
      return undefined;
  }
}

/**
 * A step's tone, the ladder the attention panel runs down: red broken, amber
 * waiting on a person, blue moving forward, nothing for a first task.
 */
const NEXT_STEP_TONE: Record<GroupNextStepKind, ServiceStatusToneId> = {
  "answer-mate": "attention",
  "fix-deploy": "failed",
  merge: "attention",
  unblock: "attention",
  release: "busy",
  "add-production": "busy",
  "first-task": "off",
  none: "off",
};

export function nextStepTone(kind: GroupNextStepKind): ServiceStatusToneId {
  return NEXT_STEP_TONE[kind];
}

type ContainerState = "ready" | "coming-up" | "not-answering" | "stopped" | "other";

/** A container's state, from the one verb its row offers (`deriveZeropsRowAction`). */
function containerStateOf(kind: ZeropsRowAction["kind"]): ContainerState {
  switch (kind) {
    case "open":
      return "ready";
    case "pending":
      return "coming-up";
    case "retry-probe":
      return "not-answering";
    case "start":
      return "stopped";
    case "enable":
    case "set-up-mate":
    case "remove":
    case "restart":
    case "none":
      return "other";
  }
}

const CONTAINER_STATE_WORD: ReadonlyArray<readonly [ContainerState, string]> = [
  ["ready", "ready"],
  ["coming-up", "coming up"],
  ["not-answering", "not answering"],
  ["stopped", "stopped"],
  ["other", "need a look"],
];

export const CONTAINERS_NOT_IN_A_PROJECT = "Not in a project";

/**
 * The containers no project holds, as one line: how many are in each state,
 * and how many a re-probe (*Try again*) would ask again — the ones not
 * answering, which a browser cannot tell from one that predates Mate (H9).
 */
export function containersSummary(kinds: ReadonlyArray<ZeropsRowAction["kind"]>): {
  readonly line: string;
  readonly retry: number;
} {
  const counts = new Map<ContainerState, number>();
  for (const kind of kinds) {
    const state = containerStateOf(kind);
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  const parts = CONTAINER_STATE_WORD.flatMap(([state, word]) => {
    const count = counts.get(state) ?? 0;
    return count === 0 ? [] : [`${String(count)} ${word}`];
  });
  return {
    line: [CONTAINERS_NOT_IN_A_PROJECT, ...parts].join(" · "),
    retry: counts.get("not-answering") ?? 0,
  };
}

/**
 * The ungrouped projects, split: the containers fold into one line, and a
 * project with no Mate container at all (*Set up Mate*) keeps a quiet line of
 * its own at the page's end.
 */
export function foldUngrouped<E extends { readonly action: ZeropsRowAction["kind"] }>(
  rows: ReadonlyArray<E>,
): { readonly containers: ReadonlyArray<E>; readonly withoutMate: ReadonlyArray<E> } {
  return {
    containers: rows.filter((row) => row.action !== "set-up-mate"),
    withoutMate: rows.filter((row) => row.action === "set-up-mate"),
  };
}

/** The pull requests' step with none open: "yet" until something has landed. */
export function pullRequestsLine(flow: GroupFlow): string {
  return flow.main.hasCode === true ? "None open" : "None yet";
}

/** The newest code change that landed — what `main`'s step names. */
export function lastMergedCode(
  merged: ReadonlyArray<FlowPullRequest>,
): FlowPullRequest | undefined {
  return merged
    .filter((pull) => pull.kind === "code")
    .reduce<FlowPullRequest | undefined>(
      (newest, pull) =>
        newest === undefined || (pull.mergedAt ?? "") > (newest.mergedAt ?? "") ? pull : newest,
      undefined,
    );
}

export interface MainCell {
  /** Nothing on it that anybody knows of: the step is drawn empty. */
  readonly empty: boolean;
  readonly head: string | undefined;
  /** The last change that landed, as `Title (#4)`. */
  readonly title: string | undefined;
  readonly state: string;
}

/** `main`'s step: where it is, the last change that landed, and how much of it is not live. */
export function mainCell(flow: GroupFlow, lastMerged: FlowPullRequest | undefined): MainCell {
  const { main } = flow;
  const title =
    lastMerged === undefined ? undefined : `${lastMerged.title} (#${String(lastMerged.number)})`;
  const empty =
    main.head === undefined && title === undefined && main.notLive === 0 && main.hasCode !== true;
  const state =
    main.notLive > 0
      ? main.notLive === 1
        ? "1 change not live"
        : `${String(main.notLive)} changes not live`
      : empty
        ? "Nothing merged"
        : "Nothing waiting to release";
  return { empty, head: main.head, title, state };
}

/** What a group is, in one muted line under its name. */
export function groupMetaLine(flow: GroupFlow): string {
  const mates = flow.mates.length;
  const open = flow.pullRequests.length;
  const parts = [
    ...(mates === 0 ? [] : [mates === 1 ? "1 Mate" : `${String(mates)} Mates`]),
    ...(open === 0
      ? []
      : [open === 1 ? "1 open pull request" : `${String(open)} open pull requests`]),
  ];
  return parts.length === 0 ? "No Mate yet" : parts.join(" · ");
}

const STOP_TONE: Record<GroupFlowStopState, ServiceStatusToneId> = {
  checking: "off",
  empty: "off",
  deploying: "busy",
  deployed: "ok",
  failed: "failed",
};

const STOP_ROW_TONE: Record<"deploying" | "deployed" | "failed", GroupRowTone> = {
  deploying: "pending",
  deployed: "good",
  failed: "bad",
};

/**
 * What a stop runs, as its state word, the version it names and the tone of
 * its dot: `Deployed` · `e014b0e`. The word is the fact; the version may give
 * way where the line is short.
 */
export function stopLine(stop: GroupFlowStop): {
  readonly word: string;
  readonly version: string | undefined;
  readonly tone: ServiceStatusToneId;
} {
  const tone = STOP_TONE[stop.state];
  switch (stop.state) {
    case "checking":
      return { word: CHECKING_WHAT_RUNS, version: undefined, tone };
    case "empty":
      return { word: NOTHING_DEPLOYED, version: undefined, tone };
    default:
      return {
        word: deployWord(STOP_ROW_TONE[stop.state]) ?? "",
        version: stop.version?.label,
        tone,
      };
  }
}

export interface ProductionCell {
  /** No production: the step is drawn as a place, not a thing. */
  readonly empty: boolean;
  readonly line: string;
  readonly detail: string | undefined;
  readonly tone: ServiceStatusToneId;
}

/**
 * Production's step. Its line is `groupFlow`'s; the detail names the
 * release that would go. That production is the person's to add, not the
 * Mate's, is the add verb's to say (its tooltip), not the cell's.
 */
export function productionCell(flow: GroupFlow): ProductionCell {
  const { production } = flow;
  switch (production.kind) {
    case "absent":
      return { empty: true, line: production.line, detail: undefined, tone: "off" };
    case "creating":
    case "deploying":
      return { empty: false, line: production.line, detail: undefined, tone: "busy" };
    case "ready-to-release":
      // How much it carries is `main`'s line 2 (`1 change not live`), beside it.
      return {
        empty: false,
        line: production.line,
        detail: `${production.candidate.tag} ready`,
        tone: "busy",
      };
    case "releasing":
      return {
        empty: false,
        line: production.line,
        detail: releaseInFlightReason(production.tag),
        tone: "busy",
      };
    case "deploy-failed":
      return { empty: false, line: production.line, detail: undefined, tone: "failed" };
    case "live":
      return { empty: false, line: production.line, detail: undefined, tone: "ok" };
    case "checking":
    case "empty":
      return { empty: false, line: production.line, detail: undefined, tone: "off" };
  }
}

/** One Zerops project of a group, as the page already holds it. */
export interface GroupMemberFacts {
  readonly projectId: string;
  readonly role: ZeropsEnvironmentRole | undefined;
  /** Its name under the group's (`environmentNameUnderGroup`). */
  readonly name: string;
  /** Present where a Mate lives (`hasMate`). */
  readonly mate:
    | {
        readonly name: string;
        /** Its face reads `needs`. */
        readonly waiting: boolean;
        /**
         * Somebody has spoken into its conversation — `undefined` while that
         * is not known: its container is not connected, or its conversations
         * have not arrived yet.
         */
        readonly talked: boolean | undefined;
      }
    | undefined;
  readonly routes: ReadonlyArray<ZeropsPublicRoute>;
  /** The developer's services by hostname — the pair `pairPreviewRoute` looks for. */
  readonly hostnames: ReadonlyArray<string>;
}

/** A group member as the group tree carries it: a candidate, with what its container serves. */
export type GroupMemberCandidate = ZeropsCandidate & {
  readonly routes?: ReadonlyArray<ZeropsPublicRoute>;
  readonly services?: ZeropsEnvironmentServices;
};

/**
 * A group's members as `groupFlowInputOf` reads them, from the group tree's
 * environments — the projects page and the left menu hand it the same
 * candidates, so they cannot disagree about who is in a group or what a
 * Mate is doing. `activityOf` is the agent's activity (`agentActivity.ts`),
 * read only while its container is connected; `conversationsRead` is whether
 * its container's conversations have arrived, so that no activity is known to
 * mean nobody has spoken to it.
 */
export function groupMemberFactsOf<T extends GroupMemberCandidate>(
  environments: ReadonlyArray<{
    readonly item: T;
    readonly role: ZeropsEnvironmentRole | undefined;
  }>,
  activityOf: (item: T) => ZeropsAgentActivity | undefined,
  conversationsRead: (item: T) => boolean,
): ReadonlyArray<GroupMemberFacts> {
  return environments.map(({ item, role }) => {
    const tags = readZeropsGroupTags(item.project.tagList);
    const connected = item.group === "connected" && item.environmentId !== undefined;
    const activity = activityOf(item);
    return {
      projectId: item.project.id,
      role,
      name: environmentNameUnderGroup(tags.label, item.project.name),
      mate: hasMate(item)
        ? {
            name: botDisplayName({ bot: tags.bot, projectName: item.project.name }),
            waiting: mateFaceFor(connected, activity) === "needs",
            talked: !connected
              ? undefined
              : activity !== undefined
                ? activity.subject !== undefined
                : conversationsRead(item)
                  ? false
                  : undefined,
          }
        : undefined,
      routes: item.routes ?? [],
      hostnames: item.services?.hostnames ?? [],
    };
  });
}

/**
 * Whether *Add production* is offered for a group: the viewer may create a
 * project (`canCreateProjectsInOrganization`), the group has no production
 * yet (`creatableRoles`), and the group is offered more at all
 * (`groupAddsOffered` — some Mate in it is up). Every surface that feeds
 * `groupFlow` asks this one question.
 */
export function productionAddable(input: {
  readonly group: ZeropsGroup;
  readonly mayCreate: boolean;
  readonly addsOffered: boolean;
}): boolean {
  return input.mayCreate && input.addsOffered && creatableRoles(input.group).includes("prod");
}

/** The part of a group's project flow `groupFlow` reads. */
export interface GroupFlowReads {
  readonly environments: ReadonlyArray<EnvironmentRow>;
  readonly pullRequests: ReadonlyArray<FlowPullRequest>;
  readonly merged: ReadonlyArray<FlowPullRequest>;
  readonly missing: ReadonlyArray<MissingEnvironmentRow>;
  readonly release: {
    readonly gate: ReleaseGate;
    readonly suggestion: string;
    /** The release on its way; the menu, which is told only whether Release is offered, has none. */
    readonly inFlight?: string | undefined;
    readonly contents: ReadonlyArray<{
      readonly commits: ReadonlyArray<{ sha: string; subject: string }>;
    }>;
  };
}

/** A release is not offered on a flow nobody has read: there is no gate to open. */
const FLOW_NOT_READ: ReleaseGate = {
  allowed: false,
  reason: "This project has not been read yet.",
};

const STOP_TIER: Partial<Record<ZeropsEnvironmentRole, GroupEnvironmentTier>> = {
  stage: "stage",
  prod: "production",
};

/**
 * `groupFlow`'s input, from what the page holds: the group tree's members,
 * the account-wide project flow (`undefined` while unread) and the platform's
 * pushed deployments.
 *
 * What `main` holds is not read here (`mainHasCode`, `mainHead` stay
 * `undefined`): the default-branch read runs only for a group with a
 * production, so a merged code change is the page's one proof of code.
 */
export function groupFlowInputOf(input: {
  readonly groupId: string;
  readonly members: ReadonlyArray<GroupMemberFacts>;
  readonly flow: GroupFlowReads | undefined;
  /** `undefined` where the platform's pushed answer is not held at all: every stop unread. */
  readonly deployments: ReadonlyMap<string, Shown<Deployment>> | undefined;
  readonly productionAddable: boolean;
}): GroupFlowInput {
  const { flow } = input;
  return {
    groupId: input.groupId,
    mates: input.members.flatMap((member) =>
      member.mate === undefined
        ? []
        : [
            {
              projectId: member.projectId,
              name: member.mate.name,
              preview: pairPreviewRoute(member.routes, member.hostnames)?.url,
              waiting: member.mate.waiting,
              // Unknown is not spoken to as far as the flow can say; where a
              // group is drawn waits for it (`groupPlacement`).
              talked: member.mate.talked ?? false,
            },
          ],
    ),
    pullRequests: flow?.pullRequests ?? [],
    merged: flow?.merged ?? [],
    stops: input.members.flatMap((member) => {
      const tier = member.role === undefined ? undefined : STOP_TIER[member.role];
      if (tier === undefined) return [];
      const row = flow?.environments.find((entry) => entry.projectId === member.projectId);
      return [
        {
          projectId: member.projectId,
          name: row?.name ?? member.name,
          tier,
          row,
          deployment: input.deployments?.get(member.projectId),
          route: member.routes[0]?.url,
        },
      ];
    }),
    missing: flow?.missing ?? [],
    release:
      flow === undefined
        ? { gate: FLOW_NOT_READ, suggestion: "", waiting: 0 }
        : {
            gate: flow.release.gate,
            suggestion: flow.release.suggestion,
            waiting: releaseContentsSummary(flow.release.contents).total,
            inFlight: flow.release.inFlight,
          },
    mainHasCode: undefined,
    mainHead: undefined,
    productionAddable: input.productionAddable,
    pending: [],
  };
}
