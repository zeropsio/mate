/**
 * A project's Automation section, on its page's column: the pool of its automated Mates as one
 * line (their faces and names, *Add*, and the organization's spend this month against its
 * budget); its task board — what they are on (at work), what waits by its place (each with Stop
 * for an Owner or Admin), and what ended — read from HQ, and read again by the data layer as HQ's
 * navigation says their tasks moved (`hqTaskBoardRefresh`); then the sources
 * its tasks come from — GitHub issues by label, a Slack or Discord channel, webhooks, schedules —
 * one row each with its own Edit and Stop, and *Take tasks from…* to add one. Configured where the
 * project is: Settings keeps only what is the organization's (its key, its GitHub app, its Slack
 * and Discord, its limits and budget).
 *
 * An Owner or Admin sets it up here; anyone else reads the pool, the board and the GitHub source,
 * and sees the section only once it holds something.
 */
import type { MateMarkState, MateShapeId, MateTintId } from "@t3tools/shared/brand";
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
import { ArrowUpRightIcon, ChevronDownIcon, PlusIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { automatedKeyState } from "~/zerops/automatedMate.logic";
import { useAppIntake, useAutomatedKey, useOrgAiKeys } from "~/zerops/useAutomationSettings";
import {
  useAppTaskSource,
  useAppTaskStops,
  useGithubApp,
  useOrgTaskSource,
} from "~/zerops/useTaskSourceSettings";
import { TASK_STATUS_WORDS, taskStatusDot, type TaskStatus } from "~/zerops/taskStatus";
import { useNewMateDialog } from "~/zerops/newMate";
import { useAddMateOffer } from "~/zerops/useHqOffers";
import { useOpenMate } from "~/zerops/useOpenMate";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { mateActivityAtom } from "~/zerops/mateActivityAtoms";
import { hqMateVersionsAtom } from "~/state/zerops";
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
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../../ui/menu";
import { Skeleton } from "../../ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { intakeRepoChoices } from "../../settings/automatedMatesSettings.logic";
import { MateFace } from "../primitives";
import { CardGroupName, ProjectPageCard } from "../projects/ProjectPageCard";
import { capped } from "../projects/projectPage.logic";
import { changesInReview, mateAutomation, type MateAutomationLine } from "../SidebarMateRow.logic";
import {
  automationSection,
  connectionMissing,
  poolMateLine,
  SOURCE_KINDS,
  sourceRowPress,
  sourceRows,
  stopWords,
  type RowPress,
  type SourceKind,
  type SourceRow,
} from "./projectAutomation.logic";
import { AppChannelView, AppIntakeView, AppSchedulesView, AppWebhooksView } from "./sourceForms";
import {
  boardOf,
  heldOnItsChange,
  poolLine,
  predictedBoard,
  sourceGlyph,
  spendGauge,
  spendLine,
  takesLine,
  type Board,
  type SpendGauge,
  type BlockedMate,
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
  look = "card",
}: {
  /** A card of its own, or the automated half of the page's Mates (`ProjectAutomationView`). */
  readonly look?: "card" | "part";
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
        look={look}
        onOpenMate={onOpenMate}
        pool={pool}
        sources={{ rows, reading: intake.read.intake === undefined, withheld }}
      />
    );
  }
  if (automationSection({ admin, key, pool: 0, sources: 0 }) === "update")
    return (
      <ProjectAutomationView
        look={look}
        onOpenMate={onOpenMate}
        pool={[]}
        sources={{ rows: [], reading: false, withheld: false }}
        update
      />
    );
  return (
    <AdminAutomation
      look={look}
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

/** How many rows each block will hold while the board reads (`predictedBoard`). */
interface Predicted {
  readonly atWork: number;
  readonly queued: number;
  readonly recent: number;
  /** The line saying how many more ended earlier. */
  readonly recentMore?: boolean | undefined;
}

/**
 * How Recent last landed, per application, while this page lives: navigation names only each
 * Mate's latest task, so the next read's placeholders take Recent's size from the last answer.
 */
const landed = new Map<string, { readonly recent: number; readonly recentMore: boolean }>();

/**
 * The application's task board: HQ's tasks of it, read while the section is drawn (and again by
 * the data layer as navigation says its tasks moved), live rows moving with navigation; the
 * organization's spend this month; and an Owner's or Admin's Stop of a task, asked on its row,
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
    landed.set(groupId, { recent: made.recent.length, recentMore: made.recentMore > 0 });
    return made;
  }, [held, nowMs, groupId, live, versions]);
  const stoppable = board === null ? [] : [...board.atWork, ...board.queued].map((row) => row.id);
  const stops = useAppTaskStops(groupId, stoppable);
  return {
    read:
      board !== null
        ? { state: "known", board }
        : setting.state === "failed"
          ? { state: "failed", words: setting.words }
          : setting.state === "withheld" || setting.state === "unsupported"
            ? { state: "none" }
            : { state: "reading", predicted: { ...predicted, ...landed.get(groupId) } },
    spend: limits.read.setting.state === "known" ? spendLine(limits.read.setting.held) : null,
    gauge:
      limits.read.setting.state === "known" ? spendGauge(limits.read.setting.held, nowMs) : null,
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
  look,
}: {
  readonly look: "card" | "part";
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
  const githubApp =
    github.read.setting.state === "known" && github.read.setting.held.state === "connected"
      ? github.read.setting.held.slug
      : undefined;
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
  // The row whose Stop asks now, and the one whose Stop was confirmed last.
  const [asking, setAsking] = useState<string | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const actionOf = (row: SourceRow) =>
    row.kind === "github"
      ? intake.read.action
      : row.kind === "slack"
        ? slack.read.action
        : row.kind === "discord"
          ? discord.read.action
          : row.kind === "schedule"
            ? schedules.read.action
            : { kind: "idle" as const };
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
        look={look}
        admin={{
          onAddMate: addMate,
          onTakeFrom: setOpen,
          onEdit: (row) => {
            setAsking(null);
            setPressed(null);
            setOpen(row.kind === "failed" ? row.source : row.kind);
          },
          onAskStop: (row) => {
            setAsking(row.key);
          },
          onKeep: () => {
            setAsking(null);
          },
          pressOf: (row) =>
            sourceRowPress({ key: row.key, asking, pressed, action: actionOf(row) }),
          onStop: (row) => {
            setAsking(null);
            setPressed(row.key);
            if (row.kind === "github") intake.stop();
            else if (row.kind === "slack") slack.write({ kind: "channel-stop", source: "slack" });
            else if (row.kind === "discord")
              discord.write({ kind: "channel-stop", source: "discord" });
            else if (row.kind === "schedule")
              schedules.write({ kind: "schedule-delete", scheduleId: row.id });
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

/** A pool Mate's face in its line: awake while it works, asking while its task waits on a person. */
function PoolFace({
  mate,
  onOpen,
}: {
  readonly mate: PoolMate;
  readonly onOpen: (projectId: string) => void;
}) {
  const activity = useAtomValue(mateActivityAtom(mate.projectId));
  return <PoolFaceView mate={mate} onOpen={onOpen} working={activity?.kind === "working"} />;
}

/** Its face opens it; its name and what it is on are its tooltip. */
export function PoolFaceView({
  mate,
  working,
  onOpen,
}: {
  readonly mate: PoolMate;
  readonly working: boolean;
  readonly onOpen: (projectId: string) => void;
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
      <MateFace shape={mate.shape} size={20} state={poolMateFace(mate, working)} tint={mate.tint} />
    </button>
  );
}

/** What an Owner or Admin may do in the section; absent for anyone else, who reads it. */
export interface AutomationControls {
  readonly onAddMate: (() => void) | undefined;
  readonly onTakeFrom: (kind: SourceKind) => void;
  readonly onEdit: (row: SourceRow) => void;
  /** Stop (or a schedule's Remove), pressed: the row asks before anything stops. */
  readonly onAskStop: (row: SourceRow) => void;
  /** *Keep*, answered on a row that asks. */
  readonly onKeep: () => void;
  /** Stop, confirmed on its row. */
  readonly onStop: (row: SourceRow) => void;
  /** Where a row's Stop stands (`sourceRowPress`). */
  readonly pressOf: (row: SourceRow) => RowPress;
  readonly onReadAgain: (source: Exclude<SourceKind, "github">) => void;
  readonly onOpenSettings: () => void;
}

/**
 * The task board as the section draws it: what HQ answered, or how its read stands (`reading`,
 * with how many rows navigation says each block will hold, so the board keeps its height when they
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
  /** That spend as a share of its budget, for the card's thin line (`spendGauge`); none unknown. */
  readonly gauge?: SpendGauge | null | undefined;
  readonly onReadAgain: () => void;
  /** Opens a task's conversation or its change, by its in-app path. */
  readonly onOpen: (route: string) => void;
  /** An Owner's or Admin's Stop of a live task, asked on its row; absent for anyone else. */
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
 */
export function ProjectAutomationView({
  pool,
  sources,
  admin,
  board,
  onOpenMate,
  workingOf,
  update = false,
  look = "card",
}: {
  /**
   * `card`: a card of its own. `part`: the automated half of the project page's Mates — its name
   * a small heading under the people's Mates, its board capped with *Show all*; nothing at all
   * while it holds nothing (the project's ··· adds automated Mates).
   */
  readonly look?: "card" | "part";
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
  // The month's spend against its budget heads the card: its words beside the name, its share as
  // one thin line under them.
  const live = !update && pool.length > 0;
  const gauge = live ? (board?.gauge ?? null) : null;
  const spend = live ? (board?.spend ?? null) : null;
  // The month's budget spent: HQ hands out no task until the next month or a higher budget. A
  // card says so with its way out; the page's part leaves both to what needs the person above
  // (`ProjectBudgetNeed`), its line alone turning.
  const spent = look === "card" && gauge !== null && gauge.share >= 1;
  const end = !live ? undefined : (
    <>
      {spend === null || spent ? null : (
        <span className="text-caption text-muted-foreground tabular-nums">
          {gauge?.words ?? spend}
        </span>
      )}
      {!spent || admin === undefined ? null : (
        <Button onClick={admin.onOpenSettings} size="sm" variant="secondary">
          Raise the budget
        </Button>
      )}
      {spent || admin?.onAddMate === undefined ? null : (
        <Button
          aria-label="Add an automated Mate"
          onClick={admin.onAddMate}
          size="sm"
          variant="ghost"
        >
          Add
        </Button>
      )}
    </>
  );
  const meter =
    gauge === null ? null : (
      <>
        <div
          aria-hidden="true"
          className="pp-cards-gauge"
          data-tone={gauge.share >= 1 ? "attention" : undefined}
        >
          <span style={{ width: `${String(Math.round(gauge.share * 1000) / 10)}%` }} />
        </div>
        {spent ? (
          <p className="text-line text-status-attention-text" role="status">
            {spentWords(gauge.words)}
          </p>
        ) : null}
      </>
    );
  if (look === "part") {
    if (!update && pool.length === 0 && sources.rows.length === 0 && !sources.reading) return null;
    return (
      <section
        aria-label="Automation"
        className="pp-team-part"
        data-zerops-surface="project-automation"
      >
        <header className="pp-team-part-head">
          <CardGroupName>Automated</CardGroupName>
          {end === undefined ? null : <div className="pp-team-part-end">{end}</div>}
        </header>
        {meter}
        {update ? (
          <p className="pp-cards-empty">Update HQ to set up automated Mates.</p>
        ) : (
          <div className="-mx-2 grid gap-4 text-line">
            <AutomationBody
              admin={admin}
              board={board}
              cap={BOARD_ROWS_SHOWN}
              onOpenMate={onOpenMate}
              pool={pool}
              sources={sources}
              workingOf={workingOf}
            />
          </div>
        )}
      </section>
    );
  }
  return (
    <ProjectPageCard end={end} surface="project-automation" title="Automation">
      {meter}
      {update ? (
        <p className="pp-cards-empty">Update HQ to set up automated Mates.</p>
      ) : (
        <div className="-mx-2 grid gap-4 text-line">
          <AutomationBody
            admin={admin}
            board={board}
            onOpenMate={onOpenMate}
            pool={pool}
            sources={sources}
            workingOf={workingOf}
          />
        </div>
      )}
    </ProjectPageCard>
  );
}

/**
 * The month's automation budget spent, as the project page asks about it among what needs the
 * person: what it means, and — for an Owner or Admin — its one way out. Nothing while it is not.
 */
export function BudgetNeedView({
  gauge,
  onRaise,
}: {
  readonly gauge: SpendGauge | null;
  /** Opens Settings › Automation, where the budget is; absent for anyone who may not change it. */
  readonly onRaise?: (() => void) | undefined;
}) {
  if (gauge === null || gauge.share < 1) return null;
  return (
    <li className="pp-need" data-zerops-need="budget">
      <span className="pp-need-mark">
        <i aria-hidden="true" className="ov-dot" data-dot="failed" />
      </span>
      <span className="pp-need-name">Automation</span>
      <p className="pp-need-words text-status-attention-text">{spentWords(gauge.words)}</p>
      {onRaise === undefined ? null : (
        <span className="pp-need-act">
          <Button onClick={onRaise} size="sm" variant="secondary">
            Raise the budget
          </Button>
        </span>
      )}
    </li>
  );
}

/** The organization's automation budget, spent, on the page of a project with automated Mates. */
export function ProjectBudgetNeed({ groupId }: { readonly groupId: string }) {
  const { activeOrganization } = useZeropsSession();
  const admin = roleAtLeast(activeOrganization?.roleCode, "ADMIN");
  const { pool } = usePool(groupId);
  const limits = useOrgTaskSource("hqTaskLimits", pool.length > 0);
  const nowMs = useNowMs();
  const navigate = useNavigate();
  if (pool.length === 0 || limits.read.setting.state !== "known") return null;
  return (
    <BudgetNeedView
      gauge={spendGauge(limits.read.setting.held, nowMs)}
      onRaise={
        admin
          ? () => {
              void navigate({ to: AUTOMATION_SETTINGS });
            }
          : undefined
      }
    />
  );
}

/**
 * The month's budget spent, in words: "$47.00 of $47 · October" → "October's $47 is spent: tasks
 * wait for a higher budget or the next month."
 */
function spentWords(gauge: string): string {
  const [, cap, month] = /of (\S+) · (\S+)$/u.exec(gauge) ?? [];
  return cap === undefined || month === undefined
    ? "This month's budget is spent: tasks wait for a higher budget or the next month."
    : `${month}’s ${cap} is spent: tasks wait for a higher budget or the next month.`;
}

/** *Take tasks from…*: each kind of source, opening its form. */
function TakeTasksFrom({ admin }: { readonly admin: AutomationControls }) {
  return (
    <Menu>
      <MenuTrigger render={<Button size="sm" variant="secondary" />}>
        Take tasks from…
        <ChevronDownIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="start">
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
  );
}

/** A source wants a look: its read failed, its chat is not connected, or a Stop is under way. */
function sourceNeedsLook(row: SourceRow, admin: AutomationControls | undefined): boolean {
  if (row.kind === "failed") return true;
  if ((row.kind === "slack" || row.kind === "discord") && row.disconnected) return true;
  return admin !== undefined && admin.pressOf(row).kind !== "idle";
}

function AutomationBody({
  pool,
  sources,
  admin,
  board,
  onOpenMate,
  workingOf,
  cap,
}: Omit<Parameters<typeof ProjectAutomationView>[0], "update" | "look"> & {
  /** How many rows Queued and Recent list before *Show all*; every row where absent. */
  readonly cap?: number | undefined;
}) {
  const [managing, setManaging] = useState(false);
  const names = pool.map((mate) => mate.name);
  const look = sources.rows.some((row) => sourceNeedsLook(row, admin));
  // Each source's own Edit, Stop and Connect: under the line while the person manages them, or
  // while one of them wants a look.
  const rowsOpen = admin !== undefined && sources.rows.length > 0 && (managing || look);
  return (
    <>
      {pool.length > 0 ? null : (
        <div className="grid justify-items-start gap-2 px-2">
          <p className="text-line text-muted-foreground">
            No automated Mates yet. Each takes the tasks you point it at and opens a change for
            each.
          </p>
          {admin?.onAddMate === undefined ? null : (
            <Button onClick={admin.onAddMate} size="sm" variant="secondary">
              <PlusIcon aria-hidden="true" />
              Add an automated Mate
            </Button>
          )}
        </div>
      )}
      <div
        className="flex min-h-7 min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 px-2"
        data-zerops-surface="project-automation-pool"
      >
        {pool.length === 0 ? null : (
          <span aria-label={poolLine(names)} className="flex shrink-0 items-center" role="group">
            {pool.map((mate) =>
              workingOf === undefined ? (
                <PoolFace key={mate.projectId} mate={mate} onOpen={onOpenMate} />
              ) : (
                <PoolFaceView
                  key={mate.projectId}
                  mate={mate}
                  onOpen={onOpenMate}
                  working={workingOf(mate.projectId)}
                />
              ),
            )}
          </span>
        )}
        <span className="text-line text-foreground">{takesLine(names)}</span>
        {sources.rows.length > 0 ? (
          sources.rows.map((row) =>
            admin === undefined || row.kind === "failed" ? (
              <span
                className="pp-cards-chip"
                data-tone={sourceNeedsLook(row, admin) ? "attention" : undefined}
                key={row.key}
              >
                {row.words}
              </span>
            ) : (
              <button
                className="pp-cards-chip"
                data-tone={sourceNeedsLook(row, admin) ? "attention" : undefined}
                key={row.key}
                onClick={() => {
                  admin.onEdit(row);
                }}
                type="button"
              >
                {row.words}
              </button>
            ),
          )
        ) : sources.reading ? (
          <span className="text-muted-foreground">Reading…</span>
        ) : sources.withheld ? null : (
          <span className="text-muted-foreground">nowhere yet.</span>
        )}
        {admin === undefined ? null : sources.rows.length === 0 ? (
          <TakeTasksFrom admin={admin} />
        ) : look ? null : (
          <Button
            onClick={() => {
              setManaging((was) => !was);
            }}
            size="sm"
            variant="ghost"
          >
            {managing ? "Done" : "Edit"}
          </Button>
        )}
      </div>
      {sources.withheld ? (
        <p className="px-2 text-caption text-muted-foreground">
          Owners and admins see every source.
        </p>
      ) : null}
      {!rowsOpen || admin === undefined ? null : (
        <div className="grid gap-1">
          <ul className="grid" data-zerops-surface="project-automation-sources">
            {sources.rows.map((row) => (
              <SourceRowView admin={admin} key={row.key} row={row} />
            ))}
          </ul>
          <div className="px-2">
            <TakeTasksFrom admin={admin} />
          </div>
        </div>
      )}
      {board === undefined || board.read.state === "none" ? null : (
        <TaskBoardView board={board} cap={cap} pool={pool} />
      )}
    </>
  );
}

function StatusWord({ status, why }: { readonly status: TaskStatus; readonly why?: string }) {
  const word = (
    <>
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${taskStatusDot(status)}`}
      />
      <span className="truncate">{TASK_STATUS_WORDS[status]}</span>
    </>
  );
  if (why === undefined) return <span className="flex min-w-0 items-center gap-1.5">{word}</span>;
  // Why it failed or stopped, on hover or focus.
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex min-w-0 items-center gap-1.5" tabIndex={0} />}>
        {word}
      </TooltipTrigger>
      <TooltipPopup>{why}</TooltipPopup>
    </Tooltip>
  );
}

/** A row's title, opening its conversation where it has one. */
function TaskTitle({
  title,
  route,
  onOpen,
}: {
  readonly title: string;
  readonly route: string | null;
  readonly onOpen: (route: string) => void;
}) {
  if (route === null) return <span className="min-w-0 flex-1 truncate">{title}</span>;
  return (
    <a
      className="min-w-0 flex-1 truncate text-foreground underline-offset-2 hover:underline"
      href={route}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        onOpen(route);
      }}
    >
      {title}
    </a>
  );
}

/** A block of the board: its heading, then its rows, its placeholders at their size, or its words. */
function BoardBlock({
  name,
  count,
  children,
}: {
  readonly name: string;
  readonly count?: number | undefined;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid content-start gap-0.5" data-zerops-board={name}>
      <h3 className="pp-cards-group-name flex h-6 items-center gap-1.5 px-2">
        {name}
        {count === undefined || count === 0 ? null : (
          <span className="tabular-nums">· {count}</span>
        )}
      </h3>
      {children}
    </div>
  );
}

const ROW = "flex h-8 min-w-0 items-center gap-3 px-2 text-line";
const NUMBER = "shrink-0 text-end text-muted-foreground tabular-nums";

function Placeholders({ count }: { readonly count: number }) {
  return (
    <ul aria-hidden="true" className="grid">
      {Array.from({ length: count }, (_, at) => (
        <li className={ROW} key={at}>
          <Skeleton className="h-3.5 flex-1" />
        </li>
      ))}
    </ul>
  );
}

/**
 * A live task's Stop on its row, for an Owner or Admin: it asks under the row first, then says it
 * stops while HQ answers, and HQ's refusal there. None while the task is stopping already.
 */
function TaskStop({
  board,
  taskId,
  status,
}: {
  readonly board: BoardView;
  readonly taskId: string;
  readonly status: TaskStatus;
}) {
  const press = board.stop?.pressOf(taskId) ?? { kind: "idle" as const };
  if (board.stop === undefined || status === "stopping" || press.kind === "asking") return null;
  return (
    <Button
      disabled={press.kind === "working"}
      onClick={() => {
        board.stop?.onAsk(taskId);
      }}
      size="sm"
      variant="ghost"
    >
      {press.kind === "working" ? "Stopping…" : "Stop"}
    </Button>
  );
}

/** What a live task's Stop says under its row: the ask, or HQ's refusal. */
function TaskStopAsk({ board, taskId }: { readonly board: BoardView; readonly taskId: string }) {
  const press = board.stop?.pressOf(taskId) ?? { kind: "idle" as const };
  if (press.kind === "asking")
    return (
      <div className="flex h-8 items-center justify-end gap-1 px-2">
        <span className="text-xs text-muted-foreground">
          Stop this task? Its Mate stops where it got to.
        </span>
        <Button onClick={board.stop?.onKeep} size="sm" variant="ghost">
          Keep
        </Button>
        <Button
          onClick={() => {
            board.stop?.onStop(taskId);
          }}
          size="sm"
          variant="destructive"
        >
          Stop
        </Button>
      </div>
    );
  if (press.kind === "refused")
    return (
      <p className="px-2 text-xs text-destructive-foreground" role="alert">
        {press.words}
      </p>
    );
  return null;
}

/** "Juno waits for change #3 to be merged or closed.", the change linked. */
function BlockedLine({
  mate,
  blocked,
  onOpen,
}: {
  readonly mate: string;
  readonly blocked: BlockedMate;
  readonly onOpen: (route: string) => void;
}) {
  const label = blocked.change.label.replace(/^Change/u, "change");
  return (
    <p
      className="flex h-8 min-w-0 items-center gap-1 px-2 text-line text-muted-foreground"
      data-zerops-board-line="blocked"
    >
      <span className="truncate">
        {mate} waits for{" "}
        {blocked.change.external ? (
          <a
            className="text-info-foreground underline-offset-2 hover:underline"
            href={blocked.change.href}
            rel="noreferrer"
            target="_blank"
          >
            {label}
          </a>
        ) : (
          <a
            className="text-info-foreground underline-offset-2 hover:underline"
            href={blocked.change.href}
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.button !== 0) return;
              event.preventDefault();
              onOpen(blocked.change.href);
            }}
          >
            {label}
          </a>
        )}{" "}
        to be merged or closed.
      </span>
    </p>
  );
}

/** "Juno waits for a task." / "Raya and Ines wait for a task." */
function idleWords(names: ReadonlyArray<string>): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]!} waits for a task.`;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)!} wait for a task.`;
}

/** "Raya waits for a task · 2 changes in review.": free, its changes in its row's words. */
function reviewingWords(name: string, count: number): string {
  return `${name} waits for a task · ${count > 1 ? changesInReview(count) : "1 change in review"}.`;
}

/** How many rows of Queued and of Recent the page's Mates list before *Show all*. */
const BOARD_ROWS_SHOWN = 3;

export function TaskBoardView({
  board,
  pool,
  cap,
}: {
  readonly board: BoardView;
  readonly pool: ReadonlyArray<PoolMate>;
  /** How many rows Queued and Recent list before *Show all* opens the rest in place. */
  readonly cap?: number | undefined;
}) {
  const [all, setAll] = useState(false);
  const { read } = board;
  if (read.state === "none") return null;
  if (read.state === "failed")
    return (
      <div className="flex min-h-8 items-center gap-2 px-2">
        <span className="min-w-0 flex-1 text-line text-destructive-foreground" role="alert">
          {read.words}
        </span>
        <Button onClick={board.onReadAgain} size="sm" variant="ghost">
          Read again
        </Button>
      </div>
    );
  if (read.state === "reading") {
    // Each block at the size it lands at, capped as it will be, and *Show all*'s room held.
    const most = cap ?? Infinity;
    const queuedHeld = Math.max(1, read.predicted.queued);
    const recentHeld = Math.max(1, read.predicted.recent);
    const more =
      cap !== undefined &&
      (queuedHeld > cap || recentHeld > cap || read.predicted.recentMore === true);
    return (
      <div className="pp-cards-board" data-zerops-surface="project-automation-board">
        <div className="pp-cards-pair">
          <BoardBlock name="At work">
            <Placeholders count={read.predicted.atWork} />
          </BoardBlock>
          <BoardBlock name="Queued">
            <Placeholders count={Math.min(most, queuedHeld)} />
          </BoardBlock>
        </div>
        <BoardBlock name="Recent">
          <Placeholders count={Math.min(most, recentHeld)} />
          {cap === undefined && read.predicted.recentMore === true ? (
            <div aria-hidden="true" className="h-6" />
          ) : null}
        </BoardBlock>
        {more ? <div aria-hidden="true" className="h-5" /> : null}
      </div>
    );
  }
  const { atWork, blocked, reviewing } = read.board;
  const limit = all || cap === undefined ? Infinity : cap;
  const queuedCut = capped(read.board.queued, limit);
  const recentCut = capped(read.board.recent, limit);
  const queued = queuedCut.shown;
  const recent = recentCut.shown;
  const recentMore = all || cap === undefined ? read.board.recentMore : 0;
  const hidden =
    queuedCut.hidden + recentCut.hidden + (all || cap === undefined ? 0 : read.board.recentMore);
  const faces = new Map(pool.map((mate) => [mate.projectId, mate]));
  const byName = new Map(pool.map((mate) => [mate.name, mate]));
  const busy = new Set([
    ...atWork.flatMap((row) => (row.mate === null ? [] : [row.mate.projectId])),
    ...blocked.map((line) => line.projectId),
  ]);
  const holding = new Map(reviewing.map((entry) => [entry.projectId, entry.count]));
  const free = pool.filter((mate) => !busy.has(mate.projectId));
  const idle = idleWords(
    free.filter((mate) => !holding.has(mate.projectId)).map((mate) => mate.name),
  );
  return (
    <div className="pp-cards-board" data-zerops-surface="project-automation-board">
      <div className="pp-cards-pair">
        <BoardBlock count={atWork.length} name="At work">
          {atWork.length === 0 ? null : (
            <ul className="grid">
              {atWork.map((row) => {
                const mate = row.mate === null ? undefined : faces.get(row.mate.projectId);
                return (
                  <li className="grid" data-zerops-task={row.id} key={row.id}>
                    <div className={ROW}>
                      <span className="flex size-4 shrink-0 items-center">
                        {mate === undefined ? null : (
                          <MateFace
                            shape={mate.shape}
                            size={16}
                            state={row.status === "waiting" ? "needs" : "working"}
                            tint={mate.tint}
                          />
                        )}
                      </span>
                      <span className="sr-only">{mate?.name ?? row.mate?.name ?? "Mate"}</span>
                      <TaskTitle onOpen={board.onOpen} route={row.route} title={row.title} />
                      {row.status === "working" ? null : (
                        <span className="shrink-0 text-caption text-muted-foreground">
                          <StatusWord status={row.status} />
                        </span>
                      )}
                      <span className={NUMBER}>
                        <span className="sr-only">Worked </span>
                        {row.worked}
                      </span>
                      <span className={`w-12 ${NUMBER}`}>{row.cost}</span>
                      <TaskStop board={board} status={row.status} taskId={row.id} />
                    </div>
                    <TaskStopAsk board={board} taskId={row.id} />
                  </li>
                );
              })}
            </ul>
          )}
          {blocked.map((line) => (
            <BlockedLine
              blocked={line}
              key={line.projectId}
              mate={faces.get(line.projectId)?.name ?? "A Mate"}
              onOpen={board.onOpen}
            />
          ))}
          {free.flatMap((mate) => {
            const count = holding.get(mate.projectId);
            return count === undefined
              ? []
              : [
                  <p
                    className="flex h-8 items-center px-2 text-line text-muted-foreground"
                    data-zerops-board-line="reviewing"
                    key={mate.projectId}
                  >
                    <span className="truncate">{reviewingWords(mate.name, count)}</span>
                  </p>,
                ];
          })}
          {idle === null ? null : (
            <p className="flex h-8 items-center px-2 text-line text-muted-foreground">{idle}</p>
          )}
        </BoardBlock>
        <BoardBlock count={read.board.queued.length} name="Queued">
          {queued.length === 0 ? (
            <p className="flex h-8 items-center px-2 text-line text-muted-foreground">
              Nothing waiting.
            </p>
          ) : (
            <ul className="grid">
              {queued.map((row) => {
                const glyph = sourceGlyph(row.url) ?? "·";
                return (
                  <li className="grid" data-zerops-task={row.id} key={row.id}>
                    <div className={ROW}>
                      {row.url === null ? (
                        <span className="pp-cards-glyph">
                          {glyph}
                          <span className="sr-only"> {row.source}</span>
                        </span>
                      ) : (
                        <a
                          className="pp-cards-glyph"
                          href={row.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {glyph}
                          <span className="sr-only"> {row.source}</span>
                        </a>
                      )}
                      <span className="min-w-0 flex-1 truncate">{row.title}</span>
                      <span className={NUMBER}>
                        <span className="sr-only">Waited </span>
                        {row.waited}
                      </span>
                      <TaskStop board={board} status="queued" taskId={row.id} />
                    </div>
                    <TaskStopAsk board={board} taskId={row.id} />
                  </li>
                );
              })}
            </ul>
          )}
        </BoardBlock>
      </div>
      <BoardBlock name="Recent">
        {recent.length === 0 ? (
          <p className="flex h-8 items-center px-2 text-line text-muted-foreground">
            Nothing finished yet.
          </p>
        ) : (
          <ul className="grid">
            {recent.map((row) => {
              const mate = row.mate === null ? undefined : byName.get(row.mate);
              const quiet =
                row.outcome === "failed" || row.outcome === "stopped" || row.outcome === "declined";
              return (
                <li className={ROW} data-zerops-task={row.id} key={row.id}>
                  <span className="flex size-4 shrink-0 items-center">
                    {mate === undefined ? null : (
                      <MateFace shape={mate.shape} size={16} state="idle" tint={mate.tint} />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <TaskTitle onOpen={board.onOpen} route={row.route} title={row.title} />
                    {quiet ? (
                      <span className="shrink-0 text-caption text-muted-foreground">
                        <StatusWord
                          status={row.outcome}
                          {...(row.detail === null ? {} : { why: row.detail })}
                        />
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {row.mate === null ? null : `${row.mate} · `}
                    <span className="sr-only">Ended </span>
                    {row.when.replace(/ ago$/u, "")}
                  </span>
                  <span className={`w-14 ${NUMBER}`}>{row.cost}</span>
                  <span className="w-20 shrink-0 text-end">
                    {row.change === null ? (
                      <span className="text-muted-foreground">No change</span>
                    ) : row.change.external ? (
                      <a
                        className="inline-flex items-center gap-0.5 text-info-foreground underline-offset-2 hover:underline"
                        href={row.change.href}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {row.change.label}
                        <ArrowUpRightIcon aria-hidden="true" className="size-3" />
                      </a>
                    ) : (
                      <a
                        className="text-info-foreground underline-offset-2 hover:underline"
                        href={row.change.href}
                        onClick={(event) => {
                          if (event.metaKey || event.ctrlKey || event.button !== 0) return;
                          event.preventDefault();
                          board.onOpen(row.change!.href);
                        }}
                      >
                        {row.change.label}
                      </a>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {recentMore === 0 ? null : (
          <p className="flex h-6 items-center px-2 text-caption text-muted-foreground">
            {recentMore} more ended earlier.
          </p>
        )}
      </BoardBlock>
      {/* The rest of the queue and of what ended, opened in place: the whole board. */}
      {cap === undefined || (hidden === 0 && !all) ? null : (
        <button
          className="ov-show-all mx-2"
          data-zerops-surface="board-show-all"
          onClick={() => {
            setAll((was) => !was);
          }}
          type="button"
        >
          {all ? "Show fewer" : `Show all · ${String(hidden)} more`}
        </button>
      )}
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
  const disconnected = (row.kind === "slack" || row.kind === "discord") && row.disconnected;
  const press: RowPress = admin === undefined ? { kind: "idle" } : admin.pressOf(row);
  return (
    <li
      className="flex min-h-8 min-w-0 items-center gap-1 px-2 py-0.5"
      data-zerops-source={row.kind}
    >
      <span className="grid min-w-0 flex-1">
        <span
          className={
            row.kind === "failed"
              ? "truncate text-line text-destructive-foreground"
              : "truncate text-line text-foreground"
          }
          role={row.kind === "failed" ? "alert" : undefined}
        >
          {row.words}
        </span>
        {disconnected ? (
          <span className="truncate text-xs text-muted-foreground">
            {row.kind === "slack" ? "Slack" : "Discord"} isn't connected: no tasks come in.
          </span>
        ) : null}
        {press.kind === "refused" ? (
          <span className="text-xs text-destructive-foreground" role="alert">
            {press.words}
          </span>
        ) : null}
      </span>
      {admin === undefined ? null : row.kind === "failed" ? (
        <Button
          onClick={() => {
            admin.onReadAgain(row.source);
          }}
          size="sm"
          variant="ghost"
        >
          Read again
        </Button>
      ) : (
        <>
          {disconnected ? (
            <Button onClick={admin.onOpenSettings} size="sm" variant="ghost">
              Connect
            </Button>
          ) : null}
          <Button
            onClick={() => {
              admin.onEdit(row);
            }}
            size="sm"
            variant="ghost"
          >
            Edit
          </Button>
          {row.kind === "webhook" ? null : <StopControl admin={admin} kind={row.kind} row={row} />}
        </>
      )}
    </li>
  );
}

/**
 * A row's Stop, or a schedule's Remove: it asks on the row first — stopping a source ends its
 * tasks coming in, removing a schedule deletes its brief — then says it works, held while it does.
 */
function StopControl({
  row,
  kind,
  admin,
}: {
  readonly row: SourceRow;
  readonly kind: "github" | "slack" | "discord" | "schedule";
  readonly admin: AutomationControls;
}) {
  const words = stopWords(kind);
  const press = admin.pressOf(row);
  if (press.kind === "asking")
    return (
      <span className="flex items-center gap-1">
        <span className="text-xs text-muted-foreground">{words.ask}</span>
        <Button onClick={admin.onKeep} size="sm" variant="ghost">
          Keep
        </Button>
        <Button
          onClick={() => {
            admin.onStop(row);
          }}
          size="sm"
          variant="destructive"
        >
          {words.verb}
        </Button>
      </span>
    );
  return (
    <Button
      disabled={press.kind === "working"}
      onClick={() => {
        admin.onAskStop(row);
      }}
      size="sm"
      variant="ghost"
    >
      {press.kind === "working" ? words.working : words.verb}
    </Button>
  );
}
