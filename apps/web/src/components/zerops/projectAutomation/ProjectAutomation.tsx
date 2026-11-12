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
import { couldntRead, hqNeedsUpdate } from "@t3tools/client-runtime/zerops/hq";
import {
  MOTION,
  type MateMarkState,
  type MateShapeId,
  type MateTintId,
} from "@t3tools/shared/brand";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
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
  ChevronRightIcon,
  HashIcon,
  MessagesSquareIcon,
  WebhookIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { automatedKeyState } from "~/zerops/automatedMate.logic";
import { useAppIntake, useAutomatedKey, useOrgAiKeys } from "~/zerops/useAutomationSettings";
import {
  useAppTaskSource,
  useAppTaskStops,
  useGithubApp,
  useOrgTaskSource,
} from "~/zerops/useTaskSourceSettings";
import { TASK_STATUS_WORDS } from "~/zerops/taskStatus";
import { useNewMateDialog } from "~/zerops/newMate";
import { useAddMateOffer } from "~/zerops/useHqOffers";
import { useOpenMate } from "~/zerops/useOpenMate";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { mateActivityAtom } from "~/zerops/mateActivityAtoms";
import { hqMateVersionsAtom } from "~/state/zerops";
import { useNowMs } from "~/zerops/useNowMs";
import { useAtomValue } from "@effect/atom-react";

import { GitHubIcon } from "../../Icons";
import { Button } from "../../ui/button";
import { WaitLine } from "../WaitLine";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import { Skeleton } from "../../ui/skeleton";
import { intakeRepoChoices } from "../../settings/automatedMatesSettings.logic";
import { appName, appReaching } from "../../settings/automationSettings.logic";
import { MateFace } from "../primitives";
import { SetupRow } from "../project/SetupCard";
import { automationSummary } from "../project/projectSetup.logic";
import { CutText, GrowsInPlace, SectionAction, SectionLabel } from "../system";
import { mateAutomation, type MateAutomationLine } from "../SidebarMateRow.logic";
import {
  automationSection,
  connectionMissing,
  poolMateLine,
  SOURCE_KINDS,
  sourceRowPress,
  sourceRows,
  type RowPress,
  type SourceKind,
  type SourceRow,
} from "./projectAutomation.logic";
import { AppChannelView, AppIntakeView, AppSchedulesView, AppWebhooksView } from "./sourceForms";
import {
  atWorkWords,
  boardOf,
  heldOnItsChange,
  poolSummary,
  predictedBoard,
  RECENT_SHOWN,
  spendLine,
  type Board,
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
export function poolMateFace(mate: Pick<PoolMate, "automation">, working: boolean): MateMarkState {
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
  // An Owner or Admin reads the key here, so an HQ older than automated Mates shows no section;
  // anyone else goes by what the app's root holds.
  const keys = useOrgAiKeys(admin);
  const held = useAutomatedKey();
  const key = admin ? automatedKeyState(keys.read.keys) : held;
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
    predictedBoard(tasks, intake.read.intake?.waiting ?? 0),
    admin,
  );
  if (!admin) {
    if (key === "unsupported") return null;
    const { rows, withheld } = sourceRows({
      intake: intake.read.intake,
      slack: WITHHELD,
      discord: WITHHELD,
      webhooks: WITHHELD,
      schedules: WITHHELD,
      slackConnected: undefined,
      discordConnected: undefined,
    });
    if (automationSection({ admin, key, pool: pool.length, sources: rows.length }) === "hidden")
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
  if (automationSection({ admin, key, pool: 0, sources: 0 }) === "update")
    return (
      <ProjectAutomationView
        onOpenMate={onOpenMate}
        pool={[]}
        sources={{ rows: [], reading: false, withheld: false }}
        update
      />
    );
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
 * else while there is nothing to read, nor where HQ is older than automated Mates.
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
  const keys = useOrgAiKeys(admin);
  const held = useAutomatedKey();
  const key = admin ? automatedKeyState(keys.read.keys) : held;
  const { pool } = usePool(groupId);
  const addMate = useAddAutomatedMate(groupId);
  const openMate = useOpenMate();
  if (automationSection({ admin, key, pool: pool.length, sources: 0 }) !== "shown") return null;
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
  return usePool(groupId).pool.length > 0;
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
        <span className="min-w-0 truncate text-line text-muted-foreground">
          {automationSummary(pool)}
        </span>
      </div>
    </SetupRow>
  );
}

const WITHHELD = { state: "withheld" } as const;

/**
 * The pool: the project's automated Mates, as HQ places them, each with what it is on; and what
 * HQ's navigation says of the task each is on — by the task's id, for the board's live rows, and
 * as a list, for how many rows the board will hold while it reads.
 */
function usePool(groupId: string): {
  readonly pool: ReadonlyArray<PoolMate>;
  readonly live: ReadonlyMap<string, HqNavigationMateTask>;
  readonly tasks: ReadonlyArray<HqNavigationMateTask | null>;
} {
  const { listing } = useZeropsCandidates();
  const key = useAutomatedKey();
  const candidates = useMemo(() => heldCandidates(listing).rows, [listing]);
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
  return { pool, live, tasks };
}

/** How many rows each group will hold while the board reads (`predictedBoard`); none, no group. */
interface Predicted {
  readonly atWork: number;
  readonly queued: number;
  readonly recent: number;
  /** The line that opens the ones that ended earlier. */
  readonly recentMore?: boolean | undefined;
}

/**
 * How Finished last landed, per application, while this page lives: navigation names only each
 * Mate's latest task, so the next read's placeholders take Finished's size from the last answer.
 */
const landed = new Map<string, { readonly recent: number; readonly recentMore: boolean }>();

/**
 * The application's task board: HQ's tasks of it, read while the section is drawn (and again by
 * the data layer as navigation says its tasks moved), live rows moving with navigation; the
 * organization's spend this month; and an Owner's or Admin's Stop of a task, asked in its row,
 * each task's stop its own record (`appTaskStops`), the one its conversation's band reads too.
 */
function useTaskBoard(
  groupId: string,
  live: ReadonlyMap<string, HqNavigationMateTask>,
  predicted: Predicted,
  /** An Owner or Admin: each live task has its Stop. */
  admin: boolean,
): BoardView {
  const tasks = useAppTaskSource("hqAppTasks", groupId);
  const limits = useOrgTaskSource("hqTaskLimits");
  // HQ holds a Mate on its open change only where it runs a version before its change per task.
  const versions = useAtomValue(hqMateVersionsAtom);
  const nowMs = useNowMs();
  const navigate = useNavigate();
  const [asking, setAsking] = useState<string | null>(null);
  const setting = tasks.read.setting;
  const held = setting.state === "known" ? setting.held : null;
  const board = useMemo(() => {
    if (held === null) return null;
    const made = boardOf(held, nowMs, groupId, live, (projectId) =>
      heldOnItsChange(versions[projectId]),
    );
    landed.set(groupId, {
      recent: Math.min(made.recent.length, RECENT_SHOWN),
      recentMore: made.recent.length > RECENT_SHOWN,
    });
    return made;
  }, [held, nowMs, groupId, live, versions]);
  const stoppable = board === null ? [] : [...board.atWork, ...board.queued].map((row) => row.id);
  const stops = useAppTaskStops(groupId, stoppable);
  return {
    read:
      board !== null
        ? { state: "known", board }
        : setting.state === "failed"
          ? { state: "failed", words: couldntRead("its tasks", setting.words) }
          : setting.state === "withheld" || setting.state === "unsupported"
            ? { state: "none" }
            : { state: "reading", predicted: { ...predicted, ...landed.get(groupId) } },
    spend: limits.read.setting.state === "known" ? spendLine(limits.read.setting.held) : null,
    onReadAgain: tasks.again,
    onOpen: (route) => {
      void navigate({ href: route });
    },
    stop: !admin
      ? undefined
      : {
          pressOf: (taskId) =>
            sourceRowPress({
              key: taskId,
              asking,
              pressed: taskId,
              action: stops.stops[taskId] ?? { kind: "idle" },
            }),
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
                  <p className="text-sm text-foreground">{missing}</p>
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
export function PoolFaceView({
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
    <button
      aria-label={`${mate.name}: ${poolMateLine(mate.automation, working)}`}
      className="flex size-6 items-center justify-center rounded-full hover:bg-accent/60"
      data-zerops-surface="project-automation-mate"
      onClick={() => {
        onOpen(mate.projectId);
      }}
      type="button"
    >
      <MateFace
        shape={mate.shape}
        size={size}
        state={poolMateFace(mate, working)}
        tint={mate.tint}
      />
    </button>
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

/**
 * The task board as the section draws it: what HQ answered, or how its read stands (`reading`,
 * with how many rows navigation says each group will hold, so the board keeps its height when they
 * land; `none` where the reader may not read it or HQ predates it).
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
  /** An Owner's or Admin's Stop of a live task, asked in its row; absent for anyone else. */
  readonly stop?:
    | {
        readonly pressOf: (taskId: string) => RowPress;
        readonly onAsk: (taskId: string) => void;
        readonly onKeep: () => void;
        readonly onStop: (taskId: string) => void;
      }
    | undefined;
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
  update = false,
}: {
  /** The task board; absent, none is drawn. */
  readonly board?: BoardView | undefined;
  /** HQ predates automated Mates: the section keeps its place, saying HQ needs updating. */
  readonly update?: boolean;
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
    <section aria-label="Automation" className="pa" data-zerops-surface="project-automation">
      {update ? (
        <div className="pa-body">
          <p className="pa-words">{hqNeedsUpdate("set up automated Mates")}</p>
        </div>
      ) : (
        <AutomationBody
          admin={admin}
          board={board}
          onOpenMate={onOpenMate}
          pool={pool}
          sources={sources}
          workingOf={workingOf}
        />
      )}
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
}: Omit<Parameters<typeof ProjectAutomationView>[0], "update">) {
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
      <div className="pa-head" data-zerops-surface="project-automation-pool">
        {pool.length === 0 ? null : (
          <span className="pa-faces">
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
        <span className="pa-head-words text-sm">{poolSummary(pool, held)}</span>
        {admin?.onAddMate === undefined ? null : (
          <span className="pa-head-add">
            <Button aria-label="Add a Mate" onClick={admin.onAddMate} size="sm" variant="link">
              <span>
                + Add<span className="pa-wide">&nbsp;a Mate</span>
              </span>
            </Button>
          </span>
        )}
        {/* The organization's money, in a project's section: it says whose it is. */}
        {board?.spend == null ? null : (
          <span className="pa-spend">
            <span className="pa-wide">All automated Mates · </span>
            {board.spend}
          </span>
        )}
      </div>
      <GrowsInPlace>
        <div className="pa-body">
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
    <div className="pa-group" data-zerops-board={name}>
      <SectionLabel action={action} count={count} level={3}>
        {name}
      </SectionLabel>
      {children}
    </div>
  );
}

function Placeholders({ count }: { readonly count: number }) {
  return (
    <ul aria-hidden="true" className="pa-rows">
      {Array.from({ length: count }, (_, at) => (
        <li className="ov-change-row pa-row" key={at}>
          <div className="ov-change" data-plain="">
            <Skeleton className="col-span-full h-3.5" surface="card" />
          </div>
        </li>
      ))}
    </ul>
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
      <div className="ov-change" data-plain="">
        {children}
      </div>
    );
  return (
    <a
      className="ov-change"
      href={route}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onOpen(route);
      }}
    >
      {children}
    </a>
  );
}

const RESTS: RowPress = { kind: "idle" };

/**
 * A live task's Stop, for an Owner or Admin: in its row's seat while the row is pointed at or
 * focused (always where nothing hovers); pressed, it asks in the row, over its facts, so no column
 * moves. The press moves with it: to *Keep* as it asks, back to *Stop* once kept.
 */
function TaskStop({
  board,
  taskId,
  question,
}: {
  readonly board: BoardView;
  readonly taskId: string;
  readonly question: string;
}) {
  const asking = (board.stop?.pressOf(taskId) ?? RESTS).kind === "asking";
  const pressed = useRef(false);
  const keep = useRef<HTMLButtonElement | null>(null);
  const stop = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!pressed.current) return;
    if (asking) keep.current?.focus();
    else {
      pressed.current = false;
      stop.current?.focus();
    }
  }, [asking]);
  if (board.stop === undefined) return null;
  if (asking)
    return (
      <span className="pa-ask">
        <span className="pa-ask-words">{question}</span>
        <Button onClick={board.stop.onKeep} ref={keep} size="sm" variant="ghost">
          Keep
        </Button>
        <Button
          onClick={() => {
            pressed.current = false;
            board.stop?.onStop(taskId);
          }}
          size="sm"
          variant="destructive"
        >
          Stop
        </Button>
      </span>
    );
  return (
    <span className="pa-stop">
      <Button
        onClick={() => {
          pressed.current = true;
          board.stop?.onAsk(taskId);
        }}
        ref={stop}
        size="sm"
        variant="ghost"
      >
        Stop
      </Button>
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
    <span className="pa-text">
      <CutText className="ov-change-title" text={title} />
      {why == null ? null : (
        <span
          className="pa-why"
          data-tone={failed ? "failed" : undefined}
          role={failed ? "alert" : undefined}
        >
          {why}
        </span>
      )}
    </span>
  );
}

/** "Sol · 12m": whose, and how long or when; either alone where the other is not known. */
const whoWords = (mate: string | null, time: string): string =>
  [mate, time === "—" ? null : time].filter((part) => part !== null).join(" · ");

/**
 * A task slides to its new place when it changes group: each row's place in the ledger is read
 * after every render, and one that stood elsewhere eases from there. A row that arrives is placed.
 * Reduced motion cuts.
 */
function useSlidingRows() {
  const ledger = useRef<HTMLDivElement | null>(null);
  const stood = useRef<ReadonlyMap<string, number>>(new Map());
  useLayoutEffect(() => {
    const node = ledger.current;
    if (node === null) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

export function TaskBoardView({
  board,
  pool,
  waitsFor,
  all,
  onAll,
}: {
  readonly board: BoardView;
  readonly pool: ReadonlyArray<PoolMate>;
  /** Whether Finished shows every task that ended, or its first few; and the press that says. */
  readonly all: boolean;
  readonly onAll: (all: boolean) => void;
  /**
   * The pool's Mates by name, where the project takes tasks from nowhere yet: a board with no
   * task says what they wait for.
   */
  readonly waitsFor?: ReadonlyArray<string> | undefined;
}) {
  const { read } = board;
  const ledger = useSlidingRows();
  if (read.state === "none") return null;
  if (read.state === "failed")
    return (
      <div className="pa-line">
        <span className="pa-line-words" role="alert">
          {read.words}
        </span>
        <Button onClick={board.onReadAgain} size="sm" variant="ghost">
          Try again
        </Button>
      </div>
    );
  if (read.state === "reading") {
    const { atWork, queued, recent, recentMore } = read.predicted;
    if (atWork + queued + recent === 0) return null;
    return (
      <div className="pa-ledger" data-zerops-surface="project-automation-board">
        {atWork === 0 ? null : (
          <LedgerGroup name="At work">
            <Placeholders count={atWork} />
          </LedgerGroup>
        )}
        {queued === 0 ? null : (
          <LedgerGroup name="Queued">
            <Placeholders count={queued} />
          </LedgerGroup>
        )}
        {recent === 0 ? null : (
          <LedgerGroup name="Finished">
            <Placeholders count={recent} />
            {recentMore === true ? <div aria-hidden="true" className="pa-more" /> : null}
          </LedgerGroup>
        )}
      </div>
    );
  }
  const { atWork, queued, recent } = read.board;
  if (atWork.length + queued.length + recent.length === 0)
    return waitsFor === undefined ? null : (
      <p className="pa-words">
        No tasks yet. {waitsFor.length === 1 ? `${waitsFor[0] ?? "It"} takes` : "They take"} one as
        soon as there is somewhere to take it from.
      </p>
    );
  const faces = new Map(pool.map((mate) => [mate.projectId, mate]));
  const finished = all ? recent : recent.slice(0, RECENT_SHOWN);
  return (
    <div className="pa-ledger" data-zerops-surface="project-automation-board" ref={ledger}>
      {atWork.length === 0 ? null : (
        <LedgerGroup count={atWork.length} name="At work">
          <ul className="pa-rows">
            {atWork.map((row) => {
              const mate = row.mate === null ? undefined : faces.get(row.mate.projectId);
              const name = mate?.name ?? row.mate?.name ?? null;
              const press = board.stop?.pressOf(row.id) ?? RESTS;
              // HQ has its stop, or takes it now: the row says so and offers nothing more.
              const stopping = row.status === "stopping" || press.kind === "working";
              const asks = row.status === "waiting" && !stopping;
              const words = atWorkWords(stopping ? "stopping" : row.status);
              // A task that asks holds its seat for Answer; its conversation keeps its Stop.
              const stoppable = board.stop !== undefined && !stopping && !asks;
              return (
                <li
                  className="ov-change-row pa-row"
                  data-asking={press.kind === "asking" ? "" : undefined}
                  data-stop={stoppable ? "" : undefined}
                  data-zerops-task={row.id}
                  key={row.id}
                >
                  <RowPress onOpen={board.onOpen} route={row.route}>
                    <span className="pa-lead">
                      {mate === undefined ? null : (
                        <MateFace
                          shape={mate.shape}
                          size={20}
                          state={asks ? "needs" : stopping ? "idle" : "working"}
                          tint={mate.tint}
                        />
                      )}
                    </span>
                    <RowText
                      failed
                      title={row.title}
                      why={press.kind === "refused" ? press.words : null}
                    />
                    <span className="pa-facts">
                      {words === null ? null : (
                        <span className="pa-state" data-tone={asks ? "attention" : undefined}>
                          {words}
                        </span>
                      )}
                      <span className="pa-who">
                        {name}
                        {name === null || row.worked === "—" ? null : " · "}
                        {row.worked === "—" ? null : (
                          <>
                            <span className="sr-only">worked </span>
                            {row.worked}
                          </>
                        )}
                      </span>
                      <span className="pa-cost">{row.cost}</span>
                    </span>
                    <span className="pa-act">
                      {row.route === null || stopping ? null : asks ? (
                        <span className="ov-review">Answer</span>
                      ) : (
                        <ChevronRightIcon aria-hidden="true" className="ov-go" />
                      )}
                    </span>
                  </RowPress>
                  {stoppable ? (
                    <TaskStop
                      board={board}
                      question={`Stop this task? ${name ?? "Its Mate"} stops where it got to.`}
                      taskId={row.id}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </LedgerGroup>
      )}
      {queued.length === 0 ? null : (
        <LedgerGroup count={queued.length} name="Queued">
          <ul className="pa-rows">
            {queued.map((row) => {
              const press = board.stop?.pressOf(row.id) ?? RESTS;
              const stopping = press.kind === "working";
              const stoppable = board.stop !== undefined && !stopping;
              return (
                <li
                  className="ov-change-row pa-row"
                  data-asking={press.kind === "asking" ? "" : undefined}
                  data-stop={stoppable ? "" : undefined}
                  data-zerops-task={row.id}
                  key={row.id}
                >
                  <div className="ov-change" data-plain="">
                    {/* Its place stands where a face will. */}
                    <span className="pa-lead pa-place">{row.position}</span>
                    <RowText
                      failed
                      title={row.title}
                      why={press.kind === "refused" ? press.words : null}
                    />
                    <span className="pa-facts">
                      {stopping ? (
                        <span className="pa-state">{atWorkWords("stopping")}</span>
                      ) : row.url === null ? (
                        <span className="pa-state">{row.source}</span>
                      ) : (
                        <a
                          className="pa-state pa-from"
                          href={row.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <span className="real-name">{row.source}</span>
                          <ArrowUpRightIcon aria-hidden="true" className="pa-out" />
                        </a>
                      )}
                      <span className="pa-who">
                        <span className="sr-only">Waited </span>
                        {row.waited}
                      </span>
                    </span>
                    <span className="pa-act" />
                  </div>
                  {stoppable ? (
                    <TaskStop
                      board={board}
                      question="Stop this task? No Mate has taken it yet."
                      taskId={row.id}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </LedgerGroup>
      )}
      {recent.length === 0 ? null : (
        <LedgerGroup count={recent.length} name="Finished">
          <ul className="pa-rows">
            {finished.map((row) => {
              const mate = row.mateId === null ? undefined : faces.get(row.mateId);
              const review = row.outcome === "review" ? row.change : null;
              return (
                <li className="ov-change-row pa-row" data-zerops-task={row.id} key={row.id}>
                  <RowPress onOpen={board.onOpen} route={row.route}>
                    <span className="pa-lead">
                      <i
                        aria-hidden="true"
                        className="ln-bead ov-change-bead"
                        data-tint={mate?.tint}
                      />
                    </span>
                    <RowText failed={row.outcome === "failed"} title={row.title} why={row.detail} />
                    <span className="pa-facts">
                      <span
                        className="pa-state"
                        data-tone={
                          row.outcome === "failed"
                            ? "failed"
                            : row.outcome === "review"
                              ? "attention"
                              : undefined
                        }
                      >
                        {TASK_STATUS_WORDS[row.outcome]}
                      </span>
                      <span className="pa-who">
                        {row.when === "—" ? null : <span className="sr-only">Ended </span>}
                        {whoWords(row.mate, row.when)}
                      </span>
                      <span className="pa-cost">{row.cost}</span>
                    </span>
                    <span className="pa-act">
                      {row.route === null || review !== null ? null : (
                        <ChevronRightIcon aria-hidden="true" className="ov-go" />
                      )}
                    </span>
                  </RowPress>
                  {/* Its pull request on GitHub, where it has one. */}
                  {row.change?.external === true ? (
                    <a className="pa-pr" href={row.change.href} rel="noreferrer" target="_blank">
                      {row.change.label}
                      <ArrowUpRightIcon aria-hidden="true" className="pa-out" />
                    </a>
                  ) : null}
                  {/* The Changes card's Review: it opens the change, the row its conversation. */}
                  {review === null ? null : review.external ? (
                    <a
                      className="ov-review pa-verb"
                      href={review.href}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Review
                    </a>
                  ) : (
                    <a
                      className="ov-review pa-verb"
                      href={review.href}
                      onClick={(event) => {
                        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0)
                          return;
                        event.preventDefault();
                        board.onOpen(review.href);
                      }}
                    >
                      Review
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
          {recent.length > RECENT_SHOWN ? (
            <div className="pa-more">
              <SectionAction
                onClick={() => {
                  onAll(!all);
                }}
              >
                {all ? "Show fewer" : `+ ${String(recent.length - RECENT_SHOWN)} more`}
              </SectionAction>
            </div>
          ) : null}
        </LedgerGroup>
      )}
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
    <div className="pa-ledger pa-sources" data-zerops-surface="project-automation-sources">
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
          <ul className="pa-rows">
            {rows.map((row) => (
              <SourceRowView admin={admin} key={row.key} row={row} />
            ))}
          </ul>
        ) : sources.reading ? (
          <div className="pa-wait">
            <WaitLine text="Reading…" />
          </div>
        ) : admin === undefined ? null : (
          <div className="pa-kinds">
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
        {sources.withheld ? <p className="pa-note">Owners and admins see every source.</p> : null}
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
      <span className="pa-lead">
        <SourceMark kind={failed ? row.source : row.kind} />
      </span>
      <span className="pa-text">
        <span
          className="ov-change-title"
          data-tone={failed ? "failed" : undefined}
          role={failed ? "alert" : undefined}
        >
          {row.title}
          {row.kind === "github" ? (
            <>
              {" "}
              <span className="real-name">{row.label}</span>
            </>
          ) : null}
        </span>
      </span>
      <span className="pa-facts">
        {disconnected ? (
          <span className="pa-state" data-tone="attention">
            Not connected
          </span>
        ) : null}
        {row.detail === null && row.meta === null ? null : (
          <span className="pa-who">
            {row.kind === "github" ? <span className="real-name">{row.detail}</span> : row.detail}
            {row.detail === null || row.meta === null ? null : " · "}
            {row.meta}
          </span>
        )}
      </span>
      <span className="pa-act">
        {admin === undefined || failed || disconnected ? null : (
          <ChevronRightIcon aria-hidden="true" className="ov-go" />
        )}
      </span>
    </>
  );
  return (
    <li className="ov-change-row pa-row" data-zerops-source={row.kind}>
      {admin === undefined ? (
        <div className="ov-change" data-plain="">
          {cells}
        </div>
      ) : (
        <button
          className="ov-change"
          onClick={() => {
            admin.onEdit(row);
          }}
          type="button"
        >
          {cells}
        </button>
      )}
      {admin === undefined ? null : failed ? (
        <span className="pa-verb">
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
        <button className="ov-review pa-verb" onClick={admin.onOpenSettings} type="button">
          Connect
        </button>
      ) : null}
    </li>
  );
}
