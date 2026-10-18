/**
 * A project's Automation section, on its page's column: the pool of its automated Mates as one
 * line (their faces and names, *Add*, and the organization's spend this month against its
 * budget); its task board — what they are on (at work, with Stop), what waits by its place, and
 * what ended — read from HQ and read again as HQ's navigation says they moved; then the sources
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
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import {
  assignCandidateMateTints,
  mateShapeOf,
  projectNameInApp,
} from "@t3tools/client-runtime/zerops";
import { heldCandidates } from "@t3tools/client-runtime/zerops/projections";
import { useNavigate } from "@tanstack/react-router";
import { ArrowUpRightIcon, ChevronDownIcon, PlusIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { automatedKeyState } from "~/zerops/automatedMate.logic";
import { useAppIntake, useAutomatedKey, useOrgAiKeys } from "~/zerops/useAutomationSettings";
import { useAppTaskSource, useGithubApp, useOrgTaskSource } from "~/zerops/useTaskSourceSettings";
import { useNewMateDialog } from "~/zerops/newMate";
import { useAddMateOffer } from "~/zerops/useHqOffers";
import { useOpenMate } from "~/zerops/useOpenMate";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { mateActivityAtom } from "~/zerops/mateActivityAtoms";
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
import { mateAutomation, type MateAutomationLine } from "../SidebarMateRow.logic";
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
  poolLine,
  spendLine,
  type Board,
  type BoardStatus,
  type BoardTone,
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
  const { pool, signature, predicted } = usePool(groupId);
  const intake = useAppIntake(groupId);
  const addMate = useAddAutomatedMate(groupId);
  const openMate = useOpenMate();
  const onOpenMate = (projectId: string) => {
    openMate({ projectId });
  };
  const board = useTaskBoard(
    groupId,
    signature,
    { ...predicted, queued: intake.read.intake?.waiting ?? 0 },
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

const WITHHELD = { state: "withheld" } as const;

/**
 * The pool: the project's automated Mates, as HQ places them, each with what it is on; what HQ's
 * navigation says of their tasks, as one value that moves when any of them does (the board reads
 * again on it); and how many rows the board will hold, as navigation knows it while it reads.
 */
function usePool(groupId: string): {
  readonly pool: ReadonlyArray<PoolMate>;
  readonly signature: string;
  readonly predicted: { readonly atWork: number; readonly recent: number };
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
  const live = tasks.filter((task) => task != null && task.ended === undefined).length;
  return {
    pool,
    signature: JSON.stringify(tasks),
    predicted: {
      // A row per task at work, and the line naming those that wait for one.
      atWork: live + (tasks.length > live ? 1 : 0),
      recent: tasks.filter((task) => task?.ended !== undefined).length,
    },
  };
}

/**
 * The application's task board: HQ's tasks of it, read while the section is drawn and again each
 * time HQ's navigation says its automated Mates' tasks moved (HQ streams no board of its own);
 * the organization's spend this month; and an Owner's or Admin's Stop of a task, asked on its row.
 */
function useTaskBoard(
  groupId: string,
  signature: string,
  predicted: { readonly atWork: number; readonly queued: number; readonly recent: number },
  /** An Owner or Admin: each task at work has its Stop. */
  admin: boolean,
): BoardView {
  const tasks = useAppTaskSource("hqAppTasks", groupId);
  const limits = useOrgTaskSource("hqTaskLimits");
  const nowMs = useNowMs();
  const navigate = useNavigate();
  const { again } = tasks;
  const seen = useRef(signature);
  useEffect(() => {
    if (seen.current === signature) return;
    seen.current = signature;
    again();
  }, [signature, again]);
  const [asking, setAsking] = useState<string | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const setting = tasks.read.setting;
  const held = setting.state === "known" ? setting.held : null;
  const board = useMemo(
    () => (held === null ? null : boardOf(held, nowMs, groupId)),
    [held, nowMs, groupId],
  );
  return {
    read:
      board !== null
        ? { state: "known", board }
        : setting.state === "failed"
          ? { state: "failed", words: setting.words }
          : setting.state === "withheld" || setting.state === "unsupported"
            ? { state: "none" }
            : { state: "reading", predicted },
    spend: limits.read.setting.state === "known" ? spendLine(limits.read.setting.held) : null,
    onReadAgain: tasks.again,
    onOpen: (route) => {
      void navigate({ href: route });
    },
    stop: !admin
      ? undefined
      : {
          pressOf: (taskId) =>
            sourceRowPress({ key: taskId, asking, pressed, action: tasks.read.action }),
          onAsk: (taskId) => {
            setAsking(taskId);
          },
          onKeep: () => {
            setAsking(null);
          },
          onStop: (taskId) => {
            setAsking(null);
            setPressed(taskId);
            tasks.write({ kind: "task-stop", taskId });
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
  const githubApp =
    github.read.setting.state === "known" && github.read.setting.held.state === "connected"
      ? github.read.setting.held.slug
      : undefined;
  const orgSlack = useOrgTaskSource("hqSlack");
  const orgDiscord = useOrgTaskSource("hqDiscord");
  const navigate = useNavigate();
  const [open, setOpen] = useState<SourceKind | null>(null);
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
                return <AppChannelView controls={slack} source="slack" />;
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
        readonly predicted: {
          readonly atWork: number;
          readonly queued: number;
          readonly recent: number;
        };
      }
    | { readonly state: "known"; readonly board: Board }
    | { readonly state: "failed"; readonly words: string }
    | { readonly state: "none" };
  /** The organization's spend this month against its budget (`spendLine`); `null` unknown. */
  readonly spend: string | null;
  readonly onReadAgain: () => void;
  /** Opens a task's conversation or its change, by its in-app path. */
  readonly onOpen: (route: string) => void;
  /** An Owner's or Admin's Stop of a task at work, asked on its row; absent for anyone else. */
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
    <section aria-label="Automation" className="ov-side" data-zerops-surface="project-automation">
      <h2 className="ov-side-name">Automation</h2>
      {update ? (
        <p className="px-2 text-sm text-muted-foreground">Update HQ to set up automated Mates.</p>
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
  return (
    <>
      {pool.length === 0 ? (
        <>
          <p className="px-2 text-sm text-muted-foreground">
            No automated Mates yet. They take tasks from the sources below and open a change for
            each.
          </p>
          {admin?.onAddMate === undefined ? null : (
            <div className="px-2">
              <Button onClick={admin.onAddMate} size="sm" variant="secondary">
                <PlusIcon aria-hidden="true" />
                Add an automated Mate
              </Button>
            </div>
          )}
        </>
      ) : (
        <div
          className="flex min-h-7 min-w-0 items-center gap-2 px-2"
          data-zerops-surface="project-automation-pool"
        >
          <span className="flex shrink-0 items-center">
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
          <span className="min-w-0 truncate text-sm text-foreground">
            {poolLine(pool.map((mate) => mate.name))}
          </span>
          {admin?.onAddMate === undefined ? null : (
            <>
              <span aria-hidden="true" className="text-sm text-muted-foreground">
                ·
              </span>
              <Button
                aria-label="Add an automated Mate"
                onClick={admin.onAddMate}
                size="sm"
                variant="ghost"
              >
                Add
              </Button>
            </>
          )}
          {board?.spend == null ? null : (
            <span className="ms-auto shrink-0 text-xs text-muted-foreground tabular-nums">
              {board.spend}
            </span>
          )}
        </div>
      )}
      {board === undefined || board.read.state === "none" ? null : (
        <TaskBoardView board={board} pool={pool} />
      )}
      <h3 className="px-2 pt-2 text-xs font-medium text-muted-foreground">Takes tasks from</h3>
      {sources.rows.length > 0 ? (
        <ul className="grid" data-zerops-surface="project-automation-sources">
          {sources.rows.map((row) => (
            <SourceRowView admin={admin} key={row.key} row={row} />
          ))}
        </ul>
      ) : sources.reading ? (
        <p className="px-2 text-sm text-muted-foreground">Reading…</p>
      ) : sources.withheld ? null : (
        <p className="px-2 text-sm text-muted-foreground">Nowhere yet.</p>
      )}
      {sources.withheld ? (
        <p className="px-2 text-xs text-muted-foreground">Owners and admins see every source.</p>
      ) : null}
      {admin === undefined ? null : (
        <div className="px-2">
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
        </div>
      )}
    </>
  );
}

/** A status's dot colour, by what it means. */
const DOT: Record<BoardTone, string> = {
  starting: "bg-muted-foreground/50",
  working: "bg-info",
  waiting: "bg-warning",
  review: "bg-info",
  done: "bg-success",
  merged: "bg-success",
  failed: "bg-destructive",
  stopped: "bg-muted-foreground/50",
};

function StatusWord({ status, why }: { readonly status: BoardStatus; readonly why?: string }) {
  const word = (
    <>
      <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${DOT[status.tone]}`} />
      <span className="truncate">{status.word}</span>
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
    <div className="grid" data-zerops-board={name}>
      <h3 className="flex h-6 items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground">
        {name}
        {count === undefined || count === 0 ? null : <span className="tabular-nums">{count}</span>}
      </h3>
      {children}
    </div>
  );
}

const ROW = "flex h-8 min-w-0 items-center gap-3 px-2 text-sm";
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

/** "Juno waits for a task." / "Raya and Ines wait for a task." */
function idleWords(names: ReadonlyArray<string>): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]!} waits for a task.`;
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)!} wait for a task.`;
}

export function TaskBoardView({
  board,
  pool,
}: {
  readonly board: BoardView;
  readonly pool: ReadonlyArray<PoolMate>;
}) {
  const { read } = board;
  if (read.state === "none") return null;
  if (read.state === "failed")
    return (
      <div className="flex min-h-8 items-center gap-2 px-2">
        <span className="min-w-0 flex-1 text-sm text-destructive-foreground" role="alert">
          {read.words}
        </span>
        <Button onClick={board.onReadAgain} size="sm" variant="ghost">
          Read again
        </Button>
      </div>
    );
  if (read.state === "reading")
    return (
      <div className="grid gap-1" data-zerops-surface="project-automation-board">
        <BoardBlock name="At work">
          <Placeholders count={read.predicted.atWork} />
        </BoardBlock>
        <BoardBlock name="Queued">
          <Placeholders count={Math.max(1, read.predicted.queued)} />
        </BoardBlock>
        <BoardBlock name="Recent">
          <Placeholders count={Math.max(1, read.predicted.recent)} />
        </BoardBlock>
      </div>
    );
  const { atWork, queued, recent, recentMore } = read.board;
  const faces = new Map(pool.map((mate) => [mate.projectId, mate]));
  const busy = new Set(atWork.flatMap((row) => (row.mate === null ? [] : [row.mate.projectId])));
  const idle = idleWords(pool.filter((mate) => !busy.has(mate.projectId)).map((mate) => mate.name));
  return (
    <div className="grid gap-1" data-zerops-surface="project-automation-board">
      <BoardBlock count={atWork.length} name="At work">
        {atWork.length === 0 ? null : (
          <ul className="grid">
            {atWork.map((row) => {
              const mate = row.mate === null ? undefined : faces.get(row.mate.projectId);
              const press = board.stop?.pressOf(row.id) ?? { kind: "idle" as const };
              return (
                <li className="grid" data-zerops-task={row.id} key={row.id}>
                  <div className={ROW}>
                    <span className="flex w-24 shrink-0 items-center gap-1.5">
                      {mate === undefined ? null : (
                        <MateFace
                          shape={mate.shape}
                          size={16}
                          state={row.status.tone === "waiting" ? "needs" : "working"}
                          tint={mate.tint}
                        />
                      )}
                      <span className="truncate font-medium">
                        {mate?.name ?? row.mate?.name ?? "Mate"}
                      </span>
                    </span>
                    <TaskTitle onOpen={board.onOpen} route={row.route} title={row.title} />
                    <span className="w-36 shrink-0 text-muted-foreground">
                      <StatusWord status={row.status} />
                    </span>
                    <span className={`w-9 ${NUMBER}`}>{row.elapsed}</span>
                    <span className={`w-14 ${NUMBER}`}>{row.cost}</span>
                    {board.stop === undefined ? null : press.kind === "asking" ? null : (
                      <Button
                        disabled={press.kind === "working"}
                        onClick={() => {
                          board.stop?.onAsk(row.id);
                        }}
                        size="sm"
                        variant="ghost"
                      >
                        {press.kind === "working" ? "Stopping…" : "Stop"}
                      </Button>
                    )}
                  </div>
                  {press.kind === "asking" ? (
                    <div className="flex h-8 items-center justify-end gap-1 px-2">
                      <span className="text-xs text-muted-foreground">
                        Stop this task? Its Mate stops where it got to.
                      </span>
                      <Button onClick={board.stop?.onKeep} size="sm" variant="ghost">
                        Keep
                      </Button>
                      <Button
                        onClick={() => {
                          board.stop?.onStop(row.id);
                        }}
                        size="sm"
                        variant="destructive"
                      >
                        Stop
                      </Button>
                    </div>
                  ) : press.kind === "refused" ? (
                    <p className="px-2 text-xs text-destructive-foreground" role="alert">
                      {press.words}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {idle === null ? null : (
          <p className="flex h-8 items-center px-2 text-sm text-muted-foreground">{idle}</p>
        )}
      </BoardBlock>
      <BoardBlock count={queued.length} name="Queued">
        {queued.length === 0 ? (
          <p className="flex h-8 items-center px-2 text-sm text-muted-foreground">
            Nothing waiting.
          </p>
        ) : (
          <ul className="grid">
            {queued.map((row) => (
              <li className={ROW} data-zerops-task={row.id} key={row.id}>
                <span className={`w-5 ${NUMBER}`}>{row.position}</span>
                <span className="min-w-0 flex-1 truncate">{row.title}</span>
                {row.url === null ? (
                  <span className="max-w-44 shrink-0 truncate text-muted-foreground">
                    {row.source}
                  </span>
                ) : (
                  <a
                    className="max-w-44 shrink-0 truncate text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    href={row.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {row.source}
                  </a>
                )}
                <span className={`w-9 ${NUMBER}`}>{row.waited}</span>
              </li>
            ))}
          </ul>
        )}
      </BoardBlock>
      <BoardBlock name="Recent">
        {recent.length === 0 ? (
          <p className="flex h-8 items-center px-2 text-sm text-muted-foreground">
            Nothing finished yet.
          </p>
        ) : (
          <ul className="grid">
            {recent.map((row) => (
              <li className={ROW} data-zerops-task={row.id} key={row.id}>
                <span className="w-28 shrink-0 text-muted-foreground">
                  <StatusWord
                    status={row.outcome}
                    {...(row.detail === null ? {} : { why: row.detail })}
                  />
                </span>
                <TaskTitle onOpen={board.onOpen} route={row.route} title={row.title} />
                <span className="w-16 shrink-0 truncate text-muted-foreground">
                  {row.mate ?? ""}
                </span>
                <span className={`w-9 ${NUMBER}`}>{row.when}</span>
                <span className={`w-14 ${NUMBER}`}>{row.cost}</span>
                <span className="w-20 shrink-0 text-end">
                  {row.change === null ? null : row.change.external ? (
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
            ))}
          </ul>
        )}
        {recentMore === 0 ? null : (
          <p className="px-2 text-xs text-muted-foreground">{recentMore} more ended earlier.</p>
        )}
      </BoardBlock>
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
              ? "truncate text-sm text-destructive-foreground"
              : "truncate text-sm text-foreground"
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
