/**
 * A project's automation where the project is: its page's Automation section (the pool of its
 * automated Mates and its sources of tasks) as an Owner or Admin sets it up and as anyone else
 * reads it, a source's form in its compact dialog, and a task's card as its chain in every state
 * it moves through.
 *
 * Served by the dev server at `/design-project-automation.html` (`?theme=dark`;
 * `?dialog=github|slack|discord|webhook|schedule` opens that source's form). Open it at the
 * owner's 1786 × 1000. The change's page with its pull request is `/design-change.html?review=page-pr`.
 *
 * Fixtures only. Nothing here ships — `design-project-automation.html` is not `index.html`, and no
 * route imports this module.
 */
import type { AppIntakeRead, TaskSourceSettingValue } from "@t3tools/client-runtime/data";
import type { MateTaskSource } from "@t3tools/contracts";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { MateTaskSessionBar } from "~/components/zerops/MateTaskCard";
import {
  ProjectAutomationView,
  SourceDialog,
  type AutomationControls,
  type PoolMate,
} from "~/components/zerops/projectAutomation/ProjectAutomation";
import {
  connectionMissing,
  sourceRows,
  type SourceKind,
} from "~/components/zerops/projectAutomation/projectAutomation.logic";
import {
  AppChannelView,
  AppIntakeView,
  AppSchedulesView,
  AppWebhooksView,
} from "~/components/zerops/projectAutomation/sourceForms";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import type { TaskSession } from "~/zerops/taskSession.logic";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const DIALOG = params.get("dialog") as SourceKind | null;
const nothing = () => {};

const known = <T,>(held: T) => ({ state: "known", held, stale: false }) as const;
function controls(setting: unknown) {
  return {
    read: { setting, action: { kind: "idle" }, revealed: null } as TaskSourceSettingValue<never>,
    write: nothing,
    again: nothing,
  };
}

const ADMIN: AutomationControls = {
  onAddMate: nothing,
  onTakeFrom: nothing,
  onEdit: nothing,
  onAskStop: nothing,
  onKeep: nothing,
  pressOf: () => ({ kind: "idle" }),
  onStop: nothing,
  onReadAgain: nothing,
  onOpenSettings: nothing,
};
/** A schedule's Remove asking, GitHub's Stop under way, Slack's refused. */
const PRESSING: AutomationControls = {
  ...ADMIN,
  pressOf: (row) =>
    row.kind === "schedule"
      ? { kind: "asking" }
      : row.kind === "github"
        ? { kind: "working" }
        : row.kind === "slack"
          ? { kind: "refused", words: "HQ is not answering right now." }
          : { kind: "idle" },
};

const POOL: ReadonlyArray<PoolMate> = [
  {
    projectId: "p-nova",
    name: "Nova",
    tint: "olive",
    shape: undefined,
    automation: {
      task: {
        number: 1,
        title: "Add a search box to the tea list",
        pullRequest: { number: 2, state: "open", checks: "passing" },
      },
    },
  },
  {
    projectId: "p-juno",
    name: "Juno",
    tint: "coral",
    shape: undefined,
    automation: { task: { number: 4, title: "Show prices in euros" } },
  },
  { projectId: "p-ines", name: "Ines", tint: "sky", shape: undefined, automation: { task: null } },
];
const WORKING = new Set(["p-juno"]);

const SCHEDULE = {
  id: "s1",
  name: "Update dependencies",
  brief: "Update the dependencies, check the build, and open a change.",
  rule: { every: "week" as const, day: 1, at: "09:00", timeZone: "Europe/Prague" },
  nextAt: "2026-10-19T07:00:00.000Z",
};
const SOURCES = sourceRows({
  intake: { repo: "acme/tea-shop", label: "mate", waiting: 1 },
  slack: known({ channel: { appId: "tea-shop", channelId: "C042", channel: "support" } }),
  discord: known({ channel: null }),
  webhooks: known([{ id: "w1" }, { id: "w2" }]),
  schedules: known([SCHEDULE]),
  slackConnected: true,
  discordConnected: false,
});
const DISCONNECTED = sourceRows({
  intake: null,
  slack: known({ channel: { appId: "tea-shop", channelId: "C042", channel: "support" } }),
  discord: known({ channel: null }),
  webhooks: known([]),
  schedules: { state: "failed", words: "HQ is not answering right now." },
  slackConnected: false,
  discordConnected: false,
});

const ISSUE: MateTaskSource = {
  kind: "github-issue",
  repo: "acme/tea-shop",
  number: 1,
  url: "https://github.com/acme/tea-shop/issues/1",
  title: "Add a search box to the tea list",
  author: "nova-dev",
};
const PR = { number: 2, url: "https://github.com/acme/tea-shop/pull/2" };
const AT: TaskSession = {
  status: null,
  taskId: "task-1",
  stoppable: false,
  workedMs: null,
  spentUsd: null,
  change: null,
  pullRequest: null,
};
const SESSIONS: ReadonlyArray<readonly [string, TaskSession]> = [
  ["Not read yet", AT],
  ["Queued", { ...AT, status: "queued", stoppable: true, workedMs: 0, spentUsd: 0 }],
  ["Working", { ...AT, status: "working", stoppable: true, workedMs: 754_000, spentUsd: 0.42 }],
  [
    "Waiting for you",
    { ...AT, status: "waiting", stoppable: true, workedMs: 1_200_000, spentUsd: 1.37 },
  ],
  ["Stopping", { ...AT, status: "stopping", workedMs: 1_200_000, spentUsd: 1.37 }],
  [
    "Up for review, change in Mate",
    {
      ...AT,
      status: "review",
      workedMs: 1_200_000,
      spentUsd: 1.37,
      change: { repo: "web", number: 3 },
    },
  ],
  [
    "Up for review, PR open, checks passing",
    {
      ...AT,
      status: "review",
      workedMs: 1_200_000,
      spentUsd: 1.37,
      change: { repo: "web", number: 3 },
      pullRequest: { ...PR, state: "open", checks: "passing" },
    },
  ],
  [
    "Working on review comments",
    {
      ...AT,
      status: "working",
      stoppable: true,
      workedMs: 1_500_000,
      spentUsd: 2.05,
      pullRequest: { ...PR, state: "open", checks: "failing" },
    },
  ],
  [
    "Merged",
    {
      ...AT,
      status: "merged",
      workedMs: 3_840_000,
      spentUsd: 6.44,
      pullRequest: { ...PR, state: "merged" },
    },
  ],
  ["Failed", { ...AT, status: "failed", workedMs: 3_600_000, spentUsd: 0.004 }],
  ["Stopped", { ...AT, status: "stopped", workedMs: 420_000, spentUsd: 0.18 }],
];

const INTAKE: AppIntakeRead = {
  intake: { repo: "acme/tea-shop", label: "mate", waiting: 1 },
  action: { kind: "idle" },
  answer: null,
};

function Panel({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="grid content-start gap-3">
      <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}

function DialogFor({ kind }: { readonly kind: SourceKind }) {
  const missing = connectionMissing(kind, { slack: true, discord: false });
  return (
    <SourceDialog kind={kind} onClose={nothing}>
      {missing !== null ? (
        <p className="text-sm text-foreground">{missing}</p>
      ) : kind === "github" ? (
        <ul className="grid">
          <AppIntakeView
            appId="tea-shop"
            choices={["acme/tea-shop"]}
            name="Tea Shop"
            onSet={nothing}
            onStop={nothing}
            read={{ ...INTAKE, intake: null }}
            reposRead
          />
        </ul>
      ) : kind === "slack" ? (
        <AppChannelView controls={controls(known({ channel: null }))} source="slack" />
      ) : kind === "webhook" ? (
        <AppWebhooksView
          controls={controls(
            known([
              {
                id: "w1",
                name: "Sentry",
                url: "https://hq-acme.zerops.app/api/intake/webhook/w1",
                createdAt: "2026-10-17T09:00:00.000Z",
              },
            ]),
          )}
          name="Tea Shop"
        />
      ) : (
        <AppSchedulesView controls={controls(known([SCHEDULE]))} name="Tea Shop" />
      )}
    </SourceDialog>
  );
}

function Harness() {
  return (
    <div className="grid grid-cols-[minmax(0,700px)_minmax(0,1fr)] gap-10 bg-background p-8 text-foreground">
      <div className="grid content-start gap-8">
        <Panel title="An Owner's or Admin's project page — pool and sources">
          <ProjectAutomationView
            admin={ADMIN}
            onOpenMate={nothing}
            pool={POOL}
            sources={SOURCES}
            workingOf={(id) => WORKING.has(id)}
          />
        </Panel>
        <Panel title="Remove asking, Stop under way, Stop refused">
          <ProjectAutomationView
            admin={PRESSING}
            onOpenMate={nothing}
            pool={[]}
            sources={SOURCES}
            workingOf={() => false}
          />
        </Panel>
        <Panel title="Nothing set up yet">
          <ProjectAutomationView
            admin={ADMIN}
            onOpenMate={nothing}
            pool={[]}
            sources={{ rows: [], reading: false, withheld: false }}
            workingOf={() => false}
          />
        </Panel>
        <Panel title="Slack not connected, a source's read failed">
          <ProjectAutomationView
            admin={ADMIN}
            onOpenMate={nothing}
            pool={POOL.slice(2)}
            sources={DISCONNECTED}
            workingOf={() => false}
          />
        </Panel>
        <Panel title="An HQ older than automated Mates">
          <ProjectAutomationView
            onOpenMate={nothing}
            pool={[]}
            sources={{ rows: [], reading: false, withheld: false }}
            update
          />
        </Panel>
        <Panel title="A member reads it">
          <ProjectAutomationView
            onOpenMate={nothing}
            pool={POOL}
            sources={{ rows: SOURCES.rows.slice(0, 1), reading: false, withheld: true }}
            workingOf={(id) => WORKING.has(id)}
          />
        </Panel>
      </div>
      <Panel title="A task's session, in each state">
        <div className="grid max-w-3xl gap-3">
          {SESSIONS.map(([label, session]) => (
            <div className="grid gap-1" key={label}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <MateTaskSessionBar
                onOpenChange={nothing}
                onStop={session.stoppable ? nothing : undefined}
                session={session}
                task={ISSUE}
              />
            </div>
          ))}
        </div>
      </Panel>
      {DIALOG === null ? null : <DialogFor kind={DIALOG} />}
    </div>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
