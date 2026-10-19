/**
 * Settings › Zerops › HQ's sources besides GitHub, from what is read: Slack, Discord, an
 * application's webhooks and schedules, and the limits on each task, in the states they can be in.
 */
import type { AppIntakeRead, TaskSourceSettingValue } from "@t3tools/client-runtime/data";
import type { HqWebhookView } from "@t3tools/shared/hqIntake";
import { OPENCODE_KEY_PROVIDERS } from "@t3tools/shared/openCodeKeyProviders";
import { act, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { create, type ReactTestInstance } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { RadioGroup } from "../ui/radio-group";
import { AppIntakeView } from "./AutomatedMatesSettings";
import {
  AppChannelView,
  AppSchedulesView,
  AppWebhooksView,
  AutomatedModelView,
  DiscordSettingsView,
  SlackSettingsView,
  MonthlyBudgetView,
  TaskLimitsView,
  TaskSourcesUnsupported,
} from "./TaskSourcesSettings";

// Built from parts: never a whole secret-shaped literal in the source.
const SECRET = ["whsec", "tea", "shop", "0007"].join("_");
const BOT_TOKEN = ["xoxb", "1111", "teashop"].join("-");
const SIGNING = ["sign", "tea", "shop"].join("_");

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

const known = (value: unknown) => ({ state: "known", held: value, stale: false });

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
    update: (next: ReactElement) => {
      act(() => {
        tree!.update(next);
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
        controls={controls(known(slackOff))}
        defaultOpen
        manifest={controls(known('{"display_information":{}}'))}
      />,
    );
    expect(shown(html)).toContain("Create the Slack app");
    expect(shown(html)).toContain("Copy manifest");
    expect(html).toContain(
      `href="https://api.slack.com/apps?new_app=1&amp;manifest_json=${encodeURIComponent('{"display_information":{}}')}"`,
    );
    expect(shown(html)).toContain("Install it to your workspace");
    expect(shown(html)).toContain("Bot token");
    expect(shown(html)).toContain("Signing secret");
  });

  it("connects with the bot token and signing secret typed, and clears both fields", () => {
    const slack = controls(known(slackOff));
    const view = rendered(
      <SlackSettingsView controls={slack} defaultOpen manifest={controls(known("{}"))} />,
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
    // Cleared once HQ took them.
    for (const action of [
      { kind: "working", verb: "slack-connect" },
      { kind: "done", verb: "slack-connect" },
    ]) {
      view.update(
        <SlackSettingsView
          controls={{ ...slack, read: { ...slack.read, action } as TaskSourceSettingValue<never> }}
          defaultOpen
          manifest={controls(known("{}"))}
        />,
      );
    }
    const after = view.root.findAllByType(Input).filter((node) => node.props.type === "password");
    expect(after.map((node) => node.props.value)).toEqual(["", ""]);
    view.unmount();
  });

  it("shows the address Slack sends its requests to before anything is connected, with its Copy", () => {
    const html = renderToStaticMarkup(
      <SlackSettingsView
        controls={controls(known(slackOff))}
        defaultOpen
        manifest={controls({ state: "reading" })}
      />,
    );
    expect(shown(html)).toMatch(/Request URL https:\/\/hq\.example\/slack (Copied )?Copy/u);
  });

  it("says why HQ's manifest is not at hand, and keeps Slack's own page to make the app by hand", () => {
    const html = renderToStaticMarkup(
      <SlackSettingsView
        controls={controls(known(slackOff))}
        defaultOpen
        manifest={controls({
          state: "failed",
          words: "HQ does not know its own public address yet.",
        })}
      />,
    );
    expect(shown(html)).toContain("HQ does not know its own public address yet.");
    expect(html).toContain('href="https://api.slack.com/apps?new_app=1"');
  });

  it("offers Connect only once every key holds as HQ takes it", () => {
    const view = rendered(
      <SlackSettingsView
        controls={controls(known(slackOff))}
        defaultOpen
        manifest={controls(known("{}"))}
      />,
    );
    const connect = () =>
      view.root.findAll((node) => node.props.type === "submit" && node.type === Button)[0]!;
    const [token, signing] = view.root
      .findAllByType(Input)
      .filter((node) => node.props.type === "password");
    expect(connect().props.disabled).toBe(true);
    view.type(token!, "xoxp-1");
    view.type(signing!, SIGNING);
    expect(connect().props.disabled).toBe(true);
    view.type(token!, BOT_TOKEN);
    expect(connect().props.disabled).toBe(false);
    view.unmount();
  });

  // Settings › Automation says the workspace; each project's page, its channel.
  it("says which workspace it is connected to, and the channel each application takes tasks from", () => {
    const html = renderToStaticMarkup(
      <>
        <SlackSettingsView
          controls={controls(known({ ...slackOff, connected: true, workspace: "Acme" }))}
          defaultOpen
        />
        <AppChannelView
          controls={controls(
            known({ channel: { appId: "tea-shop", channelId: "C042", channel: "support" } }),
          )}
          source="slack"
        />
      </>,
    );
    expect(shown(html)).toContain("Connected to Acme");
    expect(shown(html)).toContain("Disconnect");
    expect(shown(html)).toContain("Takes tasks from #support");
    expect(shown(html)).toContain("Stop");
  });

  it("says in Settings only the workspace a connected Slack app is in, each project's channel being its page's", () => {
    const html = renderToStaticMarkup(
      <SlackSettingsView
        controls={controls(known({ ...slackOff, connected: true, workspace: "Acme" }))}
      />,
    );
    expect(shown(html)).toContain("Connected to Acme");
    expect(shown(html)).not.toContain("Takes tasks from");
    expect(shown(html)).not.toContain("Channel ID");
  });

  it("names the channels a connected Slack's bot is in, or asks to invite it to one", () => {
    const connected = controls(known({ ...slackOff, connected: true, workspace: "Acme" }));
    const inSome = renderToStaticMarkup(
      <SlackSettingsView
        channels={controls(
          known({
            bot: "mate",
            channels: [
              { id: "C042", name: "support" },
              { id: "C043", name: "orders" },
            ],
          }),
        )}
        controls={connected}
        defaultOpen
      />,
    );
    expect(shown(inSome)).toContain("In #support and #orders.");
    const inNone = renderToStaticMarkup(
      <SlackSettingsView
        channels={controls(known({ bot: "mate", channels: [] }))}
        controls={connected}
        defaultOpen
      />,
    );
    expect(shown(inNone)).toContain("Invite @mate to a channel first.");
  });

  it("says Slack's messages are refused while the last refused signature is later than the last held, and Replace sends the new signing secret alone", () => {
    const slack = controls(
      known({
        ...slackOff,
        connected: true,
        workspace: "Acme",
        eventsRefusedAt: "2026-10-18T22:05:00.000Z",
        eventsAcceptedAt: "2026-10-18T22:01:00.000Z",
      }),
    );
    const view = rendered(
      <SlackSettingsView
        channels={controls(known({ bot: "mate", channels: [] }))}
        controls={slack}
        defaultOpen
      />,
    );
    const words = view.root.findAll(
      (node) => node.props.role === "alert" && typeof node.props.children === "string",
    );
    expect(words.map((node) => node.props.children)).toContain(
      "Slack's messages are refused: the signing secret does not match. Replace it.",
    );
    // The signing secret's field comes first while it is what needs replacing.
    const secret = view.root.findAllByType(Input).find((node) => node.props.type === "password");
    view.type(secret!, SIGNING);
    view.submit();
    expect(slack.write).toHaveBeenCalledWith({ kind: "slack-connect" }, { signingSecret: SIGNING });
    view.unmount();
  });

  it("Replace keeps a typed key until HQ accepts it, so a refused one is never pasted again", () => {
    const setting = known({ ...slackOff, connected: true, workspace: "Acme" });
    const slack = controls(setting);
    const withAction = (action: unknown) => ({
      ...slack,
      read: { ...slack.read, action } as TaskSourceSettingValue<never>,
    });
    const view = rendered(
      <SlackSettingsView
        channels={controls(known({ bot: "mate", channels: [] }))}
        controls={slack}
        defaultOpen
      />,
    );
    const typed = () =>
      view.root
        .findAllByType(Input)
        .filter((node) => node.props.type === "password")
        .map((node) => node.props.value);
    const token = view.root.findAllByType(Input).find((node) => node.props.type === "password");
    view.type(token!, BOT_TOKEN);
    view.submit();
    const show = (action: unknown) =>
      view.update(
        <SlackSettingsView
          channels={controls(known({ bot: "mate", channels: [] }))}
          controls={withAction(action)}
          defaultOpen
        />,
      );
    show({ kind: "working", verb: "slack-connect" });
    show({ kind: "failed", words: "Slack refused the bot token." });
    expect(typed()).toContain(BOT_TOKEN);
    view.submit();
    show({ kind: "working", verb: "slack-connect" });
    show({ kind: "done", verb: "slack-connect" });
    expect(typed()).not.toContain(BOT_TOKEN);
    view.unmount();
  });

  it("a Slack whose messages are refused never reads as plainly connected", () => {
    const html = renderToStaticMarkup(
      <SlackSettingsView
        controls={controls(
          known({
            ...slackOff,
            connected: true,
            workspace: "Acme",
            eventsRefusedAt: "2026-10-18T22:05:00.000Z",
            eventsAcceptedAt: "2026-10-18T22:01:00.000Z",
          }),
        )}
      />,
    );
    expect(html).toContain("Messages refused");
    expect(html).not.toContain(">Connected<");
  });

  it("says nothing is refused once an event's signature held after the last refusal", () => {
    const html = renderToStaticMarkup(
      <SlackSettingsView
        controls={controls(
          known({
            ...slackOff,
            connected: true,
            workspace: "Acme",
            eventsRefusedAt: "2026-10-18T22:01:00.000Z",
            eventsAcceptedAt: "2026-10-18T22:05:00.000Z",
          }),
        )}
      />,
    );
    expect(shown(html)).toContain("Connected to Acme");
    expect(shown(html)).not.toContain("refused");
  });

  it("a project picks its Slack channel from the ones the bot is in, and takes tasks from it by its ID", () => {
    const channel = controls(known({ channel: null }));
    const view = rendered(
      <AppChannelView
        choices={controls(
          known({
            bot: "mate",
            channels: [
              { id: "C042", name: "support" },
              { id: "C043", name: "orders" },
            ],
          }),
        )}
        controls={channel}
        source="slack"
      />,
    );
    const picker = view.root.find((node) => typeof node.props.onValueChange === "function");
    act(() => {
      picker.props.onValueChange("C043");
    });
    view.submit();
    expect(channel.write).toHaveBeenCalledWith({
      kind: "channel",
      source: "slack",
      channelId: "C043",
    });
    view.unmount();
  });

  it("a project whose Slack bot is in no channel is asked to invite it first, and may type an ID", () => {
    const html = renderToStaticMarkup(
      <AppChannelView
        choices={controls(known({ bot: "mate", channels: [] }))}
        controls={controls(known({ channel: null }))}
        source="slack"
      />,
    );
    expect(shown(html)).toContain("Invite @mate to a channel first.");
    expect(shown(html)).toContain("Channel ID, from the channel&#x27;s details");
  });

  it("asks an application with no channel for one by its ID", () => {
    const html = renderToStaticMarkup(
      <AppChannelView controls={controls(known({ channel: null }))} source="slack" />,
    );
    expect(shown(html)).toContain("Channel ID, from the channel&#x27;s details");
    expect(shown(html)).toContain("Take tasks");
  });

  // The owner's cardinal sin: a part that reads first and answers later must not grow.
  it("holds the form's room while it is read", () => {
    const html = renderToStaticMarkup(
      <SlackSettingsView controls={controls({ state: "reading" })} />,
    );
    expect(html).toContain("data-zerops-intake-room");
    expect(shown(html)).toContain("Checking…");
  });

  it.each([
    {
      case: "Slack, as its unconnected steps",
      part: <SlackSettingsView controls={controls({ state: "reading" })} />,
      room: "Connect",
    },
    {
      case: "Discord, as its unconnected steps",
      part: <DiscordSettingsView controls={controls({ state: "reading" })} />,
      room: "Connect",
    },
    {
      case: "an application's schedules, as its form",
      part: <AppSchedulesView controls={controls({ state: "reading" })} name="Tea Shop" />,
      room: "Add schedule",
    },
  ])("holds the room of its final shape while it is read: $case", ({ part, room }) => {
    const html = renderToStaticMarkup(part);
    expect(html).toContain("data-zerops-intake-room");
    expect(shown(html)).toContain(room);
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
      <DiscordSettingsView controls={controls(known(off))} defaultOpen />,
    );
    expect(html).toContain('href="https://discord.com/developers/applications"');
    expect(shown(html)).toContain("Application ID");
    expect(shown(html)).toContain("Public key");
    expect(shown(html)).toContain("Bot token");
    expect(shown(html)).toContain("https://hq.example/api/intake/discord/acme");
  });

  it("says the endpoint address appears once connected, with nothing to copy before HQ names it", () => {
    const html = renderToStaticMarkup(
      <DiscordSettingsView
        controls={controls(known({ ...off, interactionsUrl: "" }))}
        defaultOpen
      />,
    );
    expect(shown(html)).toContain("The address appears here once connected.");
    expect(shown(html)).not.toContain("Copy");
  });

  it("shows a connected application's invite link and who may use it", () => {
    const html = renderToStaticMarkup(
      <DiscordSettingsView
        defaultOpen
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
      <DiscordSettingsView defaultOpen controls={controls(known({ ...off, connected: true }))} />,
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

describe("the monthly budget in Settings", () => {
  it("says this month's spend against the budget, and saves a budget typed with the limits per task as HQ holds them", () => {
    const limits = controls(
      known({ minutes: 45, costUsd: 3, monthlyBudgetUsd: 50, spentThisMonthUsd: 6.44 }),
    );
    expect(shown(renderToStaticMarkup(<MonthlyBudgetView controls={limits} />))).toContain(
      "$6.44 of $50 spent this month.",
    );
    const view = rendered(<MonthlyBudgetView controls={limits} />);
    const [budget] = view.root.findAllByType(Input);
    view.type(budget!, "80");
    view.submit();
    expect(limits.write).toHaveBeenCalledWith({
      kind: "task-limits",
      limits: { minutes: 45, costUsd: 3, monthlyBudgetUsd: 80 },
    });
    view.unmount();
  });

  it("shows no budget where HQ predates it", () => {
    const limits = controls(known({ minutes: 60, costUsd: null }));
    expect(renderToStaticMarkup(<MonthlyBudgetView controls={limits} />)).toBe("");
  });
});

describe("limits saved in Settings", () => {
  // The owner's rule: nothing paints that the next frame takes back.
  it.each([
    { case: "HQ's read after it lands", end: "done", heldAfter: 30, shows: ["30", "5"] },
    { case: "HQ refuses it, as HQ holds them", end: "failed", heldAfter: 60, shows: ["60", ""] },
  ] as const)("show what was typed while saving, until $case", ({ end, heldAfter, shows }) => {
    const at = (held: number, action: unknown, cost: number | null = null) => ({
      ...controls(known({ minutes: held, costUsd: cost })),
      read: {
        setting: known({ minutes: held, costUsd: cost }),
        action,
        revealed: null,
      } as TaskSourceSettingValue<never>,
    });
    const first = at(60, { kind: "idle" });
    const view = rendered(<TaskLimitsView controls={first} />);
    const values = () => view.root.findAllByType(Input).map((node) => node.props.value);
    const [minutes, cost] = view.root.findAllByType(Input);
    view.type(minutes!, "30");
    view.type(cost!, "5");
    view.submit();
    view.update(<TaskLimitsView controls={at(60, { kind: "working", verb: "task-limits" })} />);
    expect(values()).toEqual(["30", "5"]);
    view.update(
      <TaskLimitsView
        controls={at(
          heldAfter,
          end === "done"
            ? { kind: "done", verb: "task-limits" }
            : { kind: "failed", words: "Minutes are a whole number from 1 to 1,440." },
          end === "done" ? 5 : null,
        )}
      />,
    );
    expect(values()).toEqual(shows);
    view.unmount();
  });
});

describe("the limits per task and the monthly budget, saved apart", () => {
  // Both rows write the one limits record HQ holds: what a save says belongs to the row pressed.
  const held = { minutes: 45, costUsd: 3, monthlyBudgetUsd: 50, spentThisMonthUsd: 6.44 };
  const at = (action: unknown) => ({
    ...controls(known(held)),
    read: { setting: known(held), action, revealed: null } as TaskSourceSettingValue<never>,
  });
  const both = (limits: ReturnType<typeof at>) => (
    <>
      <TaskLimitsView controls={limits} />
      <MonthlyBudgetView controls={limits} />
    </>
  );
  /** The words a row of the two shows, by its surface. */
  const words = (root: ReactTestInstance, surface: string): string => {
    const text = (node: ReactTestInstance | string): string =>
      typeof node === "string"
        ? node
        : node.props["aria-hidden"] === true
          ? ""
          : node.children.map(text).join(" ");
    return text(root.findAll((node) => node.props?.["data-zerops-surface"] === surface)[0]!)
      .replace(/\s+/gu, " ")
      .trim();
  };
  const submitBudget = (view: ReturnType<typeof rendered>) => {
    act(() => {
      view.root.findAllByType("form")[1]!.props.onSubmit({ preventDefault: () => {} });
    });
  };
  const refusal = "HQ refused the budget: it is an amount above $0 and at most $100,000.";

  it("says a refused budget beside the budget, keeping the amount typed, and nothing of it under the limits per task", () => {
    const view = rendered(both(at({ kind: "idle" })));
    const budget = view.root.findAllByType(Input)[2]!;
    view.type(budget, "80");
    submitBudget(view);
    view.update(both(at({ kind: "working", verb: "task-limits" })));
    view.update(both(at({ kind: "failed", words: refusal })));
    expect(words(view.root, "settings-monthly-budget")).toContain(refusal);
    expect(words(view.root, "settings-task-limits")).not.toContain(refusal);
    expect(view.root.findAllByType(Input)[2]!.props.value).toBe("80");
    view.unmount();
  });

  it("says Saving… only on the budget while the budget saves", () => {
    const view = rendered(both(at({ kind: "idle" })));
    view.type(view.root.findAllByType(Input)[2]!, "80");
    submitBudget(view);
    view.update(both(at({ kind: "working", verb: "task-limits" })));
    expect(words(view.root, "settings-monthly-budget")).toContain("Saving…");
    expect(words(view.root, "settings-task-limits")).not.toContain("Saving…");
    view.unmount();
  });

  it("says a refusal of the limits per task under them, never beside the budget", () => {
    const view = rendered(both(at({ kind: "idle" })));
    view.type(view.root.findAllByType(Input)[0]!, "30");
    act(() => {
      view.root.findAllByType("form")[0]!.props.onSubmit({ preventDefault: () => {} });
    });
    view.update(both(at({ kind: "working", verb: "task-limits" })));
    expect(words(view.root, "settings-monthly-budget")).not.toContain("Saving…");
    view.update(both(at({ kind: "failed", words: "Minutes are a whole number from 1 to 1,440." })));
    expect(words(view.root, "settings-task-limits")).toContain("Minutes are a whole number");
    expect(words(view.root, "settings-monthly-budget")).not.toContain("Minutes are a whole number");
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

describe("the automated Mates' model in Settings", () => {
  const nebius = OPENCODE_KEY_PROVIDERS[0]!;
  const FLASH = "nebius/zai-org/GLM-5.3-Flash";
  const held = {
    minutes: 45,
    costUsd: 3,
    monthlyBudgetUsd: 50,
    spentThisMonthUsd: 6.44,
    model: FLASH,
  };
  /** The words under a node, as one line. */
  const words = (node: ReactTestInstance): string =>
    node.children
      .map((child) => (typeof child === "string" ? child : words(child)))
      .join(" ")
      .replace(/\s+/gu, " ")
      .trim();

  it("Settings › Automation offers each model with its price and marks the current one", () => {
    const limits = controls(known(held));
    expect(shown(renderToStaticMarkup(<AutomatedModelView controls={limits} />))).toContain(
      "GLM-5.3 Flash · $0.15 in · $0.50 out per million tokens",
    );
    const view = rendered(<AutomatedModelView controls={limits} />);
    act(() => {
      view.root
        .findAllByType(Button)
        .find((button) => words(button) === "Change")!
        .props.onClick();
    });
    const offered = view.root.findAll((node) => node.props["data-automated-model"] !== undefined);
    expect(
      offered.map((node) => ({
        model: node.props["data-automated-model"],
        current: words(node).includes("Current"),
      })),
    ).toEqual(
      nebius.automatedModels.map((offer) => ({
        model: `nebius/${offer.id}`,
        current: `nebius/${offer.id}` === FLASH,
      })),
    );
    expect(words(offered[2]!)).toContain("DeepSeek V4 Flash");
    expect(words(offered[2]!)).toContain("$0.14 in · $0.28 out per million tokens");
    expect(words(offered[2]!)).toContain(nebius.automatedModels[2]!.why);
    view.unmount();
  });

  it("a model picked saves with the limits as HQ holds them", () => {
    const limits = controls(known(held));
    const view = rendered(<AutomatedModelView controls={limits} />);
    act(() => {
      view.root
        .findAllByType(Button)
        .find((button) => words(button) === "Change")!
        .props.onClick();
    });
    act(() => {
      view.root.findByType(RadioGroup).props.onValueChange("nebius/zai-org/GLM-5.3");
    });
    expect(limits.write).toHaveBeenCalledWith({
      kind: "task-limits",
      limits: { minutes: 45, costUsd: 3, model: "nebius/zai-org/GLM-5.3" },
    });
    view.unmount();
  });

  it("offers no model where HQ predates the choice", () => {
    const limits = controls(known({ minutes: 60, costUsd: null }));
    expect(renderToStaticMarkup(<AutomatedModelView controls={limits} />)).toBe("");
  });
});
