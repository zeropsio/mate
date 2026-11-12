/**
 * A project's automation where the project is: its page's Automation section (the pool of its
 * automated Mates and its sources of tasks) as an Owner or Admin sets it up and as anyone else
 * reads it, a source's form in its compact dialog, and a task's card as its chain in every state
 * it moves through.
 *
 * Served by the dev server at `/design-project-automation.html` (`?theme=dark`; `?state=<name>`
 * draws one of the section's states alone, `?width=871` at the page's main column instead of 700;
 * `?dialog=github|slack|discord|webhook|schedule` opens that source's form; `?merging=all`, or
 * one state's name, draws who can merge instead: `projectMergingFixtures.tsx`). Open it at the
 * owner's 1786 × 1000. The change's page with its pull request is `/design-change.html?review=page-pr`.
 *
 * Fixtures only. Nothing here ships — `design-project-automation.html` is not `index.html`, and no
 * route imports this module.
 */
import type { AppIntakeRead, TaskSourceSettingValue } from "@t3tools/client-runtime/data";
import type { MateTaskSource } from "@t3tools/contracts";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { MateTaskCardView, MateTaskStatusView } from "~/components/zerops/MateTaskCard";
import {
  ProjectAutomationView,
  SourceDialog,
  type AutomationControls,
  type BoardView,
  type PoolMate,
} from "~/components/zerops/projectAutomation/ProjectAutomation";
import { boardOf } from "~/components/zerops/projectAutomation/taskBoard.logic";
import type { HqAppTask } from "@t3tools/shared/hqIntake";
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
import { SectionLabel } from "~/components/zerops/system";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import type { TaskSession } from "~/zerops/taskSession.logic";
import { MergingHarness } from "./projectMergingFixtures";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const DIALOG = params.get("dialog") as SourceKind | null;
const MERGING = params.get("merging");
const STATE = params.get("state");
/** The section's width: the page's main column at the reference viewport is 871 px. */
const COLUMNS =
  params.get("width") === "871"
    ? "grid grid-cols-[minmax(0,871px)_minmax(0,1fr)] gap-10 bg-background p-8 text-foreground"
    : "grid grid-cols-[minmax(0,700px)_minmax(0,1fr)] gap-10 bg-background p-8 text-foreground";
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
  onReadAgain: nothing,
  onOpenSettings: nothing,
};

/** A made-up plant shop and its four automated Mates. */
const SHOP = "fernhill/plant-shop";
const FREE = { task: null } as const;
const SOL: PoolMate = {
  projectId: "p-sol",
  name: "Sol",
  tint: "amber",
  shape: "pentagon",
  automation: FREE,
};
const PIM: PoolMate = {
  projectId: "p-pim",
  name: "Pim",
  tint: "olive",
  shape: "clover",
  automation: FREE,
};
const WREN: PoolMate = {
  projectId: "p-wren",
  name: "Wren",
  tint: "sky",
  shape: "pick",
  automation: FREE,
};
const BO: PoolMate = {
  projectId: "p-bo",
  name: "Bo",
  tint: "slate",
  shape: "squircle",
  automation: FREE,
};
const on = (mate: PoolMate, title: string, waiting = false): PoolMate => ({
  ...mate,
  automation: { task: waiting ? { title, waiting: true } : { title } },
});

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const HOUR = 60;
const DAY = 24 * HOUR;
const by = (mate: PoolMate) => ({ projectId: mate.projectId, name: mate.name });
const task = (
  patch: Partial<HqAppTask> & Pick<HqAppTask, "id" | "title" | "state">,
): HqAppTask => ({
  label: `${SHOP}#${patch.id}`,
  url: `https://github.com/${SHOP}/issues/${patch.id}`,
  mate: null,
  requestedBy: "mara",
  createdAt: ago(3 * HOUR),
  startedAt: null,
  endedAt: null,
  spentUsd: null,
  workedMs: null,
  detail: null,
  change: null,
  pullRequest: null,
  link: `https://mate.zerops.io/env-1/conversation-${patch.id}`,
  ...patch,
});
/** A task that ended: whose, how, how long ago, its cost, and its pull request where it has one. */
const ended = (
  id: string,
  title: string,
  mate: PoolMate,
  state: HqAppTask["state"],
  minutes: number,
  spentUsd: number,
  more: Partial<HqAppTask> = {},
): HqAppTask =>
  task({ id, title, state, mate: by(mate), endedAt: ago(minutes), spentUsd, ...more });
const pr = (number: number) => ({
  change: { repo: "shop", number },
  pullRequest: { number, url: `https://github.com/${SHOP}/pull/${String(number)}` },
});

const SORT = ended("38", "Sort plants by light needs", PIM, "merged", 4 * HOUR, 0.31, pr(38));
const PRICE = ended("40", "Show each plant’s price per pot size", WREN, "done", 5 * HOUR, 0.27, {
  change: { repo: "shop", number: 40 },
});
const GUIDES = ended("37", "Translate the care guides", SOL, "closed", 11 * HOUR, 0.66, {
  change: { repo: "shop", number: 37 },
});
const CATALOGUE = ended("39", "Import the autumn catalogue", SOL, "failed", DAY, 2.02, {
  detail: "The catalogue file was not in the repository.",
});
const RENAME = ended("34", "Rename the care page", PIM, "stopped", 2 * DAY, 0.04, {
  detail: "Mara stopped it.",
});
const IMAGES = ended(
  "36",
  "Fix the watering guide’s broken images",
  PIM,
  "merged",
  2 * DAY,
  0.48,
  pr(36),
);
/** Fourteen that ended: what HQ answers of a project that has worked a while. */
const FOURTEEN: ReadonlyArray<HqAppTask> = [
  SORT,
  PRICE,
  GUIDES,
  CATALOGUE,
  IMAGES,
  RENAME,
  ended("35", "Add a low-stock badge", WREN, "merged", 3 * DAY, 0.35, pr(35)),
  ended("33", "Show pot sizes in centimetres", SOL, "merged", 3 * DAY, 0.22, pr(33)),
  ended("30", "Remember the last delivery address", PIM, "merged", 5 * DAY, 0.57, pr(30)),
  ended("29", "Fix the footer links on phones", WREN, "merged", 6 * DAY, 0.19, pr(29)),
  ended("28", "Add care reminders by email", BO, "closed", 6 * DAY, 0.91, {
    change: { repo: "shop", number: 28 },
  }),
  ended("27", "Group plants by room", SOL, "merged", 8 * DAY, 0.44, pr(27)),
  ended("26", "Update the delivery prices", PIM, "merged", 9 * DAY, 0.12, pr(26)),
  ended("24", "Cache the plant photos", BO, "merged", 10 * DAY, 1.12, pr(24)),
];

const DATES = task({
  id: "42",
  title: "Show delivery dates in the cart",
  state: "working",
  mate: by(SOL),
  startedAt: ago(14),
  spentUsd: 0.42,
  workedMs: 12 * 60_000,
});
const ROUNDING = task({
  id: "43",
  title: "Round the cart total the same way everywhere",
  label: "#shop-requests on Slack",
  url: null,
  state: "waiting",
  mate: by(PIM),
  startedAt: ago(20),
  spentUsd: 1.08,
  workedMs: 10 * 60_000,
});
const SEARCH = task({
  id: "31",
  title: "Speed up the plant search",
  state: "working",
  mate: by(BO),
  startedAt: ago(40),
  spentUsd: 0.96,
  workedMs: 31 * 60_000,
});
const QUEUE: ReadonlyArray<HqAppTask> = [
  task({
    id: "44",
    title: "Add gift notes at checkout",
    state: "queued",
    position: 1,
    createdAt: ago(4),
    link: null,
  }),
  task({
    id: "45",
    title: "Weekly dependency update",
    label: "Schedule",
    url: null,
    state: "queued",
    position: 2,
    createdAt: ago(1),
    link: null,
  }),
];
/** What navigation says of the tasks the pool is on: Pim's asks the person. */
const LIVE = new Map([
  ["43", { id: "43", title: ROUNDING.title, url: null, waiting: true as const }],
]);

type Stop = NonNullable<BoardView["stop"]>;
const STOP: Stop = {
  pressOf: () => ({ kind: "idle" }),
  onAsk: nothing,
  onKeep: nothing,
  onStop: nothing,
};
function board(
  tasks: ReadonlyArray<HqAppTask>,
  spend: string,
  more: {
    readonly pressOf?: Stop["pressOf"];
    readonly live?: Parameters<typeof boardOf>[3];
    readonly held?: Parameters<typeof boardOf>[4];
  } = {},
): BoardView {
  return {
    read: {
      state: "known",
      board: boardOf(tasks, NOW, "plant-shop", more.live ?? LIVE, more.held),
    },
    spend: `${spend} this month`,
    onReadAgain: nothing,
    onOpen: nothing,
    stop: { ...STOP, pressOf: more.pressOf ?? STOP.pressOf },
  };
}

const SCHEDULE = {
  id: "s1",
  name: "Weekly dependency update",
  brief: "Update the dependencies, check the build, and open a change.",
  rule: { every: "week" as const, day: 1, at: "09:00", timeZone: "Europe/Prague" },
  nextAt: "2026-10-19T07:00:00.000Z",
};
const NO_SOURCES = { rows: [], reading: false, withheld: false } as const;
const SOURCES = (waiting: number) =>
  sourceRows({
    intake: { repo: SHOP, label: "mate", waiting },
    slack: known({ channel: { appId: "plant-shop", channelId: "C042", channel: "shop-requests" } }),
    discord: known({ channel: null }),
    webhooks: known([]),
    schedules: known([]),
    slackConnected: true,
    discordConnected: true,
  });
/** Seven sources, Discord not connected to the organization. */
const SEVEN = sourceRows({
  intake: { repo: SHOP, label: "mate", waiting: 1 },
  slack: known({ channel: { appId: "plant-shop", channelId: "C042", channel: "shop-requests" } }),
  discord: known({ channel: { appId: "plant-shop", channelId: "D7", channel: "greenhouse" } }),
  webhooks: known([{ id: "w1" }, { id: "w2" }]),
  schedules: known([
    SCHEDULE,
    {
      ...SCHEDULE,
      id: "s2",
      name: "Check for broken links",
      rule: { every: "day" as const, at: "06:30", timeZone: "Europe/Prague" },
    },
    {
      ...SCHEDULE,
      id: "s3",
      name: "Tidy the plant photos",
      rule: { every: "week" as const, day: 5, at: "16:00", timeZone: "Europe/Prague" },
    },
  ]),
  slackConnected: true,
  discordConnected: false,
});
const DISCONNECTED = sourceRows({
  intake: null,
  slack: known({ channel: { appId: "plant-shop", channelId: "C042", channel: "shop-requests" } }),
  discord: known({ channel: null }),
  webhooks: known([]),
  schedules: { state: "failed", words: "HQ is not answering right now." },
  slackConnected: false,
  discordConnected: false,
});

const BUSY_POOL = [on(SOL, DATES.title), on(PIM, ROUNDING.title, true)];
const BUSY_TASKS = [...QUEUE, DATES, ROUNDING, SORT, IMAGES, GUIDES];
const working = (...mates: ReadonlyArray<PoolMate>) => {
  const ids = new Set(mates.map((mate) => mate.projectId));
  return (projectId: string) => ids.has(projectId);
};

/**
 * The section's states, by the name `?state=` draws one alone under: the six the design board
 * draws first, then what a read, a press and a refusal make of it.
 */
const STATES: ReadonlyArray<{
  readonly id: string;
  readonly title: string;
  readonly view: ReactNode;
}> = [
  {
    id: "idle",
    title: "Idle: nothing queued, a few finished",
    view: (
      <ProjectAutomationView
        admin={ADMIN}
        board={board([SORT, IMAGES, GUIDES], "$6.44 of $50")}
        onOpenMate={nothing}
        pool={[SOL, PIM]}
        sources={SOURCES(0)}
        workingOf={working()}
      />
    ),
  },
  {
    id: "busy",
    title: "At work: one Mate working, one asking, two tasks queued",
    view: (
      <ProjectAutomationView
        admin={ADMIN}
        board={board(BUSY_TASKS, "$7.94 of $50")}
        onOpenMate={nothing}
        pool={BUSY_POOL}
        sources={SOURCES(1)}
        workingOf={working(SOL)}
      />
    ),
  },
  {
    id: "failed",
    title: "A failure: one task failed, one was stopped, one is up for review",
    view: (
      <ProjectAutomationView
        admin={ADMIN}
        board={board([SORT, CATALOGUE, PRICE, RENAME, GUIDES], "$9.74 of $50")}
        onOpenMate={nothing}
        pool={[SOL, PIM]}
        sources={SOURCES(0)}
        workingOf={working()}
      />
    ),
  },
  {
    id: "long",
    title: "A long list: fourteen finished, five shown until the rest are opened",
    view: (
      <ProjectAutomationView
        admin={ADMIN}
        board={board([SEARCH, ...FOURTEEN], "$21.40 of $50")}
        onOpenMate={nothing}
        pool={[SOL, PIM, WREN, on(BO, SEARCH.title)]}
        sources={SOURCES(0)}
        workingOf={working(BO)}
      />
    ),
  },
  {
    id: "first",
    title: "First run: one Mate, no source yet",
    view: (
      <ProjectAutomationView
        admin={ADMIN}
        board={board([], "$0.00 of $50")}
        onOpenMate={nothing}
        pool={[PIM]}
        sources={NO_SOURCES}
        workingOf={working()}
      />
    ),
  },
  {
    id: "sources",
    title: "Several sources: seven, one not connected",
    view: (
      <ProjectAutomationView
        admin={ADMIN}
        board={board([SORT, IMAGES], "$6.44 of $50")}
        onOpenMate={nothing}
        pool={[SOL, PIM]}
        sources={SEVEN}
        workingOf={working()}
      />
    ),
  },
  {
    id: "asking",
    title: "Stop pressed: it asks in the row",
    view: (
      <ProjectAutomationView
        admin={ADMIN}
        board={board(BUSY_TASKS, "$7.94 of $50", {
          pressOf: (id) => (id === DATES.id ? { kind: "asking" } : { kind: "idle" }),
        })}
        onOpenMate={nothing}
        pool={BUSY_POOL}
        sources={SOURCES(1)}
        workingOf={working(SOL)}
      />
    ),
  },
  {
    id: "stopping",
    title: "A task stopping, a queued task's Stop refused",
    view: (
      <ProjectAutomationView
        admin={ADMIN}
        board={board(
          BUSY_TASKS.map((each) => (each === DATES ? { ...each, state: "stopping" } : each)),
          "$7.94 of $50",
          {
            pressOf: (id) =>
              id === "44"
                ? { kind: "refused", words: "Only an Owner or Admin can stop a task." }
                : { kind: "idle" },
          },
        )}
        onOpenMate={nothing}
        pool={BUSY_POOL}
        sources={SOURCES(1)}
        workingOf={working()}
      />
    ),
  },
  {
    id: "held",
    title: "A Mate held by its change: HQ gives Wren no task until it is merged or closed",
    view: (
      <ProjectAutomationView
        admin={ADMIN}
        board={board([PRICE, SORT, GUIDES], "$6.71 of $50", {
          live: new Map([["40", { id: "40", title: PRICE.title, url: null, done: true as const }]]),
          held: (projectId) => projectId === WREN.projectId,
        })}
        onOpenMate={nothing}
        pool={[SOL, { ...WREN, automation: { task: { title: PRICE.title, done: true } } }]}
        sources={SOURCES(0)}
        workingOf={working()}
      />
    ),
  },
  {
    id: "reading",
    title: "The board while it reads",
    view: (
      <ProjectAutomationView
        admin={ADMIN}
        board={{
          ...board([], "$7.94 of $50"),
          read: {
            state: "reading",
            predicted: { atWork: 2, queued: 2, recent: 3 },
          },
        }}
        onOpenMate={nothing}
        pool={BUSY_POOL}
        sources={SOURCES(1)}
        workingOf={working(SOL)}
      />
    ),
  },
  {
    id: "unread",
    title: "The board's read failed",
    view: (
      <ProjectAutomationView
        admin={ADMIN}
        board={{
          ...board([], "$7.94 of $50"),
          read: {
            state: "failed",
            words: "Couldn’t read its tasks: HQ is not answering right now.",
          },
        }}
        onOpenMate={nothing}
        pool={[SOL, PIM]}
        sources={SOURCES(0)}
        workingOf={working()}
      />
    ),
  },
  {
    id: "empty",
    title: "Nothing set up yet",
    view: (
      <ProjectAutomationView
        admin={ADMIN}
        onOpenMate={nothing}
        pool={[]}
        sources={NO_SOURCES}
        workingOf={working()}
      />
    ),
  },
  {
    id: "disconnected",
    title: "Slack not connected, a source's read failed",
    view: (
      <ProjectAutomationView
        admin={ADMIN}
        onOpenMate={nothing}
        pool={[WREN, BO]}
        sources={DISCONNECTED}
        workingOf={working()}
      />
    ),
  },
  {
    id: "sources-reading",
    title: "Its sources still read",
    view: (
      <ProjectAutomationView
        admin={ADMIN}
        onOpenMate={nothing}
        pool={[SOL]}
        sources={{ rows: [], reading: true, withheld: false }}
        workingOf={working()}
      />
    ),
  },
  {
    id: "update",
    title: "An HQ older than automated Mates",
    view: <ProjectAutomationView onOpenMate={nothing} pool={[]} sources={NO_SOURCES} update />,
  },
  {
    id: "member",
    title: "A member reads it",
    view: (
      <ProjectAutomationView
        board={{ ...board(BUSY_TASKS, "$7.94 of $50"), stop: undefined }}
        onOpenMate={nothing}
        pool={BUSY_POOL}
        sources={{ rows: SOURCES(1).rows.slice(0, 1), reading: false, withheld: true }}
        workingOf={working(SOL)}
      />
    ),
  },
];

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
  ["Starting", { ...AT, status: "starting", stoppable: true, workedMs: 0, spentUsd: 0 }],
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
  [
    "Closed",
    {
      ...AT,
      status: "closed",
      workedMs: 900_000,
      spentUsd: 0.66,
      change: { repo: "web", number: 1 },
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
        <AppChannelView
          choices={controls(
            known({
              bot: "mate",
              channels: [
                { id: "C0SUPPORT", name: "support" },
                { id: "C0ORDERS", name: "orders" },
              ],
            }),
          )}
          controls={controls(known({ channel: null }))}
          source="slack"
        />
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

/** The section as the project page holds it: under its label, flush on the page's card. */
function OnPage({ children }: { readonly children: ReactNode }) {
  return (
    <div className="pp-group">
      <SectionLabel>Automation</SectionLabel>
      <div className="pp-card pp-detail" data-flush="">
        {children}
      </div>
    </div>
  );
}

function Harness() {
  const states = STATE === null ? STATES : STATES.filter((state) => state.id === STATE);
  return (
    <div className={COLUMNS}>
      <div className="grid content-start gap-8">
        {states.map((state) => (
          <div className="grid content-start gap-3" data-state={state.id} key={state.id}>
            <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              {state.title}
            </h2>
            <OnPage>{state.view}</OnPage>
          </div>
        ))}
      </div>
      <Panel title="A task's session, in each state">
        <div className="grid max-w-3xl gap-3">
          {SESSIONS.map(([label, session]) => (
            <div className="grid gap-1" key={label}>
              <p className="text-xs text-muted-foreground">{label}</p>
              <MateTaskStatusView
                onStop={session.stoppable ? nothing : undefined}
                session={session}
              />
              <MateTaskCardView onOpenChange={nothing} session={session} task={ISSUE} />
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
    <StrictMode>{MERGING === null ? <Harness /> : <MergingHarness show={MERGING} />}</StrictMode>,
  );
}
