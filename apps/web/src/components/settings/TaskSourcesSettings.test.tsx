/**
 * Settings › Zerops › HQ's sources besides GitHub, from what is read: Slack, Discord, an
 * application's webhooks and schedules, and the limits on each task, in the states they can be in.
 */
import type { AppIntakeRead, TaskSourceSettingValue } from "@t3tools/client-runtime/data";
import type { HqWebhookView } from "@t3tools/shared/hqIntake";
import { act, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestInstance } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import { Input } from "../ui/input";
import { AppIntakeView } from "./AutomatedMatesSettings";
import {
  AppSchedulesView,
  AppWebhooksView,
  DiscordSettingsView,
  SlackSettingsView,
  TaskLimitsView,
  TaskSourcesUnsupported,
} from "./TaskSourcesSettings";

// Built from parts: never a whole secret-shaped literal in the source.
const SECRET = ["whsec", "tea", "shop", "0007"].join("_");
const BOT_TOKEN = ["xoxb", "1111", "teashop"].join("-");
const SIGNING = ["sign", "tea", "shop"].join("_");
const APPS = [{ id: "tea-shop", name: "Tea Shop" }];

/** A part's controls over a fixture of what is read: its writes and reads again recorded. */
function controls(setting: unknown, over: { readonly revealed?: HqWebhookView | null } = {}) {
  return {
    read: {
      setting,
      action: { kind: "idle" },
      revealed: over.revealed ?? null,
    } as TaskSourceSettingValue<never>,
    write: vi.fn(),
    again: vi.fn(),
  };
}

const known = (value: unknown) => ({ state: "known", value, stale: false });

/** The words a markup carries. */
const shown = (html: string) =>
  html
    .replace(/<[^>]+>/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

function rendered(element: ReactElement) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  let tree: ReturnType<typeof create> | undefined;
  act(() => {
    tree = create(element);
  });
  return {
    root: tree!.root,
    type: (node: ReactTestInstance, value: string) => {
      act(() => {
        node.props.onChange({ target: { value } });
      });
    },
    submit: () => {
      act(() => {
        tree!.root.findByType("form").props.onSubmit({ preventDefault: () => {} });
      });
    },
    unmount: () => {
      act(() => {
        tree!.unmount();
      });
    },
  };
}

const slackOff = { connected: false, workspace: null, eventsUrl: "https://hq.example/slack" };

describe("Slack in Settings", () => {
  it("walks an organization with no Slack app through making one from HQ's manifest", () => {
    const html = renderToStaticMarkup(
      <SlackSettingsView
        apps={APPS}
        controls={controls(known(slackOff))}
        manifest={controls(known('{"display_information":{}}'))}
      />,
    );
    expect(shown(html)).toContain("Create a Slack app from this manifest.");
    expect(shown(html)).toContain("Copy manifest");
    expect(html).toContain('href="https://api.slack.com/apps?new_app=1"');
    expect(shown(html)).toContain("Install it to your workspace.");
    expect(shown(html)).toContain("Bot token");
    expect(shown(html)).toContain("Signing secret");
  });

  it("connects with the bot token and signing secret typed, and clears both fields", () => {
    const slack = controls(known(slackOff));
    const view = rendered(
      <SlackSettingsView apps={APPS} controls={slack} manifest={controls(known("{}"))} />,
    );
    const [token, signing] = view.root
      .findAllByType(Input)
      .filter((node) => node.props.type === "password");
    view.type(token!, BOT_TOKEN);
    view.type(signing!, SIGNING);
    view.submit();
    expect(slack.write).toHaveBeenCalledWith(
      { kind: "slack-connect" },
      { botToken: BOT_TOKEN, signingSecret: SIGNING },
    );
    const after = view.root.findAllByType(Input).filter((node) => node.props.type === "password");
    expect(after.map((node) => node.props.value)).toEqual(["", ""]);
    view.unmount();
  });

  it("says which workspace it is connected to, and the channel each application takes tasks from", () => {
    const html = renderToStaticMarkup(
      <SlackSettingsView
        apps={APPS}
        channel={() =>
          controls(known({ channel: { appId: "tea-shop", channelId: "C042", channel: "support" } }))
        }
        controls={controls(known({ ...slackOff, connected: true, workspace: "Acme" }))}
      />,
    );
    expect(shown(html)).toContain("Connected to Acme");
    expect(shown(html)).toContain("Disconnect");
    expect(shown(html)).toContain("Takes tasks from #support");
    expect(shown(html)).toContain("Stop");
  });

  it("asks an application with no channel for one by its ID", () => {
    const html = renderToStaticMarkup(
      <SlackSettingsView
        apps={APPS}
        channel={() => controls(known({ channel: null }))}
        controls={controls(known({ ...slackOff, connected: true, workspace: "Acme" }))}
      />,
    );
    expect(shown(html)).toContain("Channel ID, from the channel&#x27;s details");
    expect(shown(html)).toContain("Take tasks");
  });

  // The owner's cardinal sin: a part that reads first and answers later must not grow.
  it("holds the form's room while it is read", () => {
    const html = renderToStaticMarkup(
      <SlackSettingsView apps={APPS} controls={controls({ state: "reading" })} />,
    );
    expect(html).toContain("data-zerops-intake-room");
    expect(shown(html)).toContain("Reading…");
  });

  it("asks for an update where HQ predates these settings", () => {
    expect(shown(renderToStaticMarkup(<TaskSourcesUnsupported />))).toBe(
      "Update HQ to take tasks from Slack, Discord, webhooks and schedules.",
    );
  });
});

describe("Discord in Settings", () => {
  const off = {
    connected: false,
    interactionsUrl: "https://hq.example/api/intake/discord/acme",
    inviteUrl: null,
    allowed: [],
  };

  it("walks an organization with no Discord application through connecting one, with its endpoint URL", () => {
    const html = renderToStaticMarkup(
      <DiscordSettingsView apps={APPS} controls={controls(known(off))} />,
    );
    expect(html).toContain('href="https://discord.com/developers/applications"');
    expect(shown(html)).toContain("Application ID");
    expect(shown(html)).toContain("Public key");
    expect(shown(html)).toContain("Bot token");
    expect(shown(html)).toContain("https://hq.example/api/intake/discord/acme");
  });

  it("shows a connected application's invite link and who may use it", () => {
    const html = renderToStaticMarkup(
      <DiscordSettingsView
        apps={APPS}
        channel={() => controls(known({ channel: null }))}
        controls={controls(
          known({
            ...off,
            connected: true,
            inviteUrl: "https://discord.com/oauth2/authorize?client_id=1",
            allowed: ["123456789012345678"],
          }),
        )}
      />,
    );
    expect(shown(html)).toContain("Add the bot to a server");
    expect(shown(html)).toContain("123456789012345678");
    expect(shown(html)).toContain("Remove");
  });

  it("says nobody may start a task while the allowlist is empty", () => {
    const html = renderToStaticMarkup(
      <DiscordSettingsView
        apps={APPS}
        channel={() => controls(known({ channel: null }))}
        controls={controls(known({ ...off, connected: true }))}
      />,
    );
    expect(shown(html)).toContain("Nobody may start a task yet");
  });
});

describe("an application's webhooks and schedules in Settings", () => {
  const hook = {
    id: "w1",
    name: "Sentry",
    url: "https://hq.example/api/intake/webhook/w1",
    createdAt: "2026-10-17T09:00:00.000Z",
  };

  it("shows a webhook's secret as it is made, and never in its list", () => {
    const made = renderToStaticMarkup(
      <AppWebhooksView
        controls={controls(known([hook]), { revealed: { ...hook, secret: SECRET } })}
        name="Tea Shop"
      />,
    );
    expect(made).toContain(SECRET);
    expect(shown(made)).toContain("Its secret is shown once");
    const listed = renderToStaticMarkup(
      <AppWebhooksView controls={controls(known([hook]))} name="Tea Shop" />,
    );
    expect(listed).not.toContain(SECRET);
    expect(shown(listed)).toContain("Sentry");
    expect(shown(listed)).toContain("Delete");
  });

  it("lists a schedule by how often it runs and when it runs next", () => {
    const html = renderToStaticMarkup(
      <AppSchedulesView
        controls={controls(
          known([
            {
              id: "s1",
              name: "Weekly upkeep",
              brief: "Update the dependencies.",
              rule: { every: "week", day: 1, at: "09:00", timeZone: "Europe/Prague" },
              nextAt: null,
            },
          ]),
        )}
        name="Tea Shop"
      />,
    );
    expect(shown(html)).toContain("Weekly upkeep");
    expect(shown(html)).toContain("Every Monday at 09:00, Europe/Prague · Paused");
  });
});

describe("the limits on each task in Settings", () => {
  it("says the limits HQ holds and saves what is typed", () => {
    const limits = controls(known({ minutes: 60, costUsd: null }));
    expect(shown(renderToStaticMarkup(<TaskLimitsView controls={limits} />))).toContain(
      "A task stops after 60 minutes of work.",
    );
    const view = rendered(<TaskLimitsView controls={limits} />);
    const [minutes, cost] = view.root.findAllByType(Input);
    view.type(minutes!, "30");
    view.type(cost!, "5");
    view.submit();
    expect(limits.write).toHaveBeenCalledWith({
      kind: "task-limits",
      limits: { minutes: 30, costUsd: 5 },
    });
    view.unmount();
  });
});

describe("taking a public repository's issues", () => {
  const NONE: AppIntakeRead = { intake: null, action: { kind: "idle" }, answer: null };

  it.each([
    { case: "asked to", tick: true },
    { case: "left off, as it starts", tick: false },
  ])("an intake set with the box $case says so", ({ tick }) => {
    const onSet = vi.fn();
    const view = rendered(
      <AppIntakeView
        appId="tea-shop"
        choices={["acme/tea-shop"]}
        name="Tea Shop"
        onSet={onSet}
        onStop={() => {}}
        read={NONE}
        reposRead
      />,
    );
    const box = view.root.find(
      (node) => typeof node.props.onCheckedChange === "function" && node.props.checked === false,
    );
    if (tick)
      act(() => {
        box.props.onCheckedChange(true);
      });
    view.submit();
    expect(onSet).toHaveBeenCalledWith("acme/tea-shop", "mate", tick);
    view.unmount();
  });
});
