/**
 * An application's Board, on its two pages. The project page holds the short Board
 * (`ProjectAutomation`): New task first, a title line that opens its brief in place
 * (`NewBoardTask`); the pool of its automated Mates as one line (their faces, how many and what they
 * are doing, *Add a Mate*, and the organization's spend this month against its budget); the few
 * tasks that need the reader; and the way to the Board's own page. That page holds the whole Board
 * (`BoardAutomation`): every lane, read from HQ and read again by the data layer as HQ's navigation
 * says their tasks moved (`hqTaskBoardRefresh`), and at its foot the sources its tasks come from —
 * GitHub issues by label, a Slack or Discord channel, webhooks, schedules — one row each, which
 * opens its form, and *Add* to take tasks from one more. Configured where the project is: Settings
 * keeps only what is the organization's (its key, its GitHub apps, its Slack and Discord, its
 * limits and budget).
 *
 * An Owner or Admin sets it up on the Board's page; anyone else puts tasks and reads the pool, the
 * Board and the GitHub source.
 */
import { couldntRead } from "@t3tools/client-runtime/zerops/hq";
import type { MateMarkState, MateShapeId, MateTintId } from "@t3tools/shared/brand";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import { appName } from "@t3tools/shared/hqGithub";
import type { HqNavigationMateTask } from "@t3tools/shared/hqStream";
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import {
  assignCandidateMateTints,
  mateShapeOf,
  projectNameInApp,
  STRANDED_TAKE_WORDS,
} from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { useNavigate } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";

import { useAppIntake, useAutomatedKey } from "~/zerops/useAutomationSettings";
import {
  useAppTaskSource,
  useAppTaskStops,
  useBoardTaskWrites,
  useGithubApp,
  useOrgTaskSource,
} from "~/zerops/useTaskSourceSettings";
import {
  askAnswerOnArrival,
  useBoardOffers,
  useMateFaces,
  strandedTakesAtom,
  useOpenTaskConversation,
  useTakeOpenings,
  useTakeTask,
} from "~/zerops/useBoardTasks";
import { useHqPersonNames } from "~/zerops/useZeropsMateOwners";
import { useNewMateDialog } from "~/zerops/newMate";
import { useAddMateOffer } from "~/zerops/useHqOffers";
import { useOpenMate } from "~/zerops/useOpenMate";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { mateActivityAtom } from "~/zerops/mateActivityAtoms";
import { hqMateVersionsAtom, hqPlacementsAtom } from "~/state/zerops";
import { useNowMs } from "~/zerops/useNowMs";
import { useAtomValue } from "@effect/atom-react";

import { Button } from "../../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import { Separator } from "../../ui/separator";
import { intakeRepoChoices } from "../../settings/automatedMatesSettings.logic";
import { appReaching } from "../../settings/automationSettings.logic";
import { MateFace } from "../primitives";
import { GrowsInPlace } from "../system";
import { mateAutomation, type MateAutomationLine } from "../SidebarMateRow.logic";
import { boardAnswerState } from "../board/boardAsk.logic";
import { BoardLanes, CompactBoard } from "./BoardList";
import { BoardSources } from "./BoardSources";
import type { BoardView, Predicted, SourceControls } from "./boardView";
import {
  connectionMissing,
  poolMateLine,
  sourceRows,
  type SourceKind,
  type SourceRow,
} from "./projectAutomation.logic";
import { AppChannelView, AppIntakeView, AppSchedulesView, AppWebhooksView } from "./sourceForms";
import { NewBoardTask } from "./NewBoardTask";
import {
  boardOf,
  boardWaitingCount,
  heldOnItsChange,
  poolSummary,
  predictedBoard,
  RECENT_SHOWN,
  spendLine,
  taskRowPress,
} from "./taskBoard.logic";

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

/**
 * The project page's Board: New task, the pool's line, the few tasks that need the reader
 * (`compactRows`), and the way to the Board's own page with its totals. A row opens the Board's
 * page with its task picked.
 */
export function ProjectAutomation({ groupId }: { readonly groupId: string }) {
  const navigate = useNavigate();
  const { board, pool, onOpenMate, addMate } = useAppBoard(groupId);
  const toBoard = (task?: string) => {
    void navigate({
      to: "/group/$groupId/board",
      params: { groupId },
      search: task === undefined ? {} : { task },
    });
  };
  return (
    <ProjectAutomationView
      admin={addMate === undefined ? undefined : { onAddMate: addMate }}
      board={{
        ...board,
        onPick: (taskId, answer) => {
          if (answer === true) askAnswerOnArrival(taskId);
          toBoard(taskId);
        },
        pickHref: (taskId) => boardHref(groupId, taskId),
      }}
      boardHref={boardHref(groupId)}
      mode="compact"
      // Keyed by the application: no draft follows the person to another one.
      newTask={<NewBoardTask appId={groupId} key={groupId} />}
      onOpenBoard={() => {
        toBoard();
      }}
      onOpenMate={onOpenMate}
      pool={pool}
    />
  );
}

/** The Board's page of application `appId`, at its task `taskId` where given. */
function boardHref(appId: string, taskId?: string): string {
  const path = `/group/${encodeURIComponent(appId)}/board`;
  return taskId === undefined ? path : `${path}?task=${encodeURIComponent(taskId)}`;
}

/**
 * An application's Board and its pool, as both its pages read them: HQ's tasks of it, the pool of
 * its automated Mates and what each is on, the way into a pool Mate, and *Add a Mate* where the
 * reader may add one.
 */
export function useAppBoard(groupId: string): {
  readonly board: BoardView;
  readonly pool: ReadonlyArray<PoolMate>;
  readonly onOpenMate: (projectId: string) => void;
  readonly addMate: (() => void) | undefined;
} {
  const { pool, live, tasks } = usePool(groupId);
  const intake = useAppIntake(groupId);
  const addMate = useAddAutomatedMate(groupId);
  const openMate = useOpenMate();
  const board = useTaskBoard(
    groupId,
    live,
    predictedBoard(tasks, intake.read.intake?.waiting ?? 0, useTakenCount(groupId)),
    pool,
  );
  return {
    board,
    pool,
    onOpenMate: (projectId) => {
      openMate({ projectId });
    },
    addMate,
  };
}

/**
 * The Board's page's list: New task, the pool's line, every lane, and at its foot where the
 * project takes tasks from — which an Owner or Admin sets up here, each source's form a dialog over
 * the page; anyone else reads the GitHub source.
 */
export function BoardAutomation({
  groupId,
  name,
  repos,
  board,
  pool,
  onOpenMate,
  addMate,
}: {
  readonly groupId: string;
  /** The project's name; undefined while the listing has not named it. */
  readonly name: string | undefined;
  /** Its repositories, where GitHub issues come from once one mirrors there; undefined unread. */
  readonly repos: ReadonlyArray<RepoListEntry> | undefined;
  readonly board: BoardView;
  readonly pool: ReadonlyArray<PoolMate>;
  readonly onOpenMate: (projectId: string) => void;
  readonly addMate: (() => void) | undefined;
}) {
  const { activeOrganization } = useZeropsSession();
  const admin = roleAtLeast(activeOrganization?.roleCode, "ADMIN");
  const intake = useAppIntake(groupId);
  // The Board's first line, whoever reads it.
  // Keyed by the application: no draft follows the person to another one.
  const newTask = <NewBoardTask appId={groupId} key={groupId} />;
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
    return (
      <ProjectAutomationView
        board={board}
        mode="page"
        newTask={newTask}
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
      newTask={newTask}
      onOpenMate={onOpenMate}
      pool={pool}
      repos={repos}
    />
  );
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
 * How many of the application's tasks wait, Queued or Waiting for you (`boardWaitingCount`), for
 * the page's *Board*; `undefined` until HQ answered the Board's read, which the page's Board
 * section holds open, so counting asks nothing more.
 */
export function useBoardWaitingCount(groupId: string): number | undefined {
  const setting = useAppTaskSource("hqAppTasks", groupId).read.setting;
  const { live } = usePool(groupId);
  const held = setting.state === "known" ? setting.held : null;
  return useMemo(() => (held === null ? undefined : boardWaitingCount(held, live)), [held, live]);
}

/**
 * How many automated Mates the project has, for what is offered to run on them; `null` while the
 * listing, read only in part, may still hold one.
 */
export function useAutomatedMateCount(groupId: string): number | null {
  const { pool, complete } = usePool(groupId);
  return pool.length > 0 || complete ? pool.length : null;
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

/**
 * How Done and the held tasks last landed, per application, while this page lives: navigation
 * names only each Mate's latest task and counts no held one, so the next read's placeholders take
 * their sizes from the last answer.
 */
const landed = new Map<
  string,
  {
    readonly done: number;
    readonly doneMore: boolean;
    /**
     * Its tasks that wait for others (Queued) and whose need broke (Waiting for you): HQ's
     * navigation counts neither, so the next read's placeholders take them from the last answer.
     */
    readonly held: number;
    readonly broken: number;
  }
>();

/** The placeholders while the Board reads: navigation's counts, with what the last answer held. */
function predictedFor(groupId: string, predicted: Predicted): Predicted {
  const last = landed.get(groupId);
  if (last === undefined) return predicted;
  return {
    ...predicted,
    queued: predicted.queued + last.held,
    waiting: predicted.waiting + last.broken,
    done: last.done,
    doneMore: last.doneMore,
  };
}

/**
 * The application's Board: HQ's tasks of it, read while the section is drawn (and again by the
 * data layer as its Board revision or its pool's tasks move), live rows moving with navigation; the
 * organization's spend this month; who and which Mate each task names; and what the reader may do
 * with each task (`boardOffers`) — Take into one of their own Mates, Release, Done, Stop (asked in
 * its panel first) — each task's writes its own record (`appTaskWrites`), the one its conversation
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
  const openings = useTakeOpenings();
  const strandedTakes = useAtomValue(strandedTakesAtom);
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
      held: made.lanes.queued.filter((row) => row.status === "held").length,
      broken: made.lanes.waiting.filter((row) => row.broken.length > 0).length,
    });
    return made;
  }, [held, nowMs, groupId, live, versions, viewerId, personName, faces]);
  const shownIds = useMemo(() => (held === null ? [] : held.map((task) => task.id)), [held]);
  // The reader's own Takes on this Board whose conversation none of their Mate's carries.
  const stranded = useMemo(() => {
    const byId = new Map(held?.map((task) => [task.id, task] as const));
    return new Set(
      strandedTakes.flatMap((take) => {
        const taker = byId.get(take.taskId)?.taker;
        return taker?.kind === "person" &&
          taker.userId === viewerId &&
          taker.mateProjectId === take.mateProjectId
          ? [take.taskId]
          : [];
      }),
    );
  }, [held, strandedTakes, viewerId]);
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
            : { state: "reading", predicted: predictedFor(groupId, predicted) },
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
            mateName: (projectId) => faces.get(projectId)?.name ?? "Your Mate",
            pressOf: (taskId) =>
              taskRowPress({
                taskId,
                asking,
                action: stops.stops[taskId],
                opening: openings.has(taskId)
                  ? { kind: "opening" }
                  : stranded.has(taskId)
                    ? { kind: "stranded", words: STRANDED_TAKE_WORDS }
                    : undefined,
              }),
            strandedOf: (taskId) => stranded.has(taskId),
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
              void take.take(taskId, mateProjectId);
            },
            onOpenTaken: (taskId) => {
              const task = held?.find((each) => each.id === taskId);
              if (task?.taker?.kind === "person") void take.open(task, task.taker.mateProjectId);
            },
            onRelease: (taskId) => {
              void writes?.release(taskId);
            },
            onDone: (taskId) => {
              void writes?.done(taskId);
            },
            answerOf: (taskId) => boardAnswerState(stops.stops[taskId]),
            onAnswer: (taskId, text) => {
              writes?.answer(taskId, text);
            },
            onDropNeed: (taskId, neededId) => {
              void writes?.dropNeed(taskId, neededId);
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
  newTask,
  onOpenMate,
}: {
  readonly board: BoardView;
  readonly newTask: ReactNode;
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
        mode="page"
        newTask={newTask}
        admin={{
          onAddMate: addMate,
          sources: {
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
          },
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

/**
 * What the reader may set up: *Add a Mate* wherever they may add one; on the Board's page, for an
 * Owner or Admin, the sources. Absent: they read it.
 */
export interface AutomationControls {
  readonly onAddMate: (() => void) | undefined;
  /** The sources' controls, on the Board's page; absent on the project page, which lists none. */
  readonly sources?: SourceControls | undefined;
}

/**
 * The Board drawn — every read already done and handed in — so a test and the harness can look at
 * it with no account behind it. `workingOf` says which pool Mates work (a harness hands it).
 *
 * New task first, then a one-line masthead for the pool, then the Board: on the project page
 * (`compact`) the few tasks that need the reader and the way to the Board's page; on that page
 * (`page`) every lane, and the sources its tasks come from at its foot.
 */
export function ProjectAutomationView({
  mode,
  newTask,
  pool,
  sources,
  admin,
  board,
  onOpenMate,
  onOpenBoard,
  boardHref,
  workingOf,
}: {
  readonly mode: "compact" | "page";
  /** The Board's first line, New task (`NewBoardTask`); absent, none. */
  readonly newTask?: ReactNode;
  /** The task board; absent, none is drawn. */
  readonly board?: BoardView | undefined;
  readonly pool: ReadonlyArray<PoolMate>;
  /** Where its tasks come from, on the Board's page; the project page lists none. */
  readonly sources?:
    | {
        readonly rows: ReadonlyArray<SourceRow>;
        readonly reading: boolean;
        /** Some sources are refused to the reader: what is shown is not every source. */
        readonly withheld: boolean;
      }
    | undefined;
  readonly admin?: AutomationControls | undefined;
  readonly onOpenMate: (projectId: string) => void;
  /** The project page's way to the Board's own page, and its address. */
  readonly onOpenBoard?: (() => void) | undefined;
  readonly boardHref?: string | undefined;
  readonly workingOf?: ((projectId: string) => boolean) | undefined;
}) {
  // The Mates HQ holds on a change that waits for review: the masthead says so, never that they are free.
  const held = new Set(
    board?.read.state === "known" ? board.read.board.blocked.map((line) => line.projectId) : [],
  );
  const waitsFor = pool.length > 0 ? pool.map((mate) => mate.name) : undefined;
  return (
    <section
      aria-label="Board"
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] @container/automation"
      data-zerops-surface="project-automation"
    >
      {newTask}
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
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] px-2 pt-2 pb-2 [[data-flush]_&]:px-3.5">
          {board === undefined ? null : mode === "compact" ? (
            <CompactBoard
              board={board}
              boardHref={boardHref}
              onOpenBoard={onOpenBoard}
              waitsFor={waitsFor}
            />
          ) : (
            <BoardLanes board={board} waitsFor={waitsFor} />
          )}
          {mode === "page" && sources !== undefined ? (
            <BoardSources admin={admin?.sources} sources={sources} />
          ) : null}
        </div>
      </GrowsInPlace>
    </section>
  );
}

/** Words only a wide masthead has room for. */
const WIDE = "@max-[760px]/automation:hidden";
