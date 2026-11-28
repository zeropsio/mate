/**
 * What sets up and shows automated Mates outside the menu, in each of its states: Settings ›
 * Zerops › HQ's organization API key and Tasks from GitHub, and a task's session over its
 * its session.
 *
 * Served by the dev server at `/design-automated.html` (`?theme=dark`). Open it at the owner's
 * 1786 × 1000. The menu's automated rows are the sidebar harness's Tea Shop; the New Mate
 * dialog's choice is `/design-newmate.html?automated=missing`. `?settle=pending` and
 * `?settle=landed` draw the sources besides GitHub while read and once read, as an unconnected
 * organization's: their sections stand at the same tops in both. `?unit=column` draws a task
 * conversation's column, its rows in the timeline's own frame (`taskColumnHarness`); `?unit=bar`
 * (`&task=taken|automated`, `&scrolled`) a task's conversation with its card and its bar.
 *
 * Fixtures only. Nothing here ships — `design-automated.html` is not `index.html`, and no route
 * imports this module.
 */
import type {
  AppIntakeRead,
  OrgAiKeysRead,
  TaskSourceSettingValue,
} from "@t3tools/client-runtime/data";
import type { FlowPullRequest } from "@t3tools/client-runtime/zerops";
import type { MateTaskSource } from "@t3tools/contracts";
import type { HqWebhookView } from "@t3tools/shared/hqIntake";
import { OPENCODE_KEY_PROVIDERS } from "@t3tools/shared/openCodeKeyProviders";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  Link,
  RouterProvider,
} from "@tanstack/react-router";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { AppIntakeView, OrganizationKeyView } from "~/components/settings/AutomatedMatesSettings";
import { SettingsSection } from "~/components/settings/settingsLayout";
import {
  AppChannelView,
  AppSchedulesView,
  AppWebhooksView,
  DiscordSettingsView,
  SchedulesSettingsView,
  SlackSettingsView,
  TaskLimitsView,
  WebhooksSettingsView,
} from "~/components/settings/TaskSourcesSettings";
import {
  MateTaskBarView,
  MateTaskCardView,
  MateTaskMessageRowView,
  TaskQuestionView,
} from "~/components/zerops/MateTaskCard";
import { Button } from "~/components/ui/button";
import { taskMessageOrigin } from "~/components/zerops/mateTaskMessage.logic";
import { MateFace } from "~/components/zerops/primitives";
import { changeReviewItem, HeaderReviewDoor } from "~/components/zerops/SidebarProjectReview";
import type { TaskSession } from "~/zerops/taskSession.logic";
import { BarFrame, TaskBarColumn, TaskColumn } from "./taskColumnHarness";
import "../index.css";

const params = new URLSearchParams(location.search);
const NEBIUS = OPENCODE_KEY_PROVIDERS[0]!;
// Built from parts: never a whole secret-shaped literal in the source.
const SECRET = ["whsec", "3f9a", "tea", "shop", "c1d2"].join("_");

const TEA_ISSUE = {
  kind: "github-issue",
  repo: "acme/tea-shop",
  number: 12,
  url: "https://github.com/acme/tea-shop/issues/12",
  title: "Fix the checkout total",
  author: "nova-dev",
} as const;

const DISCORD_ASK = {
  kind: "discord-thread",
  server: "Acme",
  channel: "tasks",
  url: "https://discord.com/channels/1/2/3",
  title: "redeisgn footer",
  author: "erza",
} as const;

/** An automated Mate's one conversation: each task's card at its turn's start, its run after. */
const ONE_CONVERSATION: ReadonlyArray<{
  readonly task: MateTaskSource;
  readonly text: string;
  readonly session: TaskSession;
  readonly reply: string | null;
}> = [
  {
    task: { ...TEA_ISSUE, number: 9, title: "Show the tea's origin", author: "juno" },
    text: "Each tea's page should say where it was grown.",
    session: {
      status: "merged",
      taskId: "task-9",
      stoppable: false,
      workedMs: 1_260_000,
      spentUsd: 0.88,
      change: { repo: "web", number: 2 },
      pullRequest: { number: 7, url: "https://github.com/acme/tea-shop/pull/7", state: "merged" },
    },
    reply: "The origin now shows under each tea's name, read from the catalog. PR #7 is merged.",
  },
  {
    task: {
      kind: "slack-thread",
      workspace: "Tea Shop",
      channel: "support",
      url: "https://tea-shop.slack.com/archives/C1/p2",
      title: "The receipt email shows the wrong address",
      author: "Ines",
    },
    text: "Receipts still show the old warehouse address.",
    session: {
      status: "review",
      taskId: "task-11",
      stoppable: false,
      workedMs: 540_000,
      spentUsd: 0.31,
      change: { repo: "web", number: 3 },
      pullRequest: {
        number: 8,
        url: "https://github.com/acme/tea-shop/pull/8",
        state: "open",
        checks: "passing",
      },
    },
    reply:
      "The receipt template reads the shop's address from settings now. PR #8 waits for review.",
  },
  {
    task: TEA_ISSUE,
    text: "The checkout total skips the tax line when the cart holds a gift card.",
    session: {
      status: "working",
      taskId: "task-12",
      stoppable: true,
      workedMs: 154_000,
      spentUsd: 0.09,
      change: null,
      pullRequest: null,
    },
    reply: null,
  },
];

const KEY_UNSET: OrgAiKeysRead = {
  keys: {
    state: "known",
    keys: [{ provider: "nebius", set: false, setAt: null, setBy: null }],
    stale: false,
  },
  action: { kind: "idle" },
};
const KEY_SET: OrgAiKeysRead = {
  keys: {
    state: "known",
    keys: [{ provider: "nebius", set: true, setAt: "2026-10-17T09:00:00.000Z", setBy: null }],
    stale: false,
  },
  action: { kind: "idle" },
};
const NONE: AppIntakeRead = { intake: null, action: { kind: "idle" }, answer: null };
const TAKING: AppIntakeRead = {
  intake: { repo: "acme/tea-shop", label: "mate", waiting: 3 },
  action: { kind: "done", verb: "set" },
  answer: null,
};
const PASTE: AppIntakeRead = {
  ...TAKING,
  answer: {
    appId: "tea-shop",
    repo: "acme/tea-shop",
    label: "mate",
    public: false,
    webhookUrl: "https://hq-acme.zerops.app/api/github/webhook",
    hook: {
      kind: "paste",
      secret: SECRET,
      why: "Mate's token for acme/tea-shop may not make webhooks, so paste this one into the repository's settings.",
    },
  },
};
const MADE: AppIntakeRead = {
  ...TAKING,
  answer: { ...PASTE.answer!, hook: { kind: "made" } },
};

const nothing = () => {};

/** A part's controls over a fixture of what is read; its presses do nothing. */
const controls = (setting: unknown, revealed: HqWebhookView | null = null) => ({
  read: { setting, action: { kind: "idle" }, revealed } as TaskSourceSettingValue<never>,
  write: nothing,
  again: nothing,
});
const known = (value: unknown) => ({ state: "known", held: value, stale: false });
const APPS = [
  { id: "tea-shop", name: "Tea Shop" },
  { id: "shop-front", name: "Shop Front" },
];
const SLACK_OFF = {
  connected: false,
  workspace: null,
  eventsUrl: "https://hq-acme.zerops.app/api/intake/slack/acme",
};
const DISCORD_OFF = {
  connected: false,
  interactionsUrl: "https://hq-acme.zerops.app/api/intake/discord/acme",
  inviteUrl: null,
};
const HOOK = {
  id: "w1",
  name: "Sentry",
  url: "https://hq-acme.zerops.app/api/intake/webhook/9f2c41",
  createdAt: "2026-10-17T09:00:00.000Z",
};

function Panel({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="grid gap-2">
      <h2 className="text-caption font-medium text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}

const RAYA = { name: "Raya", tint: "amber", shape: "clover" } as const;

/** A change of Raya's waiting for review, as the menu hands it to the app bar's Review. */
const rayaChange = (number: number, title: string) =>
  changeReviewItem({
    pull: {
      repository: "web",
      number,
      title,
      kind: "code",
      mateProjectId: "mate-raya",
    } as unknown as FlowPullRequest,
    among: [],
    groupId: "tea-shop",
    by: RAYA,
    mine: true,
  });

const RAYA_CHANGES = [
  rayaChange(7, "Show the tea's origin"),
  rayaChange(8, "Add a Back to top link in the footer"),
];

const doorOf = (items: ReadonlyArray<ReturnType<typeof rayaChange>>) => ({
  review: { groupId: "tea-shop", projectName: "Tea Shop", items, release: undefined },
  held: false,
});

const UP_FOR_REVIEW: TaskSession = {
  status: "review",
  taskId: "task-8",
  stoppable: false,
  workedMs: 420_000,
  spentUsd: 0.31,
  change: { repo: "web", number: 8 },
  pullRequest: null,
};

/** Raya's task up for review: its change is the app bar Review's first. */
const FOOTER_ISSUE: MateTaskSource = {
  ...TEA_ISSUE,
  number: 8,
  title: "Add a Back to top link in the footer",
};

/** A task put on the Board that Raya finished: done, with its change waiting in Review. */
const BANNER_TASK: MateTaskSource = {
  kind: "board",
  putBy: "u-ales",
  title: "Pick a number for the welcome banner",
};
const DONE_TASK: TaskSession = { ...UP_FOR_REVIEW, status: "done", taskId: "task-31" };

/** Who reads the harness: their own answer says You. */
const VIEWER = ["Ales Rechtorik"];
const IDA_COMMENT = {
  id: "c1",
  from: "comment",
  author: "ida-ops",
  text: "Keep the old rounding for invoices, only the cart total changes.",
} as const;
/** The reader's own answer, given on the Board's panel of the task. */
const OWN_ANSWER = { id: "c2", from: "reply", author: "Ales Rechtorik", text: "2" } as const;

/** The conversation's app bar as far as its Mate's line goes: face, name, then what follows it. */
function AppBar({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex h-13 items-center gap-2 border-b border-border px-4 text-line">
      <MateFace shape={RAYA.shape} size={24} state="needs" tint={RAYA.tint} />
      <span className="font-medium">Raya ▾</span>
      {children}
    </div>
  );
}

function Harness() {
  return (
    <div className="grid min-h-screen grid-cols-2 gap-8 bg-background p-8 text-foreground">
      <div className="grid content-start gap-6">
        <Panel title="Settings › Zerops › HQ">
          <SettingsSection title="HQ">
            <OrganizationKeyView
              onAgain={nothing}
              onRemove={nothing}
              onSet={nothing}
              provider={NEBIUS}
              read={KEY_UNSET}
            />
            <OrganizationKeyView
              onAgain={nothing}
              onRemove={nothing}
              onSet={nothing}
              provider={NEBIUS}
              read={KEY_SET}
            />
            <ul className="grid gap-4 px-3 pb-3 sm:px-4">
              <AppIntakeView
                appId="tea-shop"
                choices={["acme/tea-shop"]}
                name="Tea Shop"
                onSet={nothing}
                onStop={nothing}
                read={NONE}
                reposRead
              />
              <AppIntakeView
                appId="tea-shop-paste"
                choices={["acme/tea-shop"]}
                name="Tea Shop — set, to paste"
                onSet={nothing}
                onStop={nothing}
                read={PASTE}
                reposRead
              />
              <AppIntakeView
                appId="tea-shop-made"
                choices={["acme/tea-shop"]}
                name="Tea Shop — set, webhook made"
                onSet={nothing}
                onStop={nothing}
                read={MADE}
                reposRead
              />
              <AppIntakeView
                appId="shop-front"
                choices={[]}
                name="Shop Front — its repositories not read"
                onReadAgain={nothing}
                onSet={nothing}
                onStop={nothing}
                read={NONE}
                reposFailure="HQ is not answering right now."
                reposRead={false}
              />
              <AppIntakeView
                appId="notes"
                choices={[]}
                name="Notes — no GitHub mirror"
                onSet={nothing}
                onStop={nothing}
                read={NONE}
                reposRead
              />
            </ul>
          </SettingsSection>
        </Panel>
      </div>
      <div className="grid content-start gap-6">
        <Panel title="The app bar's Review: any Mate's, a task's conversation's too">
          <div className="grid max-w-2xl gap-3" data-harness="app-bar-review">
            <AppBar>
              <HeaderReviewDoor {...doorOf(RAYA_CHANGES.slice(1))} />
            </AppBar>
            <AppBar>
              <HeaderReviewDoor {...doorOf(RAYA_CHANGES)} />
            </AppBar>
          </div>
        </Panel>
        <Panel title="A task's bar over its conversation, once its card scrolled away">
          <div className="grid max-w-2xl gap-3" data-harness="task-bars">
            <BarFrame>
              <MateTaskBarView
                acts={{ board: { groupId: "tea-shop", taskId: "task-8" } }}
                session={UP_FOR_REVIEW}
                task={FOOTER_ISSUE}
              />
            </BarFrame>
            <BarFrame>
              <MateTaskBarView
                acts={{ board: { groupId: "tea-shop", taskId: "task-31" } }}
                session={{ ...DONE_TASK, change: null }}
                task={BANNER_TASK}
              />
            </BarFrame>
            <BarFrame>
              <MateTaskBarView
                acts={{ board: { groupId: "tea-shop", taskId: "task-12" }, onStop: nothing }}
                session={{ ...UP_FOR_REVIEW, status: "waiting", stoppable: true, change: null }}
                task={TEA_ISSUE}
              />
            </BarFrame>
          </div>
        </Panel>
        <Panel title="One conversation, a turn per task: two finished, one at work">
          <div className="grid max-w-2xl gap-3">
            {/* The bar follows the conversation's current task. */}
            <BarFrame>
              <MateTaskBarView
                acts={{ board: null, onStop: nothing }}
                session={ONE_CONVERSATION[2]!.session}
                task={ONE_CONVERSATION[2]!.task}
              />
            </BarFrame>
            {ONE_CONVERSATION.map(({ task, text, session, reply }) => (
              <div className="grid gap-3" key={session.taskId}>
                <MateTaskCardView
                  onOpenChange={nothing}
                  session={session}
                  task={task}
                  text={text}
                />
                {reply === null ? null : <p className="px-1 text-prose text-foreground">{reply}</p>}
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="A task's session, its ask, and a follow-up">
          <div className="grid max-w-2xl gap-3">
            <MateTaskCardView
              acts={{ board: { groupId: "tea-shop", taskId: "task-12" }, onStop: nothing }}
              onOpenChange={nothing}
              session={{
                status: "working",
                taskId: "task-12",
                stoppable: true,
                workedMs: 754_000,
                spentUsd: 0.42,
                change: { repo: "web", number: 3 },
                pullRequest: null,
              }}
              task={TEA_ISSUE}
              text={[
                "The checkout total skips the tax line when the cart holds a gift card.",
                "",
                "Steps: add two teas and a gift card, open checkout, compare the total with the sum of the lines.",
                "Expected: the total includes 21 % VAT on the teas, never on the gift card.",
                "Actual: the total is the lines' sum without any tax.",
                "",
                "It started after Tuesday's deploy; the invoices still look right, only the cart is off.",
                "Juno saw it on a phone too, so it is not the browser.",
              ].join("\n")}
            />
            <MateTaskCardView
              task={{
                kind: "slack-thread",
                workspace: "Acme",
                channel: "support",
                url: "https://acme.slack.com/archives/C1/p1",
                title: "Can the shop show prices with tax?",
                author: "Raya",
              }}
              text="Can the shop show prices with tax on the product page?"
            />
            {/* A chat ask's title is its first line: the card says the ask once. */}
            <MateTaskCardView task={DISCORD_ASK} text="redeisgn footer" />
            <MateTaskCardView
              task={{ ...DISCORD_ASK, title: "redesign footer" }}
              text={"redesign footer\nkeep the logo on the left\nmatch the header's spacing"}
            />
            {/* The Mate asking, while its task waits on the answer. */}
            <TaskQuestionView
              answer={
                <Button
                  render={
                    <Link
                      params={{ groupId: "tea-shop" }}
                      search={{ task: "task-31" }}
                      to="/group/$groupId/board"
                    />
                  }
                  size="sm"
                  variant="secondary"
                >
                  Answer on the Board
                </Button>
              }
              mateName="Raya"
              question="Which number do you prefer, 1 or 2?"
            />
            <MateTaskMessageRowView
              message={IDA_COMMENT}
              origin={taskMessageOrigin(IDA_COMMENT, TEA_ISSUE, VIEWER)}
            />
            <MateTaskMessageRowView
              board={{ groupId: "tea-shop", taskId: "task-31" }}
              message={OWN_ANSWER}
              origin={taskMessageOrigin(OWN_ANSWER, BANNER_TASK, VIEWER)}
            />
          </div>
        </Panel>
        <Panel title="Settings › Zerops › HQ — tasks from elsewhere">
          <SettingsSection title="HQ">
            <SlackSettingsView
              controls={controls(known(SLACK_OFF))}
              manifest={controls(known("{}"))}
            />
            <SlackSettingsView
              controls={controls(known({ ...SLACK_OFF, connected: true, workspace: "Acme" }))}
            />
            <DiscordSettingsView controls={controls(known(DISCORD_OFF))} />
            <DiscordSettingsView
              controls={controls(
                known({
                  ...DISCORD_OFF,
                  connected: true,
                  inviteUrl: "https://discord.com/oauth2/authorize?client_id=1",
                }),
              )}
            />
            <WebhooksSettingsView apps={APPS}>
              {(app) => (
                <AppWebhooksView
                  controls={
                    app.id === "tea-shop"
                      ? controls(known([HOOK]), { ...HOOK, secret: SECRET })
                      : controls(known([]))
                  }
                  name={app.name}
                />
              )}
            </WebhooksSettingsView>
            <SchedulesSettingsView apps={APPS.slice(0, 1)}>
              {(app) => (
                <AppSchedulesView
                  controls={controls(
                    known([
                      {
                        id: "s1",
                        name: "Weekly upkeep",
                        brief: "Update the dependencies and open a change.",
                        rule: { every: "week", day: 1, at: "09:00", timeZone: "Europe/Prague" },
                        nextAt: "2026-10-19T07:00:00.000Z",
                      },
                    ]),
                  )}
                  name={app.name}
                />
              )}
            </SchedulesSettingsView>
            <TaskLimitsView
              controls={controls(
                known({
                  minutes: 60,
                  costUsd: 5,
                  monthlyBudgetUsd: null,
                  spentThisMonthUsd: 0,
                  model: "nebius/zai-org/GLM-5.3",
                }),
              )}
            />
          </SettingsSection>
        </Panel>
        <Panel title="Tasks from elsewhere — reading">
          <SettingsSection title="HQ">
            <SlackSettingsView controls={controls({ state: "reading" })} />
            <ul className="grid gap-3 px-3 pb-3 sm:px-4">
              <AppChannelView controls={controls({ state: "reading" })} source="slack" />
            </ul>
          </SettingsSection>
        </Panel>
      </div>
    </div>
  );
}

/** The sources besides GitHub while read, or once read, for their sections' tops to be compared. */
function Settle({ landed }: { readonly landed: boolean }) {
  const at = (value: unknown) => controls(landed ? known(value) : { state: "reading" });
  return (
    <div className="max-w-4xl bg-background p-8 text-foreground">
      <SettingsSection title="HQ">
        <SlackSettingsView controls={at(SLACK_OFF)} manifest={controls(known("{}"))} />
        <DiscordSettingsView controls={at({ ...DISCORD_OFF, interactionsUrl: "" })} />
        <WebhooksSettingsView apps={APPS}>
          {(app) => <AppWebhooksView controls={at([])} name={app.name} />}
        </WebhooksSettingsView>
        <SchedulesSettingsView apps={APPS}>
          {(app) => <AppSchedulesView controls={at([])} name={app.name} />}
        </SchedulesSettingsView>
        <TaskLimitsView controls={at({ minutes: 60, costUsd: null })} />
      </SettingsSection>
    </div>
  );
}

const settle = params.get("settle");
const unit = params.get("unit");

function Page() {
  if (unit === "column") return <TaskColumn />;
  if (unit === "bar")
    return (
      <TaskBarColumn
        kind={
          params.get("task") === "automated"
            ? "automated"
            : params.get("task") === "two"
              ? "two"
              : "taken"
        }
        scrolled={params.has("scrolled")}
      />
    );
  return settle === null ? <Harness /> : <Settle landed={settle === "landed"} />;
}

// The links the task's surfaces draw (to its Board) need a router; nothing here navigates.
const router = createRouter({
  routeTree: createRootRoute({ component: Page }),
  history: createMemoryHistory({ initialEntries: ["/"] }),
});

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
