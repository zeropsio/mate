/**
 * A project's Automation section, on its page's column: the pool of its automated Mates, each
 * with what it is on, and *Add an automated Mate*; then the sources its tasks come from — GitHub
 * issues by label, a Slack or Discord channel, webhooks, schedules — one row each with its own
 * Edit and Stop, and *Take tasks from…* to add one. Configured where the project is: Settings
 * keeps only what is the organization's (its key, its GitHub app, its Slack and Discord).
 *
 * An Owner or Admin sets it up here; anyone else reads the pool and the GitHub source, and sees
 * the section only once it holds something.
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
import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { automatedKeyState } from "~/zerops/automatedMate.logic";
import { useAppIntake, useAutomatedKey, useOrgAiKeys } from "~/zerops/useAutomationSettings";
import { useAppTaskSource, useOrgTaskSource } from "~/zerops/useTaskSourceSettings";
import { useNewMateDialog } from "~/zerops/newMate";
import { useAddMateOffer } from "~/zerops/useHqOffers";
import { useOpenMate } from "~/zerops/useOpenMate";
import { useZeropsCandidates } from "~/zerops/useZeropsCandidates";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";
import { mateActivityAtom } from "~/zerops/mateActivityAtoms";
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
import { intakeRepoChoices } from "../../settings/automatedMatesSettings.logic";
import { MateFace } from "../primitives";
import { mateAutomation, type MateAutomationLine } from "../SidebarMateRow.logic";
import {
  automationShown,
  connectionMissing,
  poolMateLine,
  SOURCE_KINDS,
  sourceRows,
  type SourceKind,
  type SourceRow,
} from "./projectAutomation.logic";
import { AppChannelView, AppIntakeView, AppSchedulesView, AppWebhooksView } from "./sourceForms";

/** Where the organization's connections are set: Settings › Automation. */
const AUTOMATION_SETTINGS = "/settings/zerops" as const;

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
  const pool = usePool(groupId);
  const intake = useAppIntake(groupId);
  const addMate = useAddAutomatedMate(groupId);
  const openMate = useOpenMate();
  const onOpenMate = (projectId: string) => {
    openMate({ projectId });
  };
  if (key === "unsupported") return null;
  if (!admin) {
    const { rows } = sourceRows({
      intake: intake.read.intake,
      slack: WITHHELD,
      discord: WITHHELD,
      webhooks: WITHHELD,
      schedules: WITHHELD,
      slackConnected: undefined,
      discordConnected: undefined,
    });
    if (!automationShown({ admin, key, pool: pool.length, sources: rows.length })) return null;
    return (
      <ProjectAutomationView
        onOpenMate={onOpenMate}
        pool={pool}
        sources={{ rows, reading: intake.read.intake === undefined }}
      />
    );
  }
  return (
    <AdminAutomation
      addMate={addMate}
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

/** The pool: the project's automated Mates, as HQ places them, each with what it is on. */
function usePool(groupId: string): ReadonlyArray<PoolMate> {
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
  return automated.map((candidate) => {
    const tint = tints.get(candidate.project.id) ?? "slate";
    return {
      projectId: candidate.project.id,
      name: projectNameInApp(candidate.project),
      tint,
      shape: mateShapeOf(candidate.project, tint),
      automation: mateAutomation(candidate.project.hq?.mate, key) ?? { task: null },
    };
  });
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
  onOpenMate,
}: {
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
  const orgSlack = useOrgTaskSource("hqSlack");
  const orgDiscord = useOrgTaskSource("hqDiscord");
  const navigate = useNavigate();
  const [open, setOpen] = useState<SourceKind | null>(null);
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
          onStop: (row) => {
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

/** A pool row's face: awake while it works, asking while its task waits on a person. */
function PoolRow({
  mate,
  onOpen,
}: {
  readonly mate: PoolMate;
  readonly onOpen: (projectId: string) => void;
}) {
  const activity = useAtomValue(mateActivityAtom(mate.projectId));
  const working = activity?.kind === "working";
  return <PoolRowView mate={mate} onOpen={onOpen} working={working} />;
}

export function PoolRowView({
  mate,
  working,
  onOpen,
}: {
  readonly mate: PoolMate;
  readonly working: boolean;
  readonly onOpen: (projectId: string) => void;
}) {
  return (
    <li>
      <button
        className="flex w-full min-w-0 items-center gap-3 rounded-lg px-2 py-1.5 text-start hover:bg-accent/50"
        data-zerops-surface="project-automation-mate"
        onClick={() => {
          onOpen(mate.projectId);
        }}
        type="button"
      >
        <MateFace
          shape={mate.shape}
          size={24}
          state={poolMateFace(mate, working)}
          tint={mate.tint}
        />
        <span className="grid min-w-0 flex-1">
          <span className="truncate text-sm font-medium text-foreground">{mate.name}</span>
          <span className="truncate text-xs text-muted-foreground">
            {poolMateLine(mate.automation, working)}
          </span>
        </span>
      </button>
    </li>
  );
}

/** What an Owner or Admin may do in the section; absent for anyone else, who reads it. */
export interface AutomationControls {
  readonly onAddMate: (() => void) | undefined;
  readonly onTakeFrom: (kind: SourceKind) => void;
  readonly onEdit: (row: SourceRow) => void;
  readonly onStop: (row: SourceRow) => void;
  readonly onReadAgain: (source: Exclude<SourceKind, "github">) => void;
  readonly onOpenSettings: () => void;
}

/**
 * The section drawn — every read already done and handed in — so a test and the harness can look
 * at it with no account behind it. `workingOf` says which pool Mates work (a harness hands it).
 */
export function ProjectAutomationView({
  pool,
  sources,
  admin,
  onOpenMate,
  workingOf,
}: {
  readonly pool: ReadonlyArray<PoolMate>;
  readonly sources: { readonly rows: ReadonlyArray<SourceRow>; readonly reading: boolean };
  readonly admin?: AutomationControls | undefined;
  readonly onOpenMate: (projectId: string) => void;
  readonly workingOf?: ((projectId: string) => boolean) | undefined;
}) {
  return (
    <section aria-label="Automation" className="ov-side" data-zerops-surface="project-automation">
      <h2 className="ov-side-name">Automation</h2>
      {pool.length === 0 ? (
        <p className="px-2 text-sm text-muted-foreground">
          No automated Mates yet. They take tasks from the sources below and open a change for each.
        </p>
      ) : (
        <ul className="grid" data-zerops-surface="project-automation-pool">
          {pool.map((mate) =>
            workingOf === undefined ? (
              <PoolRow key={mate.projectId} mate={mate} onOpen={onOpenMate} />
            ) : (
              <PoolRowView
                key={mate.projectId}
                mate={mate}
                onOpen={onOpenMate}
                working={workingOf(mate.projectId)}
              />
            ),
          )}
        </ul>
      )}
      {admin?.onAddMate === undefined ? null : (
        <div className="px-2">
          <Button onClick={admin.onAddMate} size="sm" variant="secondary">
            <PlusIcon aria-hidden="true" />
            Add an automated Mate
          </Button>
        </div>
      )}
      <h3 className="px-2 pt-2 text-xs font-medium text-muted-foreground">Takes tasks from</h3>
      {sources.rows.length === 0 ? (
        <p className="px-2 text-sm text-muted-foreground">
          {sources.reading ? "Reading…" : "Nowhere yet."}
        </p>
      ) : (
        <ul className="grid" data-zerops-surface="project-automation-sources">
          {sources.rows.map((row) => (
            <SourceRowView admin={admin} key={row.key} row={row} />
          ))}
        </ul>
      )}
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
    </section>
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
          {row.kind === "webhook" ? null : (
            <Button
              onClick={() => {
                admin.onStop(row);
              }}
              size="sm"
              variant="ghost"
            >
              {row.kind === "schedule" ? "Remove" : "Stop"}
            </Button>
          )}
        </>
      )}
    </li>
  );
}
