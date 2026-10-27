import { describe, expect, it } from "vite-plus/test";

import {
  allowlistAfter,
  channelLine,
  budgetLine,
  limitsLine,
  readBudget,
  readLimits,
  scheduleLine,
  scheduleNextLine,
  connectKeyProblem,
  replaceKeysReady,
  sectionState,
  slackChannelChoices,
  slackChannelsLine,
  slackLine,
  slackManifestApp,
  slackSignatureRefused,
  taskSourceProblem,
  taskSourcesUnsupported,
  workingWords,
} from "./taskSourcesSettings.logic";

const known = <T>(value: T) => ({ state: "known", held: value, stale: false }) as const;

describe("what a task source's section shows", () => {
  it.each([
    { case: "not read yet", setting: { state: "unread" } as const, shows: "reading" },
    { case: "being read", setting: { state: "reading" } as const, shows: "reading" },
    { case: "HQ withholds it", setting: { state: "withheld" } as const, shows: "withheld" },
    { case: "this HQ predates it", setting: { state: "unsupported" } as const, shows: "hidden" },
    {
      case: "its read failed",
      setting: { state: "failed", words: "HQ could not be reached." } as const,
      shows: "failed",
    },
    { case: "read", setting: known({ connected: false }), shows: "known" },
  ])("$case: $shows", ({ setting, shows }) => {
    expect(sectionState(setting)).toBe(shows);
  });

  it("asks for an update once any of the organization's sources says HQ predates it", () => {
    expect(taskSourcesUnsupported([{ state: "unsupported" }, known(1)])).toBe(true);
    expect(taskSourcesUnsupported([{ state: "reading" }, known(1)])).toBe(false);
  });
});

describe("the words a task source's settings say", () => {
  it.each([
    [{ connected: true, workspace: "Acme" }, "Connected to Acme"],
    [{ connected: true, workspace: null }, "Connected"],
    [{ connected: false, workspace: null }, "Not connected"],
  ] as const)("Slack %o reads “%s”", (view, line) => {
    expect(slackLine(view)).toBe(line);
  });

  it("names the channel an application takes tasks from", () => {
    expect(channelLine({ channel: "support" })).toBe("Takes tasks from #support");
  });

  it.each([
    [{ every: "day", at: "09:00", timeZone: "Europe/Prague" }, "Every day at 09:00, Europe/Prague"],
    [{ every: "weekday", at: "07:30", timeZone: "UTC" }, "Every weekday at 07:30, UTC"],
    [
      { every: "week", day: 1, at: "09:00", timeZone: "Europe/Prague" },
      "Every Monday at 09:00, Europe/Prague",
    ],
  ] as const)("a schedule %o reads “%s”", (rule, line) => {
    expect(scheduleLine(rule)).toBe(line);
  });

  it("says when a schedule runs next, or that it is paused", () => {
    expect(scheduleNextLine("2026-10-20T07:00:00.000Z", () => "Mon 20 Oct, 09:00")).toBe(
      "Next Mon 20 Oct, 09:00",
    );
    expect(scheduleNextLine(null, () => "never")).toBe("Paused");
  });

  it.each([
    [{ minutes: 60, costUsd: null }, "A task stops after 60 minutes of work."],
    [{ minutes: 1, costUsd: null }, "A task stops after 1 minute of work."],
    [{ minutes: 30, costUsd: 5 }, "A task stops after 30 minutes of work or $5 of model use."],
    [{ minutes: 30, costUsd: 2.5 }, "A task stops after 30 minutes of work or $2.50 of model use."],
  ] as const)("limits %o read “%s”", (limits, line) => {
    expect(limitsLine(limits)).toBe(line);
  });

  it.each([
    ["slack-connect", "Connecting…"],
    ["slack-disconnect", "Disconnecting…"],
    ["discord-allow", "Saving…"],
    ["webhook-make", "Making…"],
    ["webhook-delete", "Deleting…"],
    ["task-limits", "Saving…"],
  ] as const)("a write of %s under way reads “%s”", (verb, words) => {
    expect(workingWords(verb)).toBe(words);
  });

  it("says a write's refusal or a lost answer, and nothing while it is idle, under way or done", () => {
    expect(taskSourceProblem({ kind: "failed", words: "No such channel." })).toBe(
      "No such channel.",
    );
    expect(taskSourceProblem({ kind: "unresolved", words: "HQ may have taken it." })).toBe(
      "HQ may have taken it.",
    );
    expect(taskSourceProblem({ kind: "working", verb: "channel" })).toBeNull();
    expect(taskSourceProblem({ kind: "done", verb: "channel" })).toBeNull();
    expect(taskSourceProblem({ kind: "idle" })).toBeNull();
  });
});

describe("the organization's monthly budget", () => {
  it.each([
    [{ minutes: 60, costUsd: null }, null],
    [
      { minutes: 60, costUsd: null, monthlyBudgetUsd: null, spentThisMonthUsd: 6.44 },
      "No monthly budget. $6.44 spent this month.",
    ],
    [
      { minutes: 60, costUsd: null, monthlyBudgetUsd: 50, spentThisMonthUsd: 6.44 },
      "$6.44 of $50 spent this month.",
    ],
    [
      { minutes: 60, costUsd: null, monthlyBudgetUsd: 50, spentThisMonthUsd: 51.2 },
      "$51.20 of $50 spent this month: no task starts until next month or a higher budget.",
    ],
  ] as const)("limits %o say “%s” of the month", (limits, line) => {
    expect(budgetLine(limits)).toBe(line);
  });

  it.each([
    ["", { budgetUsd: null }],
    [" 50 ", { budgetUsd: 50 }],
    ["12.5", { budgetUsd: 12.5 }],
    ["0", { error: "A budget is an amount above $0 and at most $1,000,000, or empty for none." }],
    ["x", { error: "A budget is an amount above $0 and at most $1,000,000, or empty for none." }],
  ] as const)("a budget typed as “%s” reads as %o", (typed, read) => {
    expect(readBudget(typed)).toEqual(read);
  });
});

describe("what the settings' forms take", () => {
  it.each([
    { minutes: "60", cost: "", read: { limits: { minutes: 60, costUsd: null } } },
    { minutes: " 45 ", cost: "5", read: { limits: { minutes: 45, costUsd: 5 } } },
    { minutes: "45", cost: "2.50", read: { limits: { minutes: 45, costUsd: 2.5 } } },
    { minutes: "0", cost: "", read: { error: "Minutes are a whole number from 1 to 1,440." } },
    { minutes: "1.5", cost: "", read: { error: "Minutes are a whole number from 1 to 1,440." } },
    { minutes: "1441", cost: "", read: { error: "Minutes are a whole number from 1 to 1,440." } },
    { minutes: "1440", cost: "10000", read: { limits: { minutes: 1440, costUsd: 10000 } } },
    {
      minutes: "60",
      cost: "0",
      read: { error: "Cost is an amount above $0 and at most $10,000, or empty for none." },
    },
    {
      minutes: "60",
      cost: "x",
      read: { error: "Cost is an amount above $0 and at most $10,000, or empty for none." },
    },
    {
      minutes: "60",
      cost: "10000.01",
      read: { error: "Cost is an amount above $0 and at most $10,000, or empty for none." },
    },
  ])("limits of $minutes minutes and $cost dollars read as $read", ({ minutes, cost, read }) => {
    expect(readLimits(minutes, cost)).toEqual(read);
  });

  const IDA = "123456789012345678";
  const NOVA = "223456789012345678";
  it.each([
    {
      case: "an ID added joins it",
      held: [IDA],
      add: ` ${NOVA} `,
      after: { userIds: [IDA, NOVA] },
    },
    { case: "an ID already on it is there once", held: [IDA], add: IDA, after: { userIds: [IDA] } },
    {
      case: "what is no Discord user ID is refused",
      held: [],
      add: "not-an-id",
      after: { error: "A Discord user ID is a number of up to 20 digits." },
    },
    { case: "an ID removed leaves it", held: [IDA, NOVA], remove: IDA, after: { userIds: [NOVA] } },
  ])("the Discord allowlist: $case", ({ held, add, remove, after }) => {
    expect(allowlistAfter(held, add === undefined ? { remove: remove! } : { add })).toEqual(after);
  });
});

describe("making the organization's Slack app from HQ's manifest", () => {
  // As HQ makes it (`mate-hq apps/hq/src/slack.ts`): its events sent to HQ's own address.
  const EVENTS = "https://hq-acme.zerops.app/api/intake/slack/acme";
  const manifest = {
    display_information: { name: "Mate" },
    features: { bot_user: { display_name: "Mate", always_online: true } },
    oauth_config: { scopes: { bot: ["app_mentions:read", "chat:write", "users:read.email"] } },
    settings: {
      event_subscriptions: { request_url: EVENTS, bot_events: ["app_mention"] },
      socket_mode_enabled: false,
    },
  };

  it("opens Slack's new app page with HQ's manifest whole, its requests sent to HQ's address and its scopes", () => {
    const app = slackManifestApp(JSON.stringify(manifest, null, 2))!;
    const url = new URL(app.createUrl);
    expect(`${url.origin}${url.pathname}`).toBe("https://api.slack.com/apps");
    expect(url.searchParams.get("new_app")).toBe("1");
    expect(JSON.parse(url.searchParams.get("manifest_json")!)).toEqual(manifest);
    expect(app.requestUrls).toEqual([EVENTS]);
    expect(app.scopes).toEqual(["app_mentions:read", "chat:write", "users:read.email"]);
  });

  it.each([
    { case: "no JSON", text: "not json" },
    { case: "no object", text: "[]" },
  ])("offers no one-press app where HQ's manifest is $case", ({ text }) => {
    expect(slackManifestApp(text)).toBeNull();
  });
});

describe("what a connection's fields take before Connect", () => {
  it.each([
    { key: "slack-bot-token", typed: "", problem: null },
    { key: "slack-bot-token", typed: ["xoxb", "1", "acme"].join("-"), problem: null },
    { key: "slack-bot-token", typed: "xoxp-1", problem: "A bot token starts with xoxb-." },
    { key: "slack-signing-secret", typed: "a b", problem: "A signing secret has no spaces." },
    { key: "discord-application-id", typed: "1234567890", problem: null },
    {
      key: "discord-application-id",
      typed: "12ab",
      problem: "An application ID is a number of up to 20 digits.",
    },
    { key: "discord-public-key", typed: "AB".repeat(32), problem: null },
    {
      key: "discord-public-key",
      typed: "abc",
      problem: "A public key is 64 characters, 0–9 and a–f.",
    },
    { key: "discord-bot-token", typed: "a b", problem: "A bot token has no spaces." },
  ] as const)("$key typed as '$typed' says $problem", ({ key, typed, problem }) => {
    expect(connectKeyProblem(key, typed)).toBe(problem);
  });
});

describe("Slack's refused signatures", () => {
  const at = (minute: number) => `2026-10-18T22:${String(minute).padStart(2, "0")}:00.000Z`;
  it.each([
    { case: "never refused", refused: null, accepted: at(1), says: false },
    { case: "refused, never accepted", refused: at(1), accepted: null, says: true },
    { case: "refused after the last accepted", refused: at(5), accepted: at(1), says: true },
    { case: "accepted after the last refused", refused: at(1), accepted: at(5), says: false },
    { case: "an HQ that does not say", refused: undefined, accepted: undefined, says: false },
  ])("the Slack card says the signing secret does not match: $case → $says", (row) => {
    const view = {
      connected: true,
      ...(row.refused === undefined ? {} : { eventsRefusedAt: row.refused }),
      ...(row.accepted === undefined ? {} : { eventsAcceptedAt: row.accepted }),
    };
    expect(slackSignatureRefused(view)).toBe(row.says);
  });

  it("says nothing of signatures while Slack is not connected", () => {
    expect(slackSignatureRefused({ connected: false, eventsRefusedAt: at(1) })).toBe(false);
  });
});

describe("the channels Slack's bot is in", () => {
  it.each([
    {
      case: "in channels",
      held: { bot: "mate", channels: [{ id: "C042", name: "support" }] },
      says: { kind: "channels", channels: [{ id: "C042", name: "support" }] },
    },
    {
      case: "in none",
      held: { bot: "mate", channels: [] },
      says: { kind: "none", words: "Invite @mate to a channel first." },
    },
    {
      case: "in none, its name not known",
      held: { bot: null, channels: [] },
      says: { kind: "none", words: "Invite @Mate to a channel first." },
    },
  ])("$case", ({ held, says }) => {
    expect(slackChannelChoices(held)).toEqual(says);
  });

  it.each([
    [{ bot: "mate", channels: [] }, "Invite @mate to a channel first."],
    [
      {
        bot: "mate",
        channels: [
          { id: "C1", name: "support" },
          { id: "C2", name: "orders" },
        ],
      },
      "In #support and #orders.",
    ],
    [
      {
        bot: "mate",
        channels: [
          { id: "C1", name: "a" },
          { id: "C2", name: "b" },
          { id: "C3", name: "c" },
        ],
      },
      "In #a, #b and #c.",
    ],
  ] as const)("Settings says where the bot is: %o reads “%s”", (held, line) => {
    expect(slackChannelsLine(held)).toBe(line);
  });
});

describe("replacing a connected Slack's keys", () => {
  it.each([
    { case: "nothing typed", token: "", secret: "", ready: false },
    { case: "a new signing secret alone", token: "", secret: "s3cret", ready: true },
    { case: "a new bot token alone", token: "xoxb-1-2", secret: "", ready: true },
    { case: "a bot token that is none", token: "xoxp-1-2", secret: "", ready: false },
    { case: "a secret with a space", token: "", secret: "s3 cret", ready: false },
  ])("Replace is pressable with $case: $ready", ({ token, secret, ready }) => {
    expect(replaceKeysReady(token, secret)).toBe(ready);
  });
});
