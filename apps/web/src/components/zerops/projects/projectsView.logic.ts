/**
 * The projects page's decisions over `groupFlow` — what a project's row says and whether it
 * rises, production's version beside its name, the containers' one line — the words and the
 * placement, not the pixels. The rows' order is the person's (`projectOrderPreference.ts`); the
 * rows that need the person rise first within it (`risenFirst`), and nothing else reorders them.
 */

import type { OfficialHq } from "@t3tools/client-runtime/zerops/hq";
import {
  deployWord,
  firstDeployLine,
  STAGE_SETTING_UP,
  firstDeployTone,
  flowVerbKey,
  flowVerbLabel,
  hasMate,
  projectNameInApp,
  pairPreviewRoute,
  releaseContentsSummary,
  releaseInFlightReason,
  REVIEW_LABEL,
  type EnvironmentRow,
  type FlowPullRequest,
  type Moved,
  type GroupEnvironmentTier,
  type HeldEnvironment,
  environmentAddable,
  heldTiers,
  type GroupFlow,
  type GroupFlowComing,
  type GroupFlowInput,
  type GroupFlowStop,
  type GroupFlowStopState,
  type GroupNextStepKind,
  type GroupRowTone,
  type PlatformService,
  type ReleaseGate,
  type ZeropsEnvironmentRole,
  type ZeropsEnvironmentServices,
  type ZeropsGroup,
  type ZeropsGroupPendingMember,
  type ZeropsPublicRoute,
} from "@t3tools/client-runtime/zerops";
import {
  CHECKING_WHAT_RUNS,
  NOTHING_DEPLOYED,
  type Deployment,
} from "@t3tools/client-runtime/zerops/flow";
import type { Shown } from "@t3tools/client-runtime/zerops/knowledge";
import type { ServiceStatusToneId } from "@t3tools/shared/brand";

import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { activityOfNow, mateFaceFor, type ZeropsAgentActivity } from "~/zerops/agentActivity";
import { COMING_UP_LINE, NOT_SET_UP_LINE, type ZeropsRowAction } from "../ZeropsProjectRow.logic";

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
 * The steps somebody has something to do for: their rows rise, the left menu
 * dots them. A project without production owes nobody anything —
 * production is not required (the owner, 2026-09-28) — so adding one is the
 * page's offer, never a step that waits.
 */
const AWAITING_STEPS: ReadonlySet<GroupNextStepKind> = new Set([
  "answer-mate",
  "fix-mate",
  "fix-deploy",
  "merge",
  "unblock",
  "release",
]);

/** Whether a next step waits on somebody — never a first task (the Mate is the way in) or none. */
export function nextStepAwaitsSomebody(kind: GroupNextStepKind): boolean {
  return AWAITING_STEPS.has(kind);
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
  "first-task": "off",
  none: "off",
};

export function nextStepTone(kind: GroupNextStepKind): ServiceStatusToneId {
  return NEXT_STEP_TONE[kind];
}

type ContainerState =
  | "ready"
  | "coming-up"
  | "not-answering"
  | "stopped"
  | "not-in-hq"
  | "no-mate"
  | "other";

/** A container's state, from the one verb its row offers (`deriveZeropsRowAction`). */
function containerStateOf(kind: ZeropsRowAction["kind"]): ContainerState {
  switch (kind) {
    case "open":
      return "ready";
    case "pending":
      return "coming-up";
    case "not-in-hq":
      return "not-in-hq";
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
  ["not-in-hq", "not in this HQ"],
  ["no-mate", "without a Mate"],
  ["other", "need a look"],
];

export const CONTAINERS_NOT_IN_A_PROJECT = "Not in a project";

/**
 * The containers no project holds, as one line: how many are in each state,
 * and how many a re-probe (*Try again*) would ask again — the ones not
 * answering, which a browser cannot tell from one that predates Mate (H9).
 */
export function containersSummary(
  kinds: ReadonlyArray<ZeropsRowAction["kind"]>,
  placementNotice?: string,
): {
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
    line: [placementNotice ?? CONTAINERS_NOT_IN_A_PROJECT, ...parts].join(" · "),
    retry: counts.get("not-answering") ?? 0,
  };
}

/**
 * The projects the page lists, without the organization's HQ — the project its anchor names
 * (`findOfficialHq`), which HQ's card stands for, and which is never a Mate to set up. A
 * project is never left out by its name or its tag, and none at all while the anchor names no one
 * HQ.
 */
export function withoutOfficialHq<T extends { readonly project: { readonly id: string } }>(
  rows: ReadonlyArray<T>,
  hq: OfficialHq,
): ReadonlyArray<T> {
  if (hq.kind !== "official") return rows;
  return rows.filter((row) => row.project.id !== hq.projectId);
}

/** Foreign environments without a Mate do not belong among the page's other containers. */
export function shownUngrouped<T extends ZeropsCandidate>(
  rows: ReadonlyArray<{ readonly item: T; readonly action: ZeropsRowAction["kind"] }>,
): ReadonlyArray<{ readonly item: T; readonly action: ZeropsRowAction["kind"] }> {
  return rows.filter(({ item, action }) => hasMate(item) || action === "set-up-mate");
}

/**
 * What a change's row offers: *Review*, the one door to merging it (R1) — and while its merge runs,
 * or waits for HQ's stream to bring it merged, that it is merging. Its close says so in its review.
 */
export function changeRowVerb(
  pending: ReadonlySet<string>,
  groupId: string,
  pull: Pick<FlowPullRequest, "repository" | "number">,
): string {
  const merge = flowVerbKey({
    kind: "merge",
    groupId,
    repository: pull.repository,
    number: pull.number,
  });
  return pending.has(merge) ? flowVerbLabel("merge", true) : REVIEW_LABEL;
}

/**
 * Why a project's changes are not known: HQ never answered for them and none is held
 * (`ZeropsProjectFlow.changesFailure`), or HQ's rule shows this person the project and not its
 * changes (`read_change`, `useChangeOffers`).
 */
export type ChangesUnknown = "failed" | "unseen";

/**
 * Which of a project's reads are out, so its row's line holds a skeleton rather than a claim.
 * Its changes are HQ's half: "nothing waits" from a flow whose deploy half alone answered is a
 * claim the page then takes back —
 * 11–28 s on a reload, and for as long as a project's changes are being read again (the owner,
 * 2026-09-30).
 */
export function flowStepsAwaiting(input: {
  /** Either half of its flow answered. */
  readonly read: boolean;
  /** Its changes half answered (`ZeropsProjectFlow.changesKnown`). */
  readonly changesKnown: boolean;
  /**
   * Its changes are not known and no read is out for them: its row says why rather than wait
   * forever.
   */
  readonly changesUnknown?: ChangesUnknown | undefined;
  /** Its read is out: an HQ is open, whose stream tells its changes. */
  readonly readOut: boolean;
}): { readonly steps: boolean; readonly changes: boolean } {
  const { read, changesKnown, changesUnknown, readOut } = input;
  const answered =
    changesUnknown === "unseen" || (read && (changesKnown || changesUnknown === "failed"));
  return { steps: readOut && !read, changes: readOut && !answered };
}

/**
 * Why a project's changes are not known, where they are not: HQ's refusal first — what this person
 * may not see is unseen however HQ answered — and nothing while HQ has not said.
 */
export function changesUnknownOf(input: {
  /** What HQ offers of the project's changes (`useChangeOffers`); `undefined` while unsaid. */
  readonly offers: { readonly readRefused: boolean } | undefined;
  /** Why HQ never told its changes (`ZeropsProjectFlow.changesFailure`). */
  readonly changesFailure: string | undefined;
}): ChangesUnknown | undefined {
  if (input.offers?.readRefused === true) return "unseen";
  return input.changesFailure === undefined ? undefined : "failed";
}

/** What a row says where its changes are not known. */
const CHANGES_UNKNOWN_LINE: { readonly [U in ChangesUnknown]: string } = {
  failed: "HQ didn’t answer",
  // The refusal's own access (`changes_not_seen`), short enough for a step.
  unseen: "Needs Basic user access",
};

/** The newest code change that landed — what a quiet row names. */
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
      return { word: stop.readLine ?? CHECKING_WHAT_RUNS, version: undefined, tone };
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
  readonly projectStatus?: string | undefined;
  readonly services?: ReadonlyArray<PlatformService> | undefined;
  readonly projectId: string;
  readonly role: ZeropsEnvironmentRole | undefined;
  /** Its name under its application (`projectNameInApp`). */
  readonly name: string;
  /** Present where a Mate lives (`hasMate`). */
  readonly mate:
    | {
        readonly name: string;
        /** Its face reads `needs`. */
        readonly waiting: boolean;
        /** Its last run stopped on an error: its face reads `needs`, and it asks nothing. */
        readonly failed?: boolean;
        /** It works now — a turn, or helpers it started: its changes ask for nothing yet. */
        readonly working?: boolean;
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
 * Mate is doing. `activityOf` is the agent's activity (`agentActivity.ts`):
 * HQ's word or its socket's, read only while it is of now — its container
 * connected, or HQ holding it live — and never at rest; `conversationsRead` is
 * whether its container's conversations have arrived, so that no activity is
 * known to mean nobody has spoken to it.
 */
export function groupMemberFactsOf<T extends GroupMemberCandidate>(
  environments: ReadonlyArray<{
    readonly item: T;
    readonly role: ZeropsEnvironmentRole | undefined;
  }>,
  activityOf: (item: T) => ZeropsAgentActivity | undefined,
  conversationsRead: (item: T) => boolean,
  /** Whether a project's Mate waits on the viewer, as HQ says it (`waitsOnViewer`). */
  waitsOnViewer: (projectId: string) => boolean,
): ReadonlyArray<GroupMemberFacts> {
  return environments.map(({ item, role }) => {
    const activity = activityOfNow(activityOf(item));
    const connected =
      (item.group === "connected" && item.environmentId !== undefined) || activity !== undefined;
    return {
      projectStatus: item.project.status,
      services: item.services?.statuses,
      projectId: item.project.id,
      role,
      name: projectNameInApp(item.project),
      mate: hasMate(item)
        ? {
            name: projectNameInApp(item.project),
            // Waiting on an answer: its conversation's question. A change of its waiting for
            // review wears the same face (`mateFaceOf`) and is the flow's own step — *Review* —
            // never "waiting on an answer". Another's Mate waits on its owner, not the viewer.
            waiting: waitsOnViewer(item.project.id) && mateFaceFor(connected, activity) === "needs",
            ...(connected && activity?.kind === "failed" ? { failed: true } : {}),
            ...(connected && activity?.face === "working" ? { working: true } : {}),
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
 * The tiers a project's menu offers *Add* for — the one answer (`environmentAddable`) for the
 * group as its tree holds it: its projects by role (a Mate that is also the stage counts as the
 * stage), its creations under way, and what HQ records of it, each counted once; whether the
 * recipe holds the tier; and whether HQ offers this person the tier. Nothing is offered before HQ
 * says.
 */
export function tiersAddable(input: {
  /** The tiers HQ offers this person to add (`add_stage` / `add_production`); `null` before it says. */
  readonly offered: { readonly stage: boolean; readonly production: boolean } | null;
  readonly group: Pick<ZeropsGroup, "environments" | "pending">;
  /** The application's environments as HQ records them. */
  readonly hq: ReadonlyArray<HeldEnvironment>;
  readonly recipe: { readonly read: boolean; readonly tiers: ReadonlyArray<GroupEnvironmentTier> };
}): ReadonlyArray<GroupEnvironmentTier> {
  const { offered, group } = input;
  if (offered === null) return [];
  const held = heldTiers([
    ...input.hq,
    ...group.environments.flatMap((entry): ReadonlyArray<HeldEnvironment> => {
      const tier =
        entry.role === "prod"
          ? "production"
          : entry.role === "stage" || entry.role === "devstage"
            ? "stage"
            : undefined;
      return tier === undefined ? [] : [{ id: entry.project.id, tier }];
    }),
    ...group.pending.flatMap((entry): ReadonlyArray<HeldEnvironment> =>
      entry.kind === "stage" || entry.kind === "production"
        ? [{ id: entry.projectId, tier: entry.kind }]
        : [],
    ),
  ]);
  return (["stage", "production"] as const).filter((tier) =>
    environmentAddable({
      tier,
      recipeRead: input.recipe.read,
      recipeTiers: input.recipe.tiers,
      offered: offered[tier],
      held,
    }),
  );
}

/** The part of a group's project flow `groupFlow` reads. */
export interface GroupFlowReads {
  readonly environments: ReadonlyArray<EnvironmentRow>;
  readonly pullRequests: ReadonlyArray<FlowPullRequest>;
  readonly merged: ReadonlyArray<FlowPullRequest>;
  readonly release: {
    readonly gate: ReleaseGate;
    readonly suggestion: string;
    /** The release on its way; the menu, which is told only whether Release is offered, has none. */
    readonly inFlight?: string | undefined;
    /** What it would put live, per comparison HQ answered (`Moved`). */
    readonly contents: ReadonlyArray<Moved>;
    readonly summary?: { readonly total: number; readonly atLeast: boolean } | undefined;
    /** Production's services whose commit cannot be told. */
    readonly untold: ReadonlyArray<string>;
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

/** What `groupFlow` is told of a release: how many changes it would put live, and how sure. */
function releaseInputOf(release: GroupFlowReads["release"]): GroupFlowInput["release"] {
  const { total, atLeast } = release.summary ?? releaseContentsSummary(release.contents);
  return {
    gate: release.gate,
    suggestion: release.suggestion,
    waiting: total,
    waitingAtLeast: atLeast,
    untold: release.untold,
    inFlight: release.inFlight,
  };
}

/**
 * `groupFlow`'s input, from what the page holds: the group tree's members and
 * its creations under way, the account-wide project flow (`undefined` while
 * unread) and the platform's pushed deployments.
 *
 * What `main` holds is not read here (`mainHasCode`, `mainHead` stay
 * `undefined`), nor anywhere else: a merged code change is the page's one
 * proof of code.
 */
export function groupFlowInputOf(input: {
  readonly groupId: string;
  readonly members: ReadonlyArray<GroupMemberFacts>;
  readonly flow: GroupFlowReads | undefined;
  /** `undefined` where the platform's pushed answer is not held at all: every stop unread. */
  readonly deployments: ReadonlyMap<string, Shown<Deployment>> | undefined;
  /** The group's creations under way (the group tree's `pending`). */
  readonly pending: ReadonlyArray<ZeropsGroupPendingMember>;
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
              ...(member.mate.working === true ? { working: true } : {}),
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
          projectStatus: member.projectStatus,
          services: member.services,
          name: row?.name ?? member.name,
          tier,
          row,
          deployment: input.deployments?.get(member.projectId),
          route: member.routes[0]?.url,
        },
      ];
    }),
    release:
      flow === undefined
        ? { gate: FLOW_NOT_READ, suggestion: "", waiting: 0, waitingAtLeast: false, untold: [] }
        : releaseInputOf(flow.release),
    mainHasCode: undefined,
    mainHead: undefined,
    pending: input.pending,
  };
}

/** A Mate's activity as a project's row reads it (`agentActivity.ts`). */
export interface RowMateActivity {
  readonly name: string;
  /** It is on a turn now: its face says so, and its line says what on. */
  readonly working: boolean;
  readonly outcome?: string;
  readonly state?: string;
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
  | {
      readonly kind: "mate";
      readonly mate: string;
      readonly text: string;
      readonly at?: string;
      readonly request?: string;
      readonly state?: string;
    }
  /** A change: open, or the last that landed. */
  | { readonly kind: "change"; readonly text: string; readonly at?: string }
  | { readonly kind: "first-task"; readonly text: string }
  /** Its reads are out: the line holds its place and claims nothing. */
  | { readonly kind: "pending" }
  /** Its changes are not known (`ChangesUnknown`): nothing about them is claimed, and it says why. */
  | { readonly kind: "unread"; readonly text: string }
  | { readonly kind: "none" };

/** The steps a Mate's own state decides: known without the project's reads. */
const MATE_STEPS: ReadonlySet<GroupNextStepKind> = new Set(["answer-mate", "fix-mate"]);

function newer(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined) return false;
  if (b === undefined) return true;
  return Date.parse(a) > Date.parse(b);
}

/** A stage with a deploy on its way, as the row says it: its run, or its first deploy's word. */
function stageUnderWay(stages: ReadonlyArray<GroupFlowStop>): string | undefined {
  for (const stage of stages) {
    if (stage.state === "deploying") return `Deploying ${stage.name}…`;
    const line = stopLine(stage);
    if (line.tone === "busy") return `${stage.name}: ${line.word}`;
  }
  return undefined;
}

export function projectRowLine(input: {
  readonly flow: GroupFlow;
  readonly lastMerged: FlowPullRequest | undefined;
  readonly activities: ReadonlyArray<RowMateActivity>;
  /** The project's reads answered (`flowStepsAwaiting`): its next step is known. */
  readonly settled: boolean;
  /** Why its changes are not known, where they are not (`changesUnknownOf`). */
  readonly changesUnknown?: ChangesUnknown | undefined;
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
  // A failed deploy is the deploy half's to say; everything else waits on the changes HQ keeps.
  if (input.changesUnknown !== undefined)
    return step.kind === "fix-deploy"
      ? needsYou()
      : { kind: "unread", text: CHANGES_UNKNOWN_LINE[input.changesUnknown] };
  if (nextStepAwaitsSomebody(step.kind)) return needsYou();

  const { production } = flow;
  if (production.kind === "creating") return { kind: "under-way", text: production.line };
  if (production.kind === "releasing")
    return { kind: "under-way", text: releaseInFlightReason(production.tag) };
  if (production.kind === "deploying") return { kind: "under-way", text: "Deploying production…" };
  const stage = stageUnderWay(flow.stages);
  if (stage !== undefined) return { kind: "under-way", text: stage };

  const working = activities.find((mate) => mate.working && mate.subject !== undefined);
  if (working?.subject !== undefined)
    return { kind: "mate", mate: working.name, text: working.subject };

  const open = flow.pullRequests[0]?.pull;
  if (open !== undefined) return { kind: "change", text: `#${String(open.number)} ${open.title}` };

  const merged = input.lastMerged;
  const lastTalk = activities
    .filter((mate) => mate.subject !== undefined || mate.outcome !== undefined)
    .reduce<RowMateActivity | undefined>(
      (latest, mate) => (latest === undefined || newer(mate.at, latest.at) ? mate : latest),
      undefined,
    );
  if (
    lastTalk !== undefined &&
    (lastTalk.subject !== undefined || lastTalk.outcome !== undefined) &&
    (merged === undefined || newer(lastTalk.at, merged.mergedAt))
  )
    return {
      kind: "mate",
      mate: lastTalk.name,
      text: (lastTalk.outcome ?? lastTalk.subject)!,
      ...(lastTalk.outcome === undefined
        ? {}
        : { request: lastTalk.subject, state: lastTalk.state }),
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

/** The rows that rise first, then the rest, each keeping the order it was given. */
export function risenFirst<E>(
  rows: ReadonlyArray<E>,
  rises: (row: E) => boolean,
): ReadonlyArray<E> {
  return [...rows.filter(rises), ...rows.filter((row) => !rises(row))];
}

/**
 * The row's Mates' activity, as each one's menu row reads it (`useMateRowActivity`): HQ's word or
 * its socket's. A word at rest (`activityOfNow`) — HQ's last of a Mate it holds no live link of,
 * a kept shell gone quiet — still names its last task, and never says it works while its face
 * sleeps.
 */
export function rowMateActivitiesOf<T>(
  mates: ReadonlyArray<{ readonly item: T; readonly name: string }>,
  activityOf: (item: T) => ZeropsAgentActivity | undefined,
): ReadonlyArray<RowMateActivity> {
  return mates.flatMap(({ item, name }) => {
    const activity = activityOf(item);
    if (activity === undefined) return [];
    const now = activityOfNow(activity) !== undefined;
    return [
      {
        name,
        working: now && activity.kind === "working",
        subject: activity.subject,
        ...(!now || activity.kind !== "working"
          ? activity.snippet === undefined
            ? {}
            : {
                outcome: activity.snippet,
                state: now ? (activity.status?.label ?? "Last reply") : "Last known reply",
              }
          : {}),
        at: activity.at,
      },
    ];
  });
}
