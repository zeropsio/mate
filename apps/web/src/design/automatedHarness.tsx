/**
 * What sets up and shows automated Mates outside the menu, in each of its states: Settings ›
 * Zerops › HQ's organization API key and Tasks from GitHub, and a task's session over its
 * its session.
 *
 * Served by the dev server at `/design-automated.html` (`?theme=dark`). Open it at the owner's
 * 1786 × 1000. The menu's automated rows are the sidebar harness's Tea Shop; the New Mate
 * dialog's choice is `/design-newmate.html?automated=missing`. `?settle=pending` and
 * `?settle=landed` draw the sources besides GitHub while read and once read, as an unconnected
 * organization's: their sections stand at the same tops in both.
 *
 * Fixtures only. Nothing here ships — `design-automated.html` is not `index.html`, and no route
 * imports this module.
 */
import type {
  AppIntakeRead,
  OrgAiKeysRead,
  TaskSourceSettingValue,
} from "@t3tools/client-runtime/data";
import type { HqWebhookView } from "@t3tools/shared/hqIntake";
import { OPENCODE_KEY_PROVIDERS } from "@t3tools/shared/openCodeKeyProviders";
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import {
  AppIntakeView,
  AutomatedMatesUnsupported,
  OrganizationKeyView,
} from "~/components/settings/AutomatedMatesSettings";
import { SettingsSection } from "~/components/settings/settingsLayout";
import {
  AppChannelView,
  AppSchedulesView,
  AppWebhooksView,
  DiscordSettingsView,
  SchedulesSettingsView,
  SlackSettingsView,
  TaskLimitsView,
  TaskSourcesUnsupported,
  WebhooksSettingsView,
} from "~/components/settings/TaskSourcesSettings";
import { MateTaskMessageRow, MateTaskSessionBar } from "~/components/zerops/MateTaskCard";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const NEBIUS = OPENCODE_KEY_PROVIDERS[0]!;
// Built from parts: never a whole secret-shaped literal in the source.
const SECRET = ["whsec", "3f9a", "tea", "shop", "c1d2"].join("_");

const KEY_UNSET: OrgAiKeysRead = {
  keys: { state: "known", keys: [{ provider: "nebius", set: false, setAt: null }], stale: false },
  action: { kind: "idle" },
};
const KEY_SET: OrgAiKeysRead = {
  keys: {
    state: "known",
    keys: [{ provider: "nebius", set: true, setAt: "2026-10-17T09:00:00.000Z" }],
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
  allowed: [],
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
      <h2 className="text-xs font-medium text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
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
        <Panel title="Settings › Zerops › HQ — an HQ older than automated Mates">
          <SettingsSection title="HQ">
            <AutomatedMatesUnsupported />
          </SettingsSection>
        </Panel>
      </div>
      <div className="grid content-start gap-6">
        <Panel title="A task's session, and a follow-up">
          <div className="grid max-w-2xl gap-3">
            <MateTaskSessionBar
              onStop={nothing}
              session={{
                status: "working",
                taskId: "task-12",
                stoppable: true,
                workedMs: 754_000,
                spentUsd: 0.42,
                change: null,
                pullRequest: null,
              }}
              task={{
                kind: "github-issue",
                repo: "acme/tea-shop",
                number: 12,
                url: "https://github.com/acme/tea-shop/issues/12",
                title: "Fix the checkout total",
                author: "nova-dev",
              }}
            />
            <MateTaskMessageRow
              message={{
                id: "c1",
                from: "comment",
                author: "ida-ops",
                text: "Keep the old rounding for invoices, only the cart total changes.",
              }}
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
                  allowed: ["123456789012345678"],
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
            <TaskLimitsView controls={controls(known({ minutes: 60, costUsd: 5 }))} />
          </SettingsSection>
        </Panel>
        <Panel title="Tasks from elsewhere — reading, and an older HQ">
          <SettingsSection title="HQ">
            <SlackSettingsView controls={controls({ state: "reading" })} />
            <ul className="grid gap-3 px-3 pb-3 sm:px-4">
              <AppChannelView controls={controls({ state: "reading" })} source="slack" />
            </ul>
            <TaskSourcesUnsupported />
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

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      {settle === null ? <Harness /> : <Settle landed={settle === "landed"} />}
    </StrictMode>,
  );
}
