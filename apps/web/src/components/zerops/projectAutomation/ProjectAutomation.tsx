/**
 * A project's Automation section, on its page's column: the pool of its automated Mates as one
 * line (their faces, how many and what they are doing, *Add a Mate*, and the organization's spend
 * this month against its budget); its task board — what they are on (at work), what waits by its
 * place (each with Stop for an Owner or Admin), and what ended — read from HQ, and read again by
 * the data layer as HQ's navigation says their tasks moved (`hqTaskBoardRefresh`); then the
 * sources its tasks come from — GitHub issues by label, a Slack or Discord channel, webhooks,
 * schedules — one row each, which opens its form, and *Add* to take tasks from one more.
 * Configured where the project is: Settings keeps only what is the organization's (its key, its
 * GitHub apps, its Slack and Discord, its limits and budget).
 *
 * An Owner or Admin sets it up here; anyone else reads the pool, the board and the GitHub source,
 * and sees the section only once it holds something.
 */
import { Failure } from "~/components/ui/failure";
import { couldntRead } from "@t3tools/client-runtime/zerops/hq";
import {
  MOTION,
  type MateMarkState,
  type MateShapeId,
  type MateTintId,
} from "@t3tools/shared/brand";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import { appName } from "@t3tools/shared/hqGithub";
import type { HqNavigationMateTask } from "@t3tools/shared/hqStream";
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import {
  assignCandidateMateTints,
  mateShapeOf,
  projectNameInApp,
} from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { useNavigate } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  CalendarClockIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MoreHorizontalIcon,
  HashIcon,
  MessagesSquareIcon,
  WebhookIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { prefersReducedMotion } from "~/lib/reducedMotion";
import { useAppIntake, useAutomatedKey } from "~/zerops/useAutomationSettings";
import {
  useAppTaskSource,
  useAppTaskStops,
  useBoardTaskWrites,
  useGithubApp,
  useOrgTaskSource,
} from "~/zerops/useTaskSourceSettings";
import {
  useBoardOffers,
  useBoardRevision,
  useMateFaces,
  useOpenTaskConversation,
  useTakeTask,
  type BoardFace,
} from "~/zerops/useBoardTasks";
import { useHqPersonNames } from "~/zerops/useZeropsMateOwners";
import type { BoardTaskOffer } from "@t3tools/client-runtime/data";
import { useNewMateDialog } from "~/zerops/newMate";
import { useAddMateOffer } from "~/zerops/useHqOffers";
import { useOpenMate } from "~/zerops/useOpenMate";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { mateActivityAtom } from "~/zerops/mateActivityAtoms";
import { hqMateVersionsAtom, hqPlacementsAtom } from "~/state/zerops";
import { useNowMs } from "~/zerops/useNowMs";
import { useAtomValue } from "@effect/atom-react";

import { GitHubIcon } from "../../Icons";
import { Button, InlineButton } from "../../ui/button";
import { WaitLine } from "../WaitLine";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import { Row } from "../../ui/row";
import { Skeleton } from "../../ui/skeleton";
import { intakeRepoChoices } from "../../settings/automatedMatesSettings.logic";
import { appReaching } from "../../settings/automationSettings.logic";
import { MateFace, PersonAvatar } from "../primitives";
import { SetupRow } from "../project/SetupCard";
import { automationSummary } from "../project/projectSetup.logic";
import { BeadMark, CutText, GrowsInPlace, SectionAction } from "../system";
import { goClass } from "../system/ChangeRow";
import { cn } from "~/lib/utils";
import { mateAutomation, type MateAutomationLine } from "../SidebarMateRow.logic";
import {
  automationSection,
  connectionMissing,
  poolMateLine,
  SOURCE_KINDS,
  sourceRows,
  type RowPress,
  type SourceKind,
  type SourceRow,
} from "./projectAutomation.logic";
import { AppChannelView, AppIntakeView, AppSchedulesView, AppWebhooksView } from "./sourceForms";
import {
  boardOf,
  heldOnItsChange,
  LANES,
  poolSummary,
  predictedBoard,
  RECENT_SHOWN,
  spendLine,
  taskRowPress,
  type Board,
  type BoardRow,
  type PredictedBoard,
} from "./taskBoard.logic";
import { RealName } from "~/components/ui/real-name";
import { Text } from "~/components/ui/text";
import { List } from "~/components/ui/list";
import { Separator } from "~/components/ui/separator";
import { SectionHeader } from "~/components/ui/section";

/** Where the organization's connections are set: Settings › Automation. */
const AUTOMATION_SETTINGS = "/settings/automation" as const;

/** One automated Mate of the pool, as its row draws it. */
export interface PoolMate {
  readonly projectId: string;
  readonly name: string;
  readonly tint: MateTintId;
  readonly shape: MateShapeId | undefined;
  /** What it is on, as HQ says it (`mateAutomation`): its row's line and face read it. */
  readonly automation: MateAutomationLine;
}

/** A pool Mate's face: at work, asking while its task waits on a person's answer, else at rest. */
function poolMateFace(mate: Pick<PoolMate, "automation">, working: boolean): MateMarkState {
  if (working) return "working";
  return mate.automation.task?.waiting === true ? "needs" : "idle";
}

export function ProjectAutomation({
  groupId,
  name,
  repos,
}: {
  readonly groupId: string;
  /** The project's name; undefined while the listing has not named it. */
  readonly name: string | undefined;
  /** Its repositories, where GitHub issues come from once one mirrors there; undefined unread. */
  readonly repos: ReadonlyArray<RepoListEntry> | undefined;
}) {
  const { activeOrganization } = useZeropsSession();
  const admin = roleAtLeast(activeOrganization?.roleCode, "ADMIN");
  const { pool, live, tasks } = usePool(groupId);
  const intake = useAppIntake(groupId);
  const addMate = useAddAutomatedMate(groupId);
  const openMate = useOpenMate();
  const onOpenMate = (projectId: string) => {
    openMate({ projectId });
  };
  const board = useTaskBoard(
    groupId,
    live,
    predictedBoard(tasks, intake.read.intake?.waiting ?? 0, useTakenCount(groupId)),
    pool,
  );
  const written = (useBoardRevision(groupId) ?? 0) > 0;
  if (!admin) {
    const { rows, withheld } = sourceRows({
      intake: intake.read.intake,
      slack: WITHHELD,
      discord: WITHHELD,
      webhooks: WITHHELD,
      schedules: WITHHELD,
      slackConnected: undefined,
      discordConnected: undefined,
    });
    if (
      automationSection({ admin, pool: pool.length, sources: rows.length, board: written }) ===
      "hidden"
    )
      return null;
    return (
      <ProjectAutomationView
        board={board}
        onOpenMate={onOpenMate}
        pool={pool}
        sources={{ rows, reading: intake.read.intake === undefined, withheld }}
      />
    );
  }
  return (
    <AdminAutomation
      addMate={addMate}
      board={board}
      groupId={groupId}
      intake={intake}
      name={name ?? "This project"}
      onOpenMate={onOpenMate}
      pool={pool}
      repos={repos}
    />
  );
}

/**
 * The Automation row of a project page's side column: one line until the project has automated
 * Mates — *No automated Mates* and *Add* for an Owner or Admin — then their faces, how many are at
 * work, and *Manage*, which opens the whole section (`ProjectAutomation`). Not drawn for anyone
 * else while there is nothing to read.
 */
export function ProjectAutomationRow({
  groupId,
  onManage,
}: {
  readonly groupId: string;
  readonly onManage: (from: HTMLElement) => void;
}) {
  const { activeOrganization } = useZeropsSession();
  const admin = roleAtLeast(activeOrganization?.roleCode, "ADMIN");
  const { pool } = usePool(groupId);
  const addMate = useAddAutomatedMate(groupId);
  const openMate = useOpenMate();
  if (automationSection({ admin, pool: pool.length, sources: 0 }) !== "shown") return null;
  const onOpen = (projectId: string) => {
    openMate({ projectId });
  };
  return (
    <ProjectAutomationRowView
      face={(mate) => <PoolFace key={mate.projectId} mate={mate} onOpen={onOpen} />}
      onAdd={admin ? (addMate ?? onManage) : undefined}
      onManage={onManage}
      pool={pool}
    />
  );
}

/**
 * Whether a project's Automation stands on its page as a section of its own: it does once the
 * project has an automated Mate. Until then its side row offers the first one, and opens the
 * section in a dialog.
 */
export function useAutomationStanding(groupId: string): boolean {
  const written = (useBoardRevision(groupId) ?? 0) > 0;
  return usePool(groupId).pool.length > 0 || written;
}

/**
 * How many tasks people took for their own Mates in the application, as navigation carries them on
 * each Mate's row: how many rows In progress will hold while the Board reads.
 */
function useTakenCount(groupId: string): number {
  const placements = useAtomValue(hqPlacementsAtom);
  let count = 0;
  if (placements !== null)
    for (const placement of placements.values())
      if (placement.appId === groupId) count += placement.mate?.taken?.length ?? 0;
  return count;
}

/**
 * How many automated Mates the project has, for what is offered to run on them; `null` while the
 * listing, read only in part, may still hold one.
 */
export function useAutomatedMateCount(groupId: string): number | null {
  const { pool, complete } = usePool(groupId);
  return pool.length > 0 || complete ? pool.length : null;
}

/** What an automated Mate is for, where the project has none. */
const AUTOMATION_IS_FOR =
  "A Mate that takes tasks from GitHub issues, Slack, Discord or a schedule.";

export function ProjectAutomationRowView({
  pool,
  onAdd,
  onManage,
  face,
}: {
  readonly pool: ReadonlyArray<PoolMate>;
  /** *Add*, for an Owner or Admin while the project has no automated Mate. */
  readonly onAdd: ((from: HTMLElement) => void) | undefined;
  readonly onManage: (from: HTMLElement) => void;
  /** A pool Mate's face, which opens it (`PoolFace`). */
  readonly face: (mate: PoolMate) => ReactNode;
}) {
  if (pool.length === 0)
    return (
      <SetupRow empty label="Automation" surface="project-automation-row">
        <p>{AUTOMATION_IS_FOR}</p>
        {onAdd === undefined ? null : (
          <Button
            onClick={(event) => {
              onAdd(event.currentTarget);
            }}
            size="sm"
            variant="secondary"
          >
            Add one
          </Button>
        )}
      </SetupRow>
    );
  return (
    <SetupRow
      action={<SectionAction onClick={onManage}>Manage</SectionAction>}
      label="Automation"
      surface="project-automation-row"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex shrink-0 items-center">{pool.slice(0, 5).map(face)}</span>
        <Text className="min-w-0" truncate variant="remark">
          {automationSummary(pool)}
        </Text>
      </div>
    </SetupRow>
  );
}

const WITHHELD = { state: "withheld" } as const;

/**
 * The pool: the project's automated Mates, as HQ places them, each with what it is on; and what
 * HQ's navigation says of the task each is on — by the task's id, for the board's live rows, and
 * as a list, for how many rows the board will hold while it reads; and whether the listing is
 * read whole, so a pool of none is known to be none.
 */
function usePool(groupId: string): {
  readonly pool: ReadonlyArray<PoolMate>;
  readonly live: ReadonlyMap<string, HqNavigationMateTask>;
  readonly tasks: ReadonlyArray<HqNavigationMateTask | null>;
  readonly complete: boolean;
} {
  const { listing } = useZeropsCandidates();
  const key = useAutomatedKey();
  const held = useMemo(() => heldCandidates(listing), [listing]);
  const candidates = held.rows;
  const tints = useMemo(() => assignCandidateMateTints(candidates), [candidates]);
  const automated = useMemo(
    () =>
      candidates
        .filter(
          (candidate) =>
            candidate.project.hq?.appId === groupId &&
            candidate.project.hq.mate?.automated === true,
        )
        .sort((a, b) => projectNameInApp(a.project).localeCompare(projectNameInApp(b.project))),
    [candidates, groupId],
  );
  const pool = automated.map((candidate) => {
    const tint = tints.get(candidate.project.id) ?? "slate";
    return {
      projectId: candidate.project.id,
      name: projectNameInApp(candidate.project),
      tint,
      shape: mateShapeOf(candidate.project, tint),
      automation: mateAutomation(candidate.project.hq?.mate, key) ?? { task: null },
    };
  });
  const tasks = automated.map((candidate) => candidate.project.hq?.mate?.task ?? null);
  // One map while the listing holds the same: the board's rows are made again only as it moves.
  const live = useMemo(
    () =>
      new Map(
        automated.flatMap((candidate) => {
          const task = candidate.project.hq?.mate?.task;
          return task == null ? [] : [[task.id, task] as const];
        }),
      ),
    [automated],
  );
  return { pool, live, tasks, complete: held.complete };
}

/** How many rows each lane will hold while the Board reads (`predictedBoard`); none, no lane. */
interface Predicted extends PredictedBoard {
  /** The line that opens the ones that ended earlier. */
  readonly doneMore?: boolean | undefined;
}

/**
 * How Done last landed, per application, while this page lives: navigation names only each Mate's
 * latest task, so the next read's placeholders take Done's size from the last answer.
 */
const landed = new Map<string, { readonly done: number; readonly doneMore: boolean }>();

/**
 * The application's Board: HQ's tasks of it, read while the section is drawn (and again by the
 * data layer as its Board revision or its pool's tasks move), live rows moving with navigation; the
 * organization's spend this month; who and which Mate each task names; and what the reader may do
 * with each task (`boardOffers`) — Take into one of their own Mates, Release, Done, Stop (asked in
 * its row first) — each task's writes its own record (`appTaskWrites`), the one its conversation
 * reads too.
 */
function useTaskBoard(
  groupId: string,
  live: ReadonlyMap<string, HqNavigationMateTask>,
  predicted: Predicted,
  pool: ReadonlyArray<PoolMate>,
): BoardView {
  const tasks = useAppTaskSource("hqAppTasks", groupId);
  const limits = useOrgTaskSource("hqTaskLimits");
  // HQ holds a Mate on its open change only where it runs a version before its change per task.
  const versions = useAtomValue(hqMateVersionsAtom);
  const nowMs = useNowMs();
  const navigate = useNavigate();
  const viewerId = useZeropsSession().user?.id;
  const { activeOrganization } = useZeropsSession();
  const personName = useHqPersonNames(activeOrganization?.id);
  const faces = useMateFaces();
  const offers = useBoardOffers(groupId);
  const writes = useBoardTaskWrites(groupId);
  const take = useTakeTask(groupId);
  const openConversation = useOpenTaskConversation();
  const [asking, setAsking] = useState<string | null>(null);
  const setting = tasks.read.setting;
  const held = setting.state === "known" ? setting.held : null;
  const board = useMemo(() => {
    if (held === null) return null;
    const made = boardOf(held, nowMs, {
      appId: groupId,
      live,
      held: (projectId) => heldOnItsChange(versions[projectId]),
      viewerId,
      personName,
      mateName: (projectId) => faces.get(projectId)?.name,
    });
    landed.set(groupId, {
      done: Math.min(made.lanes.done.length, RECENT_SHOWN),
      doneMore: made.lanes.done.length > RECENT_SHOWN,
    });
    return made;
  }, [held, nowMs, groupId, live, versions, viewerId, personName, faces]);
  const shownIds = useMemo(() => (held === null ? [] : held.map((task) => task.id)), [held]);
  const stops = useAppTaskStops(groupId, shownIds);
  const poolFaces = useMemo(
    () => new Map(pool.map((mate) => [mate.projectId, mate] as const)),
    [pool],
  );
  return {
    read:
      board !== null
        ? { state: "known", board }
        : setting.state === "failed"
          ? { state: "failed", words: couldntRead("its tasks", setting.words) }
          : setting.state === "withheld"
            ? { state: "none" }
            : { state: "reading", predicted: { ...predicted, ...landed.get(groupId) } },
    spend: limits.read.setting.state === "known" ? spendLine(limits.read.setting.held) : null,
    onReadAgain: tasks.again,
    onOpen: (route) => {
      void navigate({ href: route });
    },
    onOpenConversation: openConversation,
    faceOf: (projectId) => poolFaces.get(projectId) ?? faces.get(projectId),
    verbs:
      offers === undefined
        ? undefined
        : {
            offerOf: (taskId) => offers.tasks?.[taskId],
            takeInto: offers.ownMates.map((projectId) => ({
              projectId,
              name: faces.get(projectId)?.name ?? "Your Mate",
            })),
            pressOf: (taskId) => taskRowPress({ taskId, asking, action: stops.stops[taskId] }),
            onAsk: (taskId) => {
              setAsking(taskId);
            },
            onKeep: () => {
              setAsking(null);
            },
            onStop: (taskId) => {
              setAsking(null);
              stops.stop(taskId);
            },
            onTake: (taskId, mateProjectId) => {
              void take(taskId, mateProjectId);
            },
            onRelease: (taskId) => {
              void writes?.release(taskId);
            },
            onDone: (taskId) => {
              void writes?.done(taskId);
            },
          },
  };
}

/** *Add an automated Mate*: the New Mate dialog over the page, Automated chosen. */
function useAddAutomatedMate(groupId: string): (() => void) | undefined {
  const ask = useNewMateDialog((state) => state.ask);
  const offer = useAddMateOffer()(groupId);
  return offer.kind === "allowed"
    ? () => {
        ask(groupId, { automated: true });
      }
    : undefined;
}

function AdminAutomation({
  groupId,
  name,
  repos,
  pool,
  intake,
  addMate,
  board,
  onOpenMate,
}: {
  readonly board: BoardView;
  readonly groupId: string;
  readonly name: string;
  readonly repos: ReadonlyArray<RepoListEntry> | undefined;
  readonly pool: ReadonlyArray<PoolMate>;
  readonly intake: ReturnType<typeof useAppIntake>;
  readonly addMate: (() => void) | undefined;
  readonly onOpenMate: (projectId: string) => void;
}) {
  const slack = useAppTaskSource("hqAppSlack", groupId);
  const discord = useAppTaskSource("hqAppDiscord", groupId);
  const webhooks = useAppTaskSource("hqAppWebhooks", groupId);
  const schedules = useAppTaskSource("hqAppSchedules", groupId);
  const github = useGithubApp();
  // The app GitHub tells Mate through about the intake's repository.
  const reaching = appReaching(
    github.read.setting.state === "known" ? github.read.setting.held : null,
    intake.read.answer?.repo,
  );
  const githubApp = reaching === undefined ? undefined : appName(reaching);
  const orgSlack = useOrgTaskSource("hqSlack");
  const orgDiscord = useOrgTaskSource("hqDiscord");
  const navigate = useNavigate();
  const [open, setOpen] = useState<SourceKind | null>(null);
  // Read while the Slack channel's dialog is open: what its channel is picked from.
  const slackChannels = useOrgTaskSource(
    "hqSlackChannels",
    open === "slack" &&
      orgSlack.read.setting.state === "known" &&
      orgSlack.read.setting.held.connected,
  );
  const connected = {
    slack:
      orgSlack.read.setting.state === "known" ? orgSlack.read.setting.held.connected : undefined,
    discord:
      orgDiscord.read.setting.state === "known"
        ? orgDiscord.read.setting.held.connected
        : undefined,
  };
  const sources = sourceRows({
    intake: intake.read.intake,
    slack: slack.read.setting,
    discord: discord.read.setting,
    webhooks: webhooks.read.setting,
    schedules: schedules.read.setting,
    slackConnected: connected.slack,
    discordConnected: connected.discord,
  });
  const openSettings = () => {
    setOpen(null);
    void navigate({ to: AUTOMATION_SETTINGS });
  };
  const choices = intakeRepoChoices(repos);
  return (
    <>
      <ProjectAutomationView
        admin={{
          onAddMate: addMate,
          onTakeFrom: setOpen,
          onEdit: (row) => {
            setOpen(row.kind === "failed" ? row.source : row.kind);
          },
          onReadAgain: (source) => {
            if (source === "slack") slack.again();
            else if (source === "discord") discord.again();
            else if (source === "webhook") webhooks.again();
            else if (source === "schedule") schedules.again();
          },
          onOpenSettings: openSettings,
        }}
        board={board}
        onOpenMate={onOpenMate}
        pool={pool}
        sources={sources}
      />
      {open === null ? null : (
        <SourceDialog
          kind={open}
          onClose={() => {
            setOpen(null);
          }}
        >
          {(() => {
            const missing = connectionMissing(open, connected);
            if (missing !== null)
              return (
                <div className="grid gap-3">
                  <p className="text-body text-foreground">{missing}</p>
                  <div>
                    <Button onClick={openSettings} size="sm" variant="secondary">
                      Open Settings › Automation
                    </Button>
                  </div>
                </div>
              );
            switch (open) {
              case "github":
                return (
                  <ul className="grid">
                    <AppIntakeView
                      appId={groupId}
                      choices={choices}
                      githubApp={githubApp}
                      name={name}
                      onSet={intake.set}
                      onStop={intake.stop}
                      read={intake.read}
                      reposRead={repos !== undefined}
                    />
                  </ul>
                );
              case "slack":
                return <AppChannelView choices={slackChannels} controls={slack} source="slack" />;
              case "discord":
                return <AppChannelView controls={discord} source="discord" />;
              case "webhook":
                return <AppWebhooksView controls={webhooks} name={name} />;
              case "schedule":
                return <AppSchedulesView controls={schedules} name={name} />;
            }
          })()}
        </SourceDialog>
      )}
    </>
  );
}

const DIALOG_WORDS: Record<SourceKind, { readonly title: string; readonly description: string }> = {
  github: {
    title: "Take tasks from GitHub issues",
    description:
      "Issues carrying the label on one of the project's GitHub repositories become tasks for its automated Mates.",
  },
  slack: {
    title: "Take tasks from a Slack channel",
    description:
      "A message that mentions Mate in the channel becomes a task; its thread follows it.",
  },
  discord: {
    title: "Take tasks from a Discord channel",
    description: "`/mate` in the channel starts a task in a thread the bot opens.",
  },
  webhook: {
    title: "Webhooks",
    description:
      "Anything that can send a signed request starts a task: POST JSON with title and body, signed with the webhook's secret.",
  },
  schedule: {
    title: "Schedules",
    description: "A brief the project's automated Mates get as a task each time it is due.",
  },
};

export function SourceDialog({
  kind,
  onClose,
  children,
}: {
  readonly kind: SourceKind;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const words = DIALOG_WORDS[kind];
  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      open
    >
      <DialogPopup data-zerops-surface="project-source-dialog">
        <DialogHeader>
          <DialogTitle>{words.title}</DialogTitle>
          <DialogDescription>{words.description}</DialogDescription>
        </DialogHeader>
        <DialogPanel>{children}</DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

/** A pool Mate's face in the masthead: awake while it works, asking while its task waits on a person. */
function PoolFace({
  mate,
  onOpen,
  size,
}: {
  readonly mate: PoolMate;
  readonly onOpen: (projectId: string) => void;
  readonly size?: 20 | 24;
}) {
  const activity = useAtomValue(mateActivityAtom(mate.projectId));
  return (
    <PoolFaceView mate={mate} onOpen={onOpen} size={size} working={activity?.kind === "working"} />
  );
}

/** Its face opens it; its name and what it is on are its tooltip. */
function PoolFaceView({
  mate,
  working,
  onOpen,
  size = 20,
}: {
  readonly mate: PoolMate;
  readonly working: boolean;
  readonly onOpen: (projectId: string) => void;
  /** 24 in the section's masthead, where the faces lead; 20 in the side row's line. */
  readonly size?: 20 | 24 | undefined;
}) {
  return (
    <Button
      aria-label={`${mate.name}: ${poolMateLine(mate.automation, working)}`}
      data-zerops-surface="project-automation-mate"
      onClick={() => {
        onOpen(mate.projectId);
      }}
      shape="round"
      size="icon-xs"
      variant="ghost"
    >
      <MateFace
        shape={mate.shape}
        size={size}
        state={poolMateFace(mate, working)}
        tint={mate.tint}
      />
    </Button>
  );
}

/** What an Owner or Admin may do in the section; absent for anyone else, who reads it. */
export interface AutomationControls {
  readonly onAddMate: (() => void) | undefined;
  /** A kind of source chosen from *Add*: its form. */
  readonly onTakeFrom: (kind: SourceKind) => void;
  /** A source's row, pressed: its form, where its Stop and its Delete are. */
  readonly onEdit: (row: SourceRow) => void;
  readonly onReadAgain: (source: Exclude<SourceKind, "github">) => void;
  readonly onOpenSettings: () => void;
}

/** What the reader may do with each task on the Board, and the presses; absent: a reader only. */
export interface BoardVerbs {
  /** The task's verbs as the rules offer them (`boardOffers`); `undefined`: none known. */
  readonly offerOf: (taskId: string) => BoardTaskOffer | undefined;
  /** The reader's own Mates in the application a Take opens in: a choice where several. */
  readonly takeInto: ReadonlyArray<{ readonly projectId: string; readonly name: string }>;
  /** Where the row's press stands: its Stop asking, a write under way or refused (`taskRowPress`). */
  readonly pressOf: (taskId: string) => RowPress;
  readonly onAsk: (taskId: string) => void;
  readonly onKeep: () => void;
  readonly onStop: (taskId: string) => void;
  readonly onTake: (taskId: string, mateProjectId: string) => void;
  readonly onRelease: (taskId: string) => void;
  readonly onDone: (taskId: string) => void;
}

/**
 * The Board as the section draws it: what HQ answered, or how its read stands (`reading`, with how
 * many rows navigation says each lane will hold, so the Board keeps its height when they land;
 * `none` where the reader may not read it).
 */
export interface BoardView {
  readonly read:
    | {
        readonly state: "reading";
        readonly predicted: Predicted;
      }
    | { readonly state: "known"; readonly board: Board }
    | { readonly state: "failed"; readonly words: string }
    | { readonly state: "none" };
  /** The organization's spend this month against its budget (`spendLine`); `null` unknown. */
  readonly spend: string | null;
  readonly onReadAgain: () => void;
  /** Opens a task's conversation or its change, by its in-app path. */
  readonly onOpen: (route: string) => void;
  /** Opens the conversation a task was put from. */
  readonly onOpenConversation?:
    | ((conversation: NonNullable<BoardRow["origin"]["conversation"]>) => void)
    | undefined;
  /** A Mate's face by its project: a pool Mate's, or a person's own; `undefined` unknown. */
  readonly faceOf?: ((projectId: string) => BoardFace | undefined) | undefined;
  readonly verbs?: BoardVerbs | undefined;
}

/**
 * The section drawn — every read already done and handed in — so a test and the harness can look
 * at it with no account behind it. `workingOf` says which pool Mates work (a harness hands it).
 *
 * The Changes card's anatomy, for tasks: a one-line masthead for the pool, then one ledger whose
 * marks, titles and facts stand in the same columns down every group — At work, Queued, Finished —
 * and the sources its tasks come from as rows of the same list. A group stands while it has a row.
 */
export function ProjectAutomationView({
  pool,
  sources,
  admin,
  board,
  onOpenMate,
  workingOf,
}: {
  /** The task board; absent, none is drawn. */
  readonly board?: BoardView | undefined;
  readonly pool: ReadonlyArray<PoolMate>;
  readonly sources: {
    readonly rows: ReadonlyArray<SourceRow>;
    readonly reading: boolean;
    /** Some sources are refused to the reader: what is shown is not every source. */
    readonly withheld: boolean;
  };
  readonly admin?: AutomationControls | undefined;
  readonly onOpenMate: (projectId: string) => void;
  readonly workingOf?: ((projectId: string) => boolean) | undefined;
}) {
  return (
    <section
      aria-label="Automation"
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] [--ln-ground:transparent] [--ln-track:color-mix(in_oklab,var(--foreground)_30%,transparent)] @container/automation"
      data-zerops-surface="project-automation"
    >
      <AutomationBody
        admin={admin}
        board={board}
        onOpenMate={onOpenMate}
        pool={pool}
        sources={sources}
        workingOf={workingOf}
      />
    </section>
  );
}

function AutomationBody({
  pool,
  sources,
  admin,
  board,
  onOpenMate,
  workingOf,
}: Parameters<typeof ProjectAutomationView>[0]) {
  // The Mates HQ holds on a change that waits for review: the masthead says so, never that they are free.
  const held = new Set(
    board?.read.state === "known" ? board.read.board.blocked.map((line) => line.projectId) : [],
  );
  // Nothing set to take a task from, as far as the reader may see.
  const nowhere = sources.rows.length === 0 && !sources.reading && !sources.withheld;
  // Finished shows its first few; *+ N more* opens the rest in place. Held here, so what grows
  // eases open (`GrowsInPlace`) and the sources go down with it.
  const [all, setAll] = useState(false);
  return (
    <>
      {/* The masthead: the pool in one line, the month's money at its end; too narrow, the money
          takes a line of its own. Flush in a dialog, it starts on the title's edge. */}
      <div
        className="flex min-h-13 min-w-0 items-center gap-2.5 px-4.5 py-3 @max-[520px]/automation:flex-wrap @max-[520px]/automation:gap-y-1 [[data-flush]_&]:px-6"
        data-zerops-surface="project-automation-pool"
      >
        {pool.length === 0 ? null : (
          <span className="flex flex-none gap-1">
            {pool.map((mate) =>
              workingOf === undefined ? (
                <PoolFace key={mate.projectId} mate={mate} onOpen={onOpenMate} size={24} />
              ) : (
                <PoolFaceView
                  key={mate.projectId}
                  mate={mate}
                  onOpen={onOpenMate}
                  size={24}
                  working={workingOf(mate.projectId)}
                />
              ),
            )}
          </span>
        )}
        <span className="min-w-0 truncate text-body @max-[520px]/automation:flex-1 @max-[520px]/automation:whitespace-normal">
          {poolSummary(pool, held)}
        </span>
        {admin?.onAddMate === undefined ? null : (
          // Its words stand 6 px after the pool's: the press's own inset is the rest of the gap.
          <span className="-ms-1.25 flex flex-none">
            <Button aria-label="Add a Mate" onClick={admin.onAddMate} size="sm" variant="link">
              <span>
                + Add<span className={WIDE}>&nbsp;a Mate</span>
              </span>
            </Button>
          </span>
        )}
        {/* The organization's money, in a project's section: it says whose it is. */}
        {board?.spend == null ? null : (
          <span className="ms-auto flex-none text-caption leading-4.5 whitespace-nowrap text-muted-foreground tabular-nums @max-[520px]/automation:ms-0 @max-[520px]/automation:basis-full">
            <span className={WIDE}>All automated Mates · </span>
            {board.spend}
          </span>
        )}
      </div>
      <Separator />
      <GrowsInPlace>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] px-2 pt-1.5 pb-2 [[data-flush]_&]:px-3.5">
          {board === undefined ? null : (
            <TaskBoardView
              all={all}
              board={board}
              onAll={setAll}
              pool={pool}
              waitsFor={nowhere && pool.length > 0 ? pool.map((mate) => mate.name) : undefined}
            />
          )}
          <SourcesView admin={admin} sources={sources} />
        </div>
      </GrowsInPlace>
    </>
  );
}

/** A group of the ledger: the page's label over its rows, in the ledger's own columns. */
function LedgerGroup({
  name,
  count,
  action,
  children,
}: {
  readonly name: string;
  readonly count?: number | undefined;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    // The page's label 15 px over its first row's words, 32 px under the last group's.
    <div
      className="col-span-full grid min-w-0 grid-cols-subgrid pt-1.5 *:col-span-full [&+&]:mt-3 [&>[data-slot=section-header]]:px-2.5"
      data-zerops-board={name}
    >
      <SectionHeader action={action} count={count} level={3} size="panel" title={name} />
      {children}
    </div>
  );
}

function Placeholders({ count }: { readonly count: number }) {
  return (
    <List aria-hidden="true" className={ROWS} render={<ul />}>
      {Array.from({ length: count }, (_, at) => (
        <li className={ROW} key={at}>
          <Row className={PRESS} columns>
            <Skeleton className="col-span-full h-3.5" surface="card" />
          </Row>
        </li>
      ))}
    </List>
  );
}

/**
 * What a row opens across its columns: a task's conversation, by its in-app path. A row with
 * nowhere to lead stays still under the pointer.
 */
function RowPress({
  route,
  onOpen,
  children,
}: {
  readonly route: string | null;
  readonly onOpen: (route: string) => void;
  readonly children: ReactNode;
}) {
  if (route === null)
    return (
      <Row className={PRESS} columns>
        {children}
      </Row>
    );
  return (
    <Row
      className={PRESS}
      columns
      data-press=""
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onOpen(route);
      }}
      pressable
      render={<a href={route} />}
    >
      {children}
    </Row>
  );
}

const RESTS: RowPress = { kind: "idle" };

/**
 * A task's Stop, asked in its row over its facts, so no column moves: *Keep* or *Stop*. The press
 * moves with it: to *Keep* as it asks, back to the row once kept.
 */
function StopAsk({
  verbs,
  taskId,
  question,
}: {
  readonly verbs: BoardVerbs;
  readonly taskId: string;
  readonly question: string;
}) {
  const keep = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    keep.current?.focus();
  }, []);
  return (
    <span className="absolute inset-y-0 start-4 end-2.5 z-2 col-start-3 -col-end-1 flex min-w-0 items-center justify-end gap-1.5 motion-safe:animate-zerops-appear @max-[520px]/automation:start-0 @max-[520px]/automation:col-start-2 @max-[520px]/automation:bg-card">
      <span className="me-1 min-w-0 truncate text-caption leading-4.5 text-muted-foreground">
        {question}
      </span>
      <Button onClick={verbs.onKeep} ref={keep} size="sm" variant="ghost">
        Keep
      </Button>
      <Button
        onClick={() => {
          verbs.onStop(taskId);
        }}
        size="sm"
        variant="destructive"
      >
        Stop
      </Button>
    </span>
  );
}

/**
 * A live task's Stop alone, where it is the row's one verb: in its row's seat while the row is
 * pointed at or focused (always where nothing hovers), in the chevron's place.
 */
function HoverStop({ verbs, taskId }: { readonly verbs: BoardVerbs; readonly taskId: string }) {
  return (
    <span
      className={cn(
        SEAT,
        "pointer-events-none flex opacity-0 transition-opacity duration-150 ease-out-strong group-hover/pa:pointer-events-auto group-hover/pa:opacity-100 group-focus-within/pa:pointer-events-auto group-focus-within/pa:opacity-100 motion-reduce:transition-none [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
      )}
    >
      <Button
        onClick={() => {
          verbs.onAsk(taskId);
        }}
        size="sm"
        variant="ghost"
      >
        Stop
      </Button>
    </span>
  );
}

/**
 * **Take**: into the reader's one Mate in the application at once; where they have several, a
 * choice of which, each by its name.
 */
function TakePress({
  verbs,
  taskId,
  title,
}: {
  readonly verbs: BoardVerbs;
  readonly taskId: string;
  readonly title: string;
}) {
  const [only] = verbs.takeInto;
  if (verbs.takeInto.length === 1 && only !== undefined)
    return (
      <Button
        aria-label={`Take “${title}” into ${only.name}`}
        onClick={() => {
          verbs.onTake(taskId, only.projectId);
        }}
        size="xs"
        variant="secondary"
      >
        Take
      </Button>
    );
  return (
    <Menu>
      <MenuTrigger
        render={<Button aria-label={`Take “${title}” into…`} size="xs" variant="secondary" />}
      >
        Take
        <ChevronDownIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end" width="sm">
        <MenuGroup>
          <MenuGroupLabel>Take it into</MenuGroupLabel>
          {verbs.takeInto.map((mate) => (
            <MenuItem
              key={mate.projectId}
              onClick={() => {
                verbs.onTake(taskId, mate.projectId);
              }}
            >
              {mate.name}
            </MenuItem>
          ))}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

/**
 * A task's verbs beyond the seat's one press — Done where Review takes the seat, Release, and Stop
 * asked in the row — in a menu that stands while the row is pointed at or focused (always where
 * nothing hovers, and while it is open).
 */
function MoreVerbs({
  verbs,
  taskId,
  title,
  done,
  release,
  stop,
}: {
  readonly verbs: BoardVerbs;
  readonly taskId: string;
  readonly title: string;
  readonly done: boolean;
  readonly release: boolean;
  readonly stop: boolean;
}) {
  return (
    <span className="flex opacity-0 transition-opacity duration-150 ease-out-strong group-focus-within/pa:opacity-100 group-hover/pa:opacity-100 has-data-popup-open:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100">
      <Menu>
        <MenuTrigger
          render={<Button aria-label={`More for “${title}”`} size="icon-xs" variant="ghost" />}
        >
          <MoreHorizontalIcon aria-hidden="true" />
        </MenuTrigger>
        <MenuPopup align="end" width="sm">
          {done ? (
            <MenuItem
              onClick={() => {
                verbs.onDone(taskId);
              }}
            >
              Mark it done
            </MenuItem>
          ) : null}
          {release ? (
            <MenuItem
              onClick={() => {
                verbs.onRelease(taskId);
              }}
            >
              Release to the queue
            </MenuItem>
          ) : null}
          {stop ? (
            <MenuItem
              onClick={() => {
                verbs.onAsk(taskId);
              }}
              variant="destructive"
            >
              Stop…
            </MenuItem>
          ) : null}
        </MenuPopup>
      </Menu>
    </span>
  );
}

/** A row's title and, under it, its one line: why it failed, who stopped it, HQ's refusal. */
function RowText({
  title,
  why,
  failed = false,
}: {
  readonly title: string;
  readonly why?: string | null | undefined;
  readonly failed?: boolean;
}) {
  return (
    <span className={TEXT}>
      <CutText className={TITLE} text={title} />
      {why == null ? null : (
        <span
          className={cn(
            "truncate text-caption leading-4",
            failed ? "text-status-failed-text" : "text-muted-foreground",
          )}
          role={failed ? "alert" : undefined}
        >
          {why}
        </span>
      )}
    </span>
  );
}

/**
 * A task slides to its new place when it changes lane: each row's place in the ledger is read
 * after every render, and one that stood elsewhere eases from there. A row that arrives is placed.
 * Reduced motion cuts.
 */
function useSlidingRows() {
  const ledger = useRef<HTMLDivElement | null>(null);
  const stood = useRef<ReadonlyMap<string, number>>(new Map());
  useLayoutEffect(() => {
    const node = ledger.current;
    if (node === null) return;
    const still = prefersReducedMotion();
    const now = new Map<string, number>();
    for (const row of node.querySelectorAll<HTMLElement>("[data-zerops-task]")) {
      const id = row.dataset.zeropsTask ?? "";
      const before = stood.current.get(id);
      now.set(id, row.offsetTop);
      if (still || before === undefined || Math.abs(before - row.offsetTop) < 1) continue;
      row.animate(
        [{ transform: `translateY(${String(before - row.offsetTop)}px)` }, { transform: "none" }],
        { duration: MOTION.duration.base, easing: MOTION.easing.out },
      );
    }
    stood.current = now;
  });
  return ledger;
}

/** The question a row's Stop asks: who stops, and what of it is lost. */
function stopQuestion(row: BoardRow, holder: string | null): string {
  if (row.lane === "queued") return "Stop this task? Nobody has taken it yet.";
  if (row.holder?.kind === "person") return "Stop this task? It leaves the Board.";
  return `Stop this task? ${holder ?? "Its Mate"} stops where it got to.`;
}

/** Where a task came from, in its column: linked out, or back to its conversation, where it can be. */
function OriginWords({
  origin,
  onOpenConversation,
}: {
  readonly origin: BoardRow["origin"];
  readonly onOpenConversation: BoardView["onOpenConversation"];
}) {
  if (origin.url !== null)
    return (
      <InlineButton
        className="pointer-events-auto max-w-full"
        render={<a href={origin.url} rel="noreferrer" target="_blank" />}
        tone="muted"
      >
        <RealName>{origin.words}</RealName>
        <ArrowUpRightIcon aria-hidden="true" className={OUT} />
      </InlineButton>
    );
  const { conversation } = origin;
  if (conversation !== null && onOpenConversation !== undefined)
    return (
      <InlineButton
        aria-label={origin.full}
        className="pointer-events-auto max-w-full"
        onClick={() => {
          onOpenConversation(conversation);
        }}
        tone="muted"
      >
        <span className="truncate">{origin.words}</span>
      </InlineButton>
    );
  return <span className="truncate">{origin.words}</span>;
}

/** One task of the Board, in the ledger's columns, its verbs as the rules offer them. */
function BoardRowView({
  row,
  board,
  face,
}: {
  readonly row: BoardRow;
  readonly board: BoardView;
  readonly face: BoardFace | undefined;
}) {
  const { verbs } = board;
  const offer = verbs?.offerOf(row.id);
  const press = verbs?.pressOf(row.id) ?? RESTS;
  const asking = press.kind === "asking";
  const busy = press.kind === "working";
  const stopping = row.status === "stopping";
  const asks = row.lane === "waiting" && !busy;
  const take = verbs !== undefined && offer?.take === true && verbs.takeInto.length > 0;
  const done = offer?.done === true;
  const release = offer?.release === true;
  const stop = offer?.stop === true && !stopping;
  const review = row.lane === "review" ? row.change : null;
  const holderName =
    row.holder?.kind === "pool" ? (face?.name ?? row.holder.name) : (row.holder?.mate ?? null);
  // The seat's one press; a taken task's other verbs in a menu beside it; a Stop alone on hover.
  const primary = busy
    ? null
    : take
      ? "take"
      : review !== null
        ? "review"
        : done
          ? "done"
          : asks && row.route !== null
            ? "answer"
            : null;
  // Done stands in the menu where Review takes the seat; a task that asks keeps its Stop in its chat.
  const doneInMenu = done && primary === "review";
  const more =
    !busy && (release || doneInMenu || (stop && primary !== null && primary !== "answer"));
  const hoverStop = !busy && stop && !more && primary === null;
  // A write under way says so in the state's column, so the row keeps its height.
  const why = press.kind === "refused" ? press.words : row.detail;
  const state = press.kind === "working" ? (press.words ?? row.state) : row.state;
  return (
    <li className={ROW} data-zerops-task={row.id}>
      <RowPress
        onOpen={board.onOpen}
        route={primary === "review" || primary === "answer" ? null : row.route}
      >
        <span className={cn(LEAD, row.lane === "queued" && "text-caption leading-5 tabular-nums")}>
          {row.lane === "queued" ? (
            row.position
          ) : row.holder?.kind === "person" ? (
            <PersonAvatar name={row.holder.called ?? row.holder.name} size={20} />
          ) : row.lane === "done" || row.lane === "review" ? (
            <BeadMark
              className="pointer-events-none cursor-default"
              mark={undefined}
              tint={face?.tint}
            />
          ) : face === undefined ? null : (
            <MateFace
              shape={face.shape}
              size={20}
              state={asks ? "needs" : stopping ? "idle" : "working"}
              tint={face.tint}
            />
          )}
        </span>
        <RowText
          failed={press.kind === "refused" || row.tone === "failed"}
          title={row.title}
          why={why}
        />
        <span className={facts(asking)}>
          {/* Too narrow for columns: where it came from and its state lead the line under it. */}
          <span className={NARROW}>{row.origin.words}</span>
          {state === null ? null : <span className={NARROW}>{state}</span>}
          <span className={WHO}>{row.who}</span>
          <span className={COST}>{row.cost}</span>
        </span>
        <span className={act(asking)}>
          {primary !== null || more || row.route === null ? null : (
            <ChevronRightIcon aria-hidden="true" className={go(hoverStop)} />
          )}
        </span>
      </RowPress>
      {/* Where it came from and its state stand beside the row's press: their links are their own. */}
      <span className={cn(ORIGIN, asking && "opacity-0")}>
        <OriginWords onOpenConversation={board.onOpenConversation} origin={row.origin} />
      </span>
      <span
        className={cn(
          STATE,
          !busy && row.tone === "attention" && "text-status-attention-text",
          !busy && row.tone === "failed" && "text-status-failed-text",
          asking && "opacity-0",
        )}
      >
        {state}
        {row.change?.external === true && row.lane === "done" ? (
          <>
            {state === null ? null : <span aria-hidden="true"> · </span>}
            <InlineButton
              className="pointer-events-auto"
              render={<a href={row.change.href} rel="noreferrer" target="_blank" />}
              tone="muted"
            >
              {row.change.label}
              <ArrowUpRightIcon aria-hidden="true" className={OUT} />
            </InlineButton>
          </>
        ) : null}
      </span>
      {verbs === undefined || asking || primary === null ? null : (
        <span className={cn(VERB, "flex items-center gap-1")}>
          {/* Its other verbs before it, so every row's one press ends on the seat's edge. */}
          {more ? (
            <MoreVerbs
              done={doneInMenu}
              release={release}
              stop={stop}
              taskId={row.id}
              title={row.title}
              verbs={verbs}
            />
          ) : null}
          {primary === "take" ? (
            <TakePress taskId={row.id} title={row.title} verbs={verbs} />
          ) : primary === "done" ? (
            <Button
              onClick={() => {
                verbs.onDone(row.id);
              }}
              size="xs"
              variant="secondary"
            >
              Done
            </Button>
          ) : primary === "answer" && row.route !== null ? (
            <OpenPress href={row.route} label="Answer" onOpen={board.onOpen} />
          ) : review !== null ? (
            review.external ? (
              <Button
                render={<a href={review.href} rel="noreferrer" target="_blank" />}
                size="xs"
                variant="secondary"
              >
                Review
              </Button>
            ) : (
              <OpenPress href={review.href} label="Review" onOpen={board.onOpen} />
            )
          ) : null}
        </span>
      )}
      {verbs === undefined || primary !== null || !more || asking ? null : (
        <span className={VERB}>
          <MoreVerbs
            done={doneInMenu}
            release={release}
            stop={stop}
            taskId={row.id}
            title={row.title}
            verbs={verbs}
          />
        </span>
      )}
      {verbs !== undefined && hoverStop && !asking ? (
        <HoverStop taskId={row.id} verbs={verbs} />
      ) : null}
      {verbs !== undefined && asking ? (
        <StopAsk question={stopQuestion(row, holderName)} taskId={row.id} verbs={verbs} />
      ) : null}
    </li>
  );
}

/** A press in the row's seat that opens a page in Mate: Answer, Review. */
function OpenPress({
  href,
  label,
  onOpen,
}: {
  readonly href: string;
  readonly label: string;
  readonly onOpen: (route: string) => void;
}) {
  return (
    <Button
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onOpen(href);
      }}
      render={<a href={href} />}
      size="xs"
      variant="secondary"
    >
      {label}
    </Button>
  );
}

function TaskBoardView({
  board,
  pool,
  waitsFor,
  all,
  onAll,
}: {
  readonly board: BoardView;
  readonly pool: ReadonlyArray<PoolMate>;
  /** Whether Done shows every task that ended, or its first few; and the press that says. */
  readonly all: boolean;
  readonly onAll: (all: boolean) => void;
  /**
   * The pool's Mates by name, where the project takes tasks from nowhere yet: a Board with no
   * task says what they wait for.
   */
  readonly waitsFor?: ReadonlyArray<string> | undefined;
}) {
  const { read } = board;
  const ledger = useSlidingRows();
  if (read.state === "none") return null;
  if (read.state === "failed")
    return (
      // The Board's read failed: HQ's words, and the way to read again.
      <div className={LINE}>
        <Failure cause={read.words} className="min-w-0 flex-1" role="alert" size="line" />
        <Button onClick={board.onReadAgain} size="sm" variant="ghost">
          Try again
        </Button>
      </div>
    );
  if (read.state === "reading") {
    const { predicted } = read;
    if (LANES.every((lane) => predicted[lane.id] === 0)) return null;
    return (
      <div className={LEDGER} data-zerops-surface="project-automation-board">
        {LANES.map((lane) =>
          predicted[lane.id] === 0 ? null : (
            <LedgerGroup key={lane.id} name={lane.name}>
              <Placeholders count={predicted[lane.id]} />
              {lane.id === "done" && predicted.doneMore === true ? (
                <div aria-hidden="true" className={MORE} />
              ) : null}
            </LedgerGroup>
          ),
        )}
      </div>
    );
  }
  const { lanes } = read.board;
  if (LANES.every((lane) => lanes[lane.id].length === 0))
    return waitsFor === undefined ? null : (
      <Text className="m-0 px-2.5 pt-2 pb-1.5" render={<p />} variant="description">
        No tasks yet. {waitsFor.length === 1 ? `${waitsFor[0] ?? "It"} takes` : "They take"} one as
        soon as there is somewhere to take it from.
      </Text>
    );
  const faces = new Map(pool.map((mate) => [mate.projectId, mate]));
  const faceOf = (row: BoardRow): BoardFace | undefined => {
    const projectId = row.holder?.projectId;
    return projectId === undefined
      ? undefined
      : (faces.get(projectId) ?? board.faceOf?.(projectId));
  };
  return (
    <div className={LEDGER} data-zerops-surface="project-automation-board" ref={ledger}>
      {LANES.map((lane) => {
        const rows = lanes[lane.id];
        if (rows.length === 0) return null;
        const shown = lane.id === "done" && !all ? rows.slice(0, RECENT_SHOWN) : rows;
        return (
          <LedgerGroup count={rows.length} key={lane.id} name={lane.name}>
            <List className={ROWS} render={<ul />}>
              {shown.map((row) => (
                <BoardRowView board={board} face={faceOf(row)} key={row.id} row={row} />
              ))}
            </List>
            {lane.id === "done" && rows.length > RECENT_SHOWN ? (
              // Done past its first few: opened in place, on the titles' edge.
              <div className={MORE}>
                <SectionAction
                  onClick={() => {
                    onAll(!all);
                  }}
                >
                  {all ? "Show fewer" : `+ ${String(rows.length - RECENT_SHOWN)} more`}
                </SectionAction>
              </div>
            ) : null}
          </LedgerGroup>
        );
      })}
    </div>
  );
}

/** A source's mark: GitHub's, a channel's, a webhook, a schedule, as a task's card has them. */
function SourceMark({ kind }: { readonly kind: SourceKind }) {
  const Icon =
    kind === "github"
      ? GitHubIcon
      : kind === "slack"
        ? HashIcon
        : kind === "discord"
          ? MessagesSquareIcon
          : kind === "webhook"
            ? WebhookIcon
            : CalendarClockIcon;
  return <Icon aria-hidden="true" className="size-4" />;
}

/**
 * Where the project takes tasks from, as rows of the ledger: each source its mark, what it is,
 * where or when, and how many of its tasks wait. For an Owner or Admin a row opens its form —
 * its Stop and its Delete live there — and *Add* offers every kind; with none set yet, the kinds
 * stand in the group that will hold them.
 */
function SourcesView({
  sources,
  admin,
}: {
  readonly sources: Parameters<typeof ProjectAutomationView>[0]["sources"];
  readonly admin: AutomationControls | undefined;
}) {
  const { rows } = sources;
  const none = rows.length === 0;
  // Nothing to read and nothing the reader could add: the group is not drawn.
  if (none && !sources.reading && !sources.withheld && admin === undefined) return null;
  const count = rows.filter((row) => row.kind !== "failed").length;
  return (
    // The sources: their own facts, on the same left edge.
    <div
      className={cn(LEDGER, "mt-3 grid-cols-[auto_minmax(0,1fr)_auto_auto_auto]")}
      data-zerops-surface="project-automation-sources"
    >
      <LedgerGroup
        action={
          admin === undefined || none ? undefined : (
            <Menu>
              <MenuTrigger render={<Button size="sm" variant="link" />}>+ Add</MenuTrigger>
              <MenuPopup align="end">
                {SOURCE_KINDS.map((entry) => (
                  <MenuItem
                    key={entry.kind}
                    onClick={() => {
                      admin.onTakeFrom(entry.kind);
                    }}
                  >
                    {entry.label}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          )
        }
        count={count === 0 ? undefined : count}
        name="Takes tasks from"
      >
        {!none ? (
          <List className={ROWS} render={<ul />}>
            {rows.map((row) => (
              <SourceRowView admin={admin} key={row.key} row={row} />
            ))}
          </List>
        ) : sources.reading ? (
          <div className={LINE}>
            <WaitLine text="Reading…" />
          </div>
        ) : admin === undefined ? null : (
          // No source yet: the kinds stand in the group that will hold them.
          <div className="flex flex-wrap gap-2 px-2.5 pt-1 pb-2">
            {SOURCE_KINDS.map((entry) => (
              <Button
                key={entry.kind}
                onClick={() => {
                  admin.onTakeFrom(entry.kind);
                }}
                size="sm"
                variant="secondary"
              >
                {entry.label}
              </Button>
            ))}
          </div>
        )}
        {sources.withheld ? (
          <p className="m-0 px-2.5 pt-1.5 pb-0.5 text-caption leading-4.5 text-muted-foreground">
            Owners and admins see every source.
          </p>
        ) : null}
      </LedgerGroup>
    </div>
  );
}

function SourceRowView({
  row,
  admin,
}: {
  readonly row: SourceRow;
  readonly admin: AutomationControls | undefined;
}) {
  const failed = row.kind === "failed";
  const disconnected = (row.kind === "slack" || row.kind === "discord") && row.disconnected;
  const cells = (
    <>
      <span className={LEAD}>
        <SourceMark kind={failed ? row.source : row.kind} />
      </span>
      <span className={TEXT}>
        <span
          className={cn(TITLE, failed && "text-status-failed-text")}
          role={failed ? "alert" : undefined}
        >
          {row.title}
          {row.kind === "github" ? (
            <>
              {" "}
              <RealName>{row.label}</RealName>
            </>
          ) : null}
        </span>
      </span>
      <span className={facts(false)}>
        {disconnected ? (
          <span className={cn(STATE, "text-status-attention-text")}>Not connected</span>
        ) : null}
        {row.detail === null && row.meta === null ? null : (
          <span className={cn(WHO, "col-start-4")}>
            {row.kind === "github" ? <RealName>{row.detail}</RealName> : row.detail}
            {row.detail === null || row.meta === null ? null : " · "}
            {row.meta}
          </span>
        )}
      </span>
      <span className={cn(act(false), "col-start-5")}>
        {admin === undefined || failed || disconnected ? null : (
          <ChevronRightIcon aria-hidden="true" className={go(false)} />
        )}
      </span>
    </>
  );
  return (
    <li className={ROW} data-zerops-source={row.kind}>
      {admin === undefined ? (
        <Row className={PRESS} columns>
          {cells}
        </Row>
      ) : (
        <Row
          className={PRESS}
          columns
          data-press=""
          onClick={() => {
            admin.onEdit(row);
          }}
          pressable
          render={<button type="button" />}
        >
          {cells}
        </Row>
      )}
      {admin === undefined ? null : failed ? (
        <span className={cn(VERB, "col-start-5")}>
          <Button
            onClick={() => {
              admin.onReadAgain(row.source);
            }}
            size="sm"
            variant="ghost"
          >
            Try again
          </Button>
        </span>
      ) : disconnected ? (
        <span className={cn(VERB, "col-start-5")}>
          <Button onClick={admin.onOpenSettings} size="xs" variant="secondary">
            Connect
          </Button>
        </span>
      ) : null}
    </li>
  );
}

/** Words only a wide ledger has room for. */
const WIDE = "@max-[760px]/automation:hidden";

/**
 * One grid for the tasks, its facts in columns that run down every group: a mark, the title, the
 * state, the pull request, whose and when, the cost, the seat of the row's one press. Too narrow
 * for columns (a phone), a row's facts are one line under its title, its seat beside both.
 */
const LEDGER =
  "relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto_auto_auto_auto] @max-[520px]/automation:grid-cols-[auto_minmax(0,1fr)_auto]";
const ROWS = "grid min-w-0 grid-cols-subgrid";

/**
 * A row: the Changes ledger's own, 40 px, a hairline over each but the first. It holds its ground
 * while any of it is pointed at: its Stop and its Review stand over it.
 */
const ROW =
  "group/pa relative col-span-full grid min-w-0 grid-cols-subgrid items-center [--change-gap:10px] [--row-pad-x:10px] [--row-pad-y:6px] [&:hover>[data-press]]:bg-item-hover";
const PRESS = "row-start-1 min-h-10 items-center";

/** A row's mark: a Mate's face, a queued task's place, a finished one's bead, a source's icon. */
const LEAD = "col-start-1 row-start-1 me-3 grid size-5 place-items-center text-muted-foreground";

/** The title and, under it, its one line: why it failed, who stopped it. */
const TEXT = "col-start-2 row-start-1 grid min-w-0";
const TITLE = "truncate text-body leading-5 max-sm:line-clamp-2 max-sm:whitespace-normal";

/** A row's facts, each in the ledger's column: muted figures on one line. */
const FACT =
  "ms-4 text-caption leading-4.5 whitespace-nowrap text-muted-foreground tabular-nums @max-[520px]/automation:ms-0 @max-[520px]/automation:min-w-0";

/**
 * Where a task came from, in its column beside the row's press (its link is its own); too narrow
 * for columns, it leads the line under the title instead (`NARROW`).
 */
const ORIGIN = cn(
  FACT,
  "pointer-events-none z-1 col-start-3 row-start-1 flex max-w-82.5 min-w-0 items-center transition-opacity duration-150 ease-out-strong motion-reduce:transition-none @max-[760px]/automation:max-w-42.5 @max-[520px]/automation:hidden",
);

/** A state said in words, only where its lane does not: Taken by Ana, Asks you, Failed, Merged. */
const STATE = cn(
  FACT,
  "pointer-events-none z-1 col-start-4 row-start-1 transition-opacity duration-150 ease-out-strong motion-reduce:transition-none @max-[520px]/automation:hidden",
);

/** What stands in a column of its own on a wide ledger, said on the line under the title on a narrow one. */
const NARROW = "hidden truncate @max-[520px]/automation:inline";
const WHO = cn(FACT, "col-start-5 row-start-1 text-end");
const COST = cn(FACT, "col-start-6 row-start-1 min-w-9.5 text-end");
const OUT = "size-2.75 flex-none";

/**
 * The facts stand in the ledger's columns (the wrapper is theirs only where the ledger is too
 * narrow); Stop asks over them, and they keep their columns under it.
 */
function facts(asking: boolean): string {
  return cn(
    "contents *:transition-opacity *:duration-150 *:ease-out-strong motion-reduce:*:transition-none",
    "@max-[520px]/automation:col-start-2 @max-[520px]/automation:row-start-2 @max-[520px]/automation:flex @max-[520px]/automation:min-w-0 @max-[520px]/automation:overflow-hidden @max-[520px]/automation:[&>*+*]:before:mx-1.5 @max-[520px]/automation:[&>*+*]:before:content-['·']",
    asking && "*:pointer-events-none *:opacity-0",
  );
}

/** The seat of a row's one press, held in every row: a chevron ends where Answer and Review do. */
function act(asking: boolean): string {
  return cn(
    "col-start-7 row-start-1 ms-3 flex min-h-7 min-w-14.5 items-center justify-end transition-opacity duration-150 ease-out-strong motion-reduce:transition-none @max-[520px]/automation:col-start-3 @max-[520px]/automation:row-[1/span_2]",
    asking && "pointer-events-none opacity-0",
  );
}

/** A press of its own in the row's seat, beside the press that opens it: Review, Connect, Stop. */
const SEAT =
  "z-1 col-start-7 row-start-1 ms-3 me-2.5 justify-self-end @max-[520px]/automation:col-start-3 @max-[520px]/automation:row-[1/span_2]";
const VERB = SEAT;

/**
 * Where a row leads, quiet at rest; on a row with a Stop it gives way to the Stop while the row is
 * pointed at or focused, and always where nothing hovers.
 */
function go(stoppable: boolean): string {
  return stoppable
    ? "size-4 flex-none text-muted-foreground opacity-55 transition-opacity duration-150 ease-out-strong group-focus-within/pa:opacity-0 group-hover/pa:opacity-0 motion-reduce:transition-none [@media(hover:none)]:opacity-0"
    : goClass(true);
}

/** Finished past its first few, and its stand-in while read. */
const MORE = "flex min-h-7.5 items-center ps-8 pe-2.5 pt-0.5";

/** A line in the card: the read that failed, the sources being read. */
const LINE = "flex min-h-10 items-center gap-2 px-2.5 py-1.5";
