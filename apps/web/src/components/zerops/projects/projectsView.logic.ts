/**
 * The projects page's decisions over `groupFlow` — what a project's row says and whether it
 * rises, production's version beside its name, the containers' one line — the words and the
 * placement, not the pixels. The rows' order is the person's (`projectOrderPreference.ts`); the
 * rows that need the person rise first within it (`risenFirst`), and nothing else reorders them.
 */

import { mateIsViewers } from "@t3tools/client-runtime/zerops/mateAccess";
import {
  botDisplayName,
  deployWord,
  environmentNameUnderGroup,
  firstDeployLine,
  firstDeployTone,
  hasMate,
  pairPreviewRoute,
  readZeropsGroupTags,
  releaseContentsSummary,
  releaseInFlightReason,
  STAGE_SETTING_UP,
  type EnvironmentRow,
  type FlowPullRequest,
  type GroupEnvironmentTier,
  type GroupFlow,
  type GroupFlowComing,
  type GroupFlowInput,
  type GroupFlowStop,
  type GroupFlowStopState,
  type GroupNextStepKind,
  type GroupRowTone,
  type GroupRunner,
  type MissingEnvironmentRow,
  type PlatformService,
  type ReleaseGate,
  type ZeropsEnvironmentRole,
  type ZeropsEnvironmentServices,
  type ZeropsGroup,
  type ZeropsGroupPendingMember,
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
import { COMING_UP_LINE, NOT_SET_UP_LINE, type ZeropsRowAction } from "../ZeropsProjectRow.logic";

/** What a tool is called where there is no project to name yet — the add verb. */
export const TOOL_LABEL: Record<ZeropsToolKind, string> = { gitea: "Gitea" };

/** The page's URL: `/zerops?group=<groupId>` opens that project's row. */
export interface ProjectsSearch {
  /** The group whose row opens and scrolls into view. */
  readonly group?: string;
}

/** `/zerops?group=<groupId>`; anything else is the list as it stands. */
export function parseProjectsSearch(raw: Record<string, unknown>): ProjectsSearch {
  const group = typeof raw.group === "string" && raw.group.length > 0 ? raw.group : undefined;
  return group === undefined ? {} : { group };
}

/**
 * The steps somebody has something to do for: the strip gathers them, the
 * left menu dots them. A project without production owes nobody anything —
 * production is not required (the owner, 2026-09-28) — so adding one is the
 * page's offer, never a step that waits.
 */
const STRIP_STEPS: ReadonlySet<GroupNextStepKind> = new Set([
  "answer-mate",
  "fix-mate",
  "fix-deploy",
  "merge",
  "unblock",
  "release",
]);

/** Whether a next step waits on somebody — never a first task (the Mate is the way in) or none. */
export function nextStepAwaitsSomebody(kind: GroupNextStepKind): boolean {
  return STRIP_STEPS.has(kind);
}

/**
 * A step's tone, the ladder the attention panel runs down: red broken, amber
 * waiting on a person, blue moving forward, nothing for a first task.
 */
const NEXT_STEP_TONE: Record<GroupNextStepKind, ServiceStatusToneId> = {
  "answer-mate": "attention",
  // Stopped on an error: the failure red, as the approved menu draws it.
  "fix-mate": "failed",
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

type ContainerState = "ready" | "coming-up" | "not-answering" | "stopped" | "no-mate" | "other";

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
    case "set-up-mate":
      return "no-mate";
    case "enable":
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
  ["no-mate", "without a Mate"],
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
 * Which of a project's steps wait on a read that is out, and so hold a skeleton rather than an
 * empty word. The pull requests and `main` are Gitea's changes half: "None yet" and "Nothing
 * merged" from a flow whose deploy half alone answered are claims the page then takes back —
 * 11–28 s on a reload, and for as long as a project's changes are being read again (the owner,
 * 2026-09-30).
 */
export function flowStepsAwaiting(input: {
  /** Either half of its flow answered. */
  readonly read: boolean;
  /** Its changes half answered (`ZeropsProjectFlow.changesKnown`). */
  readonly changesKnown: boolean;
  /**
   * Its changes' read failed and nothing is held (`ZeropsProjectFlow.changesFailure`): no read
   * is out for them, and the steps say so rather than wait forever.
   */
  readonly changesFailed?: boolean;
  /** Its read is out: a Gitea session is held or coming, and it has an org to read. */
  readonly readOut: boolean;
}): { readonly steps: boolean; readonly changes: boolean } {
  const { read, changesKnown, readOut } = input;
  const answered = read && (changesKnown || input.changesFailed === true);
  return { steps: readOut && !read, changes: readOut && !answered };
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

/**
 * A Mate being created, in the words its card says while it comes up. One whose creation stopped
 * before the platform took it says that instead; its own view says why.
 */
export function comingMateLine(coming: GroupFlowComing): string {
  return coming.failed === true ? NOT_SET_UP_LINE : COMING_UP_LINE;
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
  // Its own import still runs: set up first, as the menu says, before any first deploy.
  if (stop.firstDeploy?.kind === "setting-up")
    return { word: STAGE_SETTING_UP, version: undefined, tone: "busy" };
  switch (stop.state) {
    case "checking":
      return { word: CHECKING_WHAT_RUNS, version: undefined, tone };
    case "empty": {
      // A stage that runs nothing says where its first deploy stands, where one was asked for.
      const first = firstDeployLine(stop.firstDeploy);
      return first === undefined
        ? { word: NOTHING_DEPLOYED, version: undefined, tone }
        : {
            word: first,
            version: undefined,
            tone: firstDeployTone(stop.firstDeploy),
          };
    }
    default:
      return {
        word: deployWord(STOP_ROW_TONE[stop.state]) ?? "",
        version: stop.version?.label,
        tone,
      };
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
        /** Its last run stopped on an error: its face reads `needs`, and it asks nothing. */
        readonly failed?: boolean;
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
  /** When its project was made. */
  readonly createdAt?: string | undefined;
  /** Its project's status, as the platform lists it. */
  readonly projectStatus?: string | undefined;
  /** Its services as the platform lists them; `undefined` while unread. */
  readonly services?: ReadonlyArray<PlatformService> | undefined;
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
  /** Who is looking: only their own Mate's question waits on them (`mateIsViewers`). */
  viewer: string | undefined,
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
            // Waiting on an answer: its conversation's question. A change of its waiting for
            // review wears the same face (`mateFaceOf`) and is the flow's own step — *Review* —
            // never "waiting on an answer". Another's Mate waits on its owner, not the viewer.
            waiting:
              mateIsViewers(item.project, viewer) && mateFaceFor(connected, activity) === "needs",
            ...(connected && activity?.kind === "failed" ? { failed: true } : {}),
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
      createdAt: item.project.created,
      projectStatus: item.project.status,
      services: item.services?.statuses,
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
 * `groupFlow`'s input, from what the page holds: the group tree's members and
 * its creations under way, the account-wide project flow (`undefined` while
 * unread) and the platform's pushed deployments.
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
  /** The group's creations under way (the group tree's `pending`). */
  readonly pending: ReadonlyArray<ZeropsGroupPendingMember>;
  /** The group's runner, as the account holds the Gitea project's services; `undefined` unread. */
  readonly runner?: GroupRunner | undefined;
  /** The clock a stage's first deploy on its way is bounded by. */
  readonly nowMs?: number | undefined;
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
              ...(member.mate.failed === true ? { failed: true } : {}),
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
          createdAt: member.createdAt,
          projectStatus: member.projectStatus,
          services: member.services,
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
    pending: input.pending,
    runner: input.runner,
    nowMs: input.nowMs,
  };
}

/** A Mate's activity as a project's row reads it (`agentActivity.ts`). */
export interface RowMateActivity {
  readonly name: string;
  /** It is on a turn now: its face says so, and its line says what on. */
  readonly working: boolean;
  /** What it is on, or was last on; absent before anybody spoke to it. */
  readonly subject: string | undefined;
  /** When it last did something. */
  readonly at: string | undefined;
}

/**
 * A project row's second line: the one thing that needs the person, as a full sentence (its verb
 * at the row's end), else the latest meaningful fact — never a word for nothing.
 */
export type ProjectRowLine =
  | {
      readonly kind: "needs-you";
      readonly text: string;
      /** The change it names, by its title. */
      readonly detail?: string;
      readonly tone: ServiceStatusToneId;
    }
  /** A deploy or a release on its way. */
  | { readonly kind: "under-way"; readonly text: string }
  /** What a Mate is on (working), or was last on. */
  | { readonly kind: "mate"; readonly mate: string; readonly text: string; readonly at?: string }
  /** A change: open, or the last that landed. */
  | {
      readonly kind: "change";
      readonly text: string;
      readonly detail?: string;
      readonly at?: string;
    }
  | { readonly kind: "first-task"; readonly text: string }
  /** Its reads are out: the line holds its place and claims nothing. */
  | { readonly kind: "pending" }
  | { readonly kind: "none" };

/** The steps a Mate's own state decides: known without the project's reads. */
const MATE_STEPS: ReadonlySet<GroupNextStepKind> = new Set(["answer-mate", "fix-mate"]);

function newer(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined) return false;
  if (b === undefined) return true;
  return Date.parse(a) > Date.parse(b);
}

export function projectRowLine(input: {
  readonly flow: GroupFlow;
  readonly lastMerged: FlowPullRequest | undefined;
  readonly activities: ReadonlyArray<RowMateActivity>;
  /** The project's reads answered (`flowStepsAwaiting`): its next step is known. */
  readonly settled: boolean;
}): ProjectRowLine {
  const { flow, activities } = input;
  const step = flow.nextStep;
  const needsYou = (): ProjectRowLine => {
    const target = step.target;
    const pull =
      target?.kind === "change"
        ? flow.pullRequests.find(
            (entry) =>
              entry.pull.repository === target.repository && entry.pull.number === target.number,
          )?.pull
        : undefined;
    return {
      kind: "needs-you",
      text: step.text,
      ...(pull === undefined ? {} : { detail: pull.title }),
      tone: nextStepTone(step.kind),
    };
  };
  if (MATE_STEPS.has(step.kind)) return needsYou();
  if (!input.settled) return { kind: "pending" };
  if (nextStepAwaitsSomebody(step.kind)) return needsYou();

  const { production } = flow;
  if (production.kind === "creating") return { kind: "under-way", text: production.line };
  if (production.kind === "releasing")
    return { kind: "under-way", text: releaseInFlightReason(production.tag) };
  if (production.kind === "deploying") return { kind: "under-way", text: "Deploying production…" };
  const deployingStage = flow.stages.find((stage) => stage.state === "deploying");
  if (deployingStage !== undefined)
    return { kind: "under-way", text: `Deploying ${deployingStage.name}…` };

  const working = activities.find((mate) => mate.working && mate.subject !== undefined);
  if (working?.subject !== undefined)
    return { kind: "mate", mate: working.name, text: working.subject };

  const open = flow.pullRequests[0]?.pull;
  if (open !== undefined)
    return {
      kind: "change",
      text: `#${String(open.number)} ${open.title}`,
      ...(open.checkWord === undefined ? {} : { detail: open.checkWord }),
    };

  const merged = input.lastMerged;
  const lastTalk = activities
    .filter((mate) => mate.subject !== undefined)
    .reduce<RowMateActivity | undefined>(
      (latest, mate) => (latest === undefined || newer(mate.at, latest.at) ? mate : latest),
      undefined,
    );
  if (
    lastTalk?.subject !== undefined &&
    (merged === undefined || newer(lastTalk.at, merged.mergedAt))
  )
    return {
      kind: "mate",
      mate: lastTalk.name,
      text: lastTalk.subject,
      ...(lastTalk.at === undefined ? {} : { at: lastTalk.at }),
    };
  if (merged !== undefined)
    return {
      kind: "change",
      text: `Merged #${String(merged.number)} ${merged.title}`,
      ...(merged.mergedAt === undefined ? {} : { at: merged.mergedAt }),
    };
  if (step.kind === "first-task") return { kind: "first-task", text: step.text };
  return { kind: "none" };
}

/**
 * Production's version beside the project's name, where production exists and runs one: what it
 * runs and the tone of its last deploy. Nothing at all without production — adding one is the
 * row's menu's offer, never a word in the row.
 */
export function productionMark(
  flow: GroupFlow,
): { readonly version: string; readonly tone: ServiceStatusToneId } | undefined {
  const { production } = flow;
  if (production.kind === "absent" || production.kind === "creating") return undefined;
  const version = production.stop.version?.label;
  if (version === undefined) return undefined;
  return { version, tone: STOP_TONE[production.stop.state] };
}

/** Whether a row rises: it needs the person, or — its answer still out — it was drawn risen. */
export function rowRises(line: ProjectRowLine, remembered: boolean | undefined): boolean {
  if (line.kind === "pending") return remembered === true;
  return line.kind === "needs-you";
}

/** The rows that rise first, then the rest, each keeping the order it was given. */
export function risenFirst<E>(
  rows: ReadonlyArray<E>,
  rises: (row: E) => boolean,
): ReadonlyArray<E> {
  return [...rows.filter(rises), ...rows.filter((row) => !rises(row))];
}
