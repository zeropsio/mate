import { describe, expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import type {
  HqAppTask,
  HqChannelView,
  HqDiscordView,
  HqSlackView,
  HqTaskLimitsView,
  HqWebhookView,
} from "@t3tools/shared/hqIntake";
import { HqError } from "../../zerops/hq/client.ts";
import { placementsScope } from "../families/hqNavigation.ts";
import type { TaskSourceSetting } from "../families/hqTaskSources.ts";
import { appTaskStops } from "../projections/hqTaskSources.ts";
import { commitOwn } from "./hqSettingsReads.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { taskSourceSetting } from "../projections/hqTaskSources.ts";
import type { HqGithubManifestView, HqGithubView } from "@t3tools/shared/hqGithub";
import {
  GITHUB_UNSUPPORTED,
  makeTaskSourceSettings,
  TASK_SOURCES_UNSUPPORTED,
} from "./hqTaskSources.ts";

const ORG = { orgId: "org" };
const SHOP = { orgId: "org", appId: "shop" };
// Built from parts: never a whole secret-shaped literal in the source.
const BOT_TOKEN = ["xoxb", "1111", "2222", "teashop"].join("-");
const SIGNING = ["sign", "tea", "shop", "0042"].join("_");
const DISCORD_TOKEN = ["MTE", "tea", "shop", "bot"].join(".");
const HOOK_SECRET = ["whsec", "tea", "shop", "0007"].join("_");

function waitFor(store: ReturnType<typeof makeAccountStore>, predicate: () => boolean) {
  return new Promise<void>((resolve) => {
    const stop = store.subscribe(() => check());
    const check = () => {
      if (predicate()) {
        stop();
        resolve();
      }
    };
    check();
  });
}

function rig(api: Parameters<typeof makeTaskSourceSettings>[0]["api"]) {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let id = 0;
  const host = makeTaskSourceSettings({ store, api, makeId: () => `request-${++id}` });
  const read = (family: TaskSourceSetting, appId?: string) =>
    taskSourceSetting.derive(readsOfState(store.state()), {
      family,
      orgId: "org",
      ...(appId === undefined ? {} : { appId }),
    });
  return {
    store,
    host,
    read,
    /** Every record the account holds, as text: what must never carry a secret. */
    records: () =>
      JSON.stringify([...store.state().facts.values(), ...store.state().operations.values()]),
    close: () => {
      host.close();
      registry.dispose();
    },
  };
}

const notConnected: HqSlackView = {
  connected: false,
  workspace: null,
  eventsUrl: "https://hq.example/api/intake/slack/acme",
};
const connected: HqSlackView = { ...notConnected, connected: true, workspace: "Acme" };

describe("the organization's Slack app", () => {
  it("connects with the bot token and signing secret, and keeps both out of every record", async () => {
    let held = notConnected;
    const sent: Array<unknown> = [];
    const r = rig({
      slack: async () => held,
      connectSlack: async (request) => {
        sent.push(request);
        held = connected;
        return connected;
      },
    });
    const read = waitFor(r.store, () => r.read("hqSlack").setting.state === "known");
    const release = r.host.demandOrg("hqSlack", ORG);
    await read;
    expect(r.read("hqSlack").setting).toMatchObject({ state: "known", held: notConnected });
    const done = waitFor(r.store, () => r.read("hqSlack").action.kind === "done");
    await r.host.write(
      ORG,
      { kind: "slack-connect" },
      { botToken: BOT_TOKEN, signingSecret: SIGNING },
    );
    await done;
    expect(sent).toEqual([{ botToken: BOT_TOKEN, signingSecret: SIGNING }]);
    expect(r.read("hqSlack").setting).toMatchObject({ state: "known", held: connected });
    expect(r.records()).not.toContain(BOT_TOKEN);
    expect(r.records()).not.toContain(SIGNING);
    release();
    r.close();
  });

  it("replaces the signing secret alone of a connected Slack, and keeps it out of every record", async () => {
    const sent: Array<unknown> = [];
    const r = rig({
      slack: async () => connected,
      connectSlack: async (request) => {
        sent.push(request);
        return connected;
      },
    });
    const release = r.host.demandOrg("hqSlack", ORG);
    await waitFor(r.store, () => r.read("hqSlack").setting.state === "known");
    await r.host.write(ORG, { kind: "slack-connect" }, { signingSecret: SIGNING });
    await waitFor(r.store, () => r.read("hqSlack").action.kind === "done");
    expect(sent).toEqual([{ signingSecret: SIGNING }]);
    expect(r.records()).not.toContain(SIGNING);
    release();
    r.close();
  });

  it("reads the channels the Slack bot is in while a screen shows them, and again after Slack connects again", async () => {
    let channels = [{ id: "C042", name: "support" }];
    const r = rig({
      slack: async () => connected,
      connectSlack: async () => {
        channels = [{ id: "C043", name: "orders" }];
        return connected;
      },
      slackChannels: async () => ({ bot: "mate", channels }),
    });
    const release = r.host.demandOrg("hqSlackChannels", ORG);
    await waitFor(r.store, () => r.read("hqSlackChannels").setting.state === "known");
    expect(r.read("hqSlackChannels").setting).toMatchObject({
      held: { bot: "mate", channels: [{ id: "C042", name: "support" }] },
    });
    await r.host.write(ORG, { kind: "slack-connect" }, { botToken: BOT_TOKEN });
    await waitFor(r.store, () =>
      JSON.stringify(r.read("hqSlackChannels").setting).includes("orders"),
    );
    release();
    r.close();
  });

  it("reads as connecting until a read after HQ's answer shows it, never as it was", async () => {
    let reads = 0;
    let answerReread: (view: HqSlackView) => void = () => {};
    let rereadAsked: () => void = () => {};
    const reread = new Promise<void>((resolve) => {
      rereadAsked = resolve;
    });
    const r = rig({
      slack: () => {
        reads++;
        if (reads === 1) return Promise.resolve(notConnected);
        rereadAsked();
        return new Promise((resolve) => {
          answerReread = resolve;
        });
      },
      connectSlack: async () => connected,
    });
    const read = waitFor(r.store, () => r.read("hqSlack").setting.state === "known");
    const release = r.host.demandOrg("hqSlack", ORG);
    await read;
    await r.host.write(
      ORG,
      { kind: "slack-connect" },
      { botToken: BOT_TOKEN, signingSecret: SIGNING },
    );
    await reread;
    expect(r.read("hqSlack").action).toEqual({ kind: "working", verb: "slack-connect" });
    const done = waitFor(r.store, () => r.read("hqSlack").action.kind === "done");
    answerReread(connected);
    await done;
    expect(r.read("hqSlack").setting).toMatchObject({ state: "known", held: connected });
    release();
    r.close();
  });

  it("says HQ's refusal of a connection, never the token typed", async () => {
    const r = rig({
      slack: async () => notConnected,
      connectSlack: async (request) => {
        throw new HqError({
          kind: "refused",
          code: "invalid",
          message: `Slack refused ${request.botToken}`,
        });
      },
    });
    await r.host.write(
      ORG,
      { kind: "slack-connect" },
      { botToken: BOT_TOKEN, signingSecret: SIGNING },
    );
    expect(r.read("hqSlack").action).toEqual({
      kind: "failed",
      words: "HQ did not take what was entered.",
    });
    expect(r.records()).not.toContain(BOT_TOKEN);
    r.close();
  });

  it.each([
    {
      case: "HQ answers that it has no such address",
      api: {
        slack: async (): Promise<HqSlackView> => {
          throw new HqError({ kind: "refused", code: "not_found", status: 404, message: "No." });
        },
      },
    },
    { case: "this client's HQ reads no Slack app", api: {} },
  ])("an HQ that keeps no Slack app asks for an update: $case", async ({ api }) => {
    const r = rig(api);
    const read = waitFor(r.store, () => r.read("hqSlack").setting.state === "unsupported");
    const release = r.host.demandOrg("hqSlack", ORG);
    await read;
    expect(r.read("hqSlack").setting).toEqual({ state: "unsupported" });
    await r.host.write(ORG, { kind: "slack-disconnect" });
    expect(r.read("hqSlack").action).toEqual({ kind: "failed", words: TASK_SOURCES_UNSUPPORTED });
    release();
    r.close();
  });

  it("hands the manifest to copy as its JSON", async () => {
    const manifest = { display_information: { name: "Mate" } };
    const r = rig({ slackManifest: async () => manifest });
    const read = waitFor(r.store, () => r.read("hqSlackManifest").setting.state === "known");
    const release = r.host.demandOrg("hqSlackManifest", ORG);
    await read;
    expect(r.read("hqSlackManifest").setting).toMatchObject({
      state: "known",
      held: JSON.stringify(manifest, null, 2),
    });
    release();
    r.close();
  });
});

describe("the organization's Discord application", () => {
  const discord: HqDiscordView = {
    connected: true,
    interactionsUrl: "https://hq.example/api/intake/discord/acme",
    inviteUrl: "https://discord.com/oauth2/authorize?client_id=1",
    allowed: ["111"],
  };

  it("connects with its bot token, which never stays in a record, and sends the allowlist whole", async () => {
    let held: HqDiscordView = { ...discord, connected: false, inviteUrl: null, allowed: [] };
    const sent: Array<unknown> = [];
    const r = rig({
      discord: async () => held,
      connectDiscord: async (request) => {
        sent.push(request);
        held = discord;
        return discord;
      },
      allowDiscord: async (request) => {
        sent.push(request);
        held = { ...held, allowed: request.userIds };
        return held;
      },
    });
    const release = r.host.demandOrg("hqDiscord", ORG);
    await r.host.write(
      ORG,
      { kind: "discord-connect", applicationId: "1", publicKey: "abc" },
      { botToken: DISCORD_TOKEN },
    );
    await r.host.write(ORG, { kind: "discord-allow", userIds: ["111", "222"] });
    await waitFor(
      r.store,
      () =>
        r.read("hqDiscord").action.kind === "done" &&
        JSON.stringify(r.read("hqDiscord").setting).includes("222"),
    );
    expect(sent).toEqual([
      { applicationId: "1", publicKey: "abc", botToken: DISCORD_TOKEN },
      { userIds: ["111", "222"] },
    ]);
    expect(r.records()).not.toContain(DISCORD_TOKEN);
    release();
    r.close();
  });
});

describe("an application's sources", () => {
  it("reads no channel where HQ says the application takes none, and the one set after", async () => {
    let held: HqChannelView | null = null;
    const r = rig({
      appChannel: async () => held,
      setAppChannel: async (appId, _source, request) => {
        held = { appId, channelId: request.channelId, channel: "support" };
        return held;
      },
    });
    const release = r.host.demandApp("hqAppSlack", SHOP);
    await waitFor(r.store, () => r.read("hqAppSlack", "shop").setting.state === "known");
    expect(r.read("hqAppSlack", "shop").setting).toMatchObject({ held: { channel: null } });
    await r.host.write(SHOP, { kind: "channel", source: "slack", channelId: "C042" });
    await waitFor(r.store, () => r.read("hqAppSlack", "shop").action.kind === "done");
    expect(r.read("hqAppSlack", "shop").setting).toMatchObject({
      held: { channel: { channelId: "C042", channel: "support" } },
    });
    release();
    r.close();
  });

  it.each([
    { write: { kind: "slack-disconnect" } as const, secrets: undefined },
    {
      write: { kind: "slack-connect" } as const,
      secrets: { botToken: BOT_TOKEN, signingSecret: SIGNING },
    },
  ])(
    "reads each application's Slack channel again after Slack is changed ($write.kind): HQ may have dropped them",
    async ({ write, secrets }) => {
      let held: HqChannelView | null = { appId: "shop", channelId: "C042", channel: "support" };
      const r = rig({
        slack: async () => connected,
        connectSlack: async () => {
          held = null;
          return connected;
        },
        disconnectSlack: async () => {
          held = null;
        },
        appChannel: async () => held,
      });
      const release = r.host.demandApp("hqAppSlack", SHOP);
      await waitFor(r.store, () =>
        JSON.stringify(r.read("hqAppSlack", "shop").setting).includes("support"),
      );
      await r.host.write(ORG, write, secrets);
      await waitFor(
        r.store,
        () =>
          r.read("hqAppSlack", "shop").setting.state === "known" &&
          !JSON.stringify(r.read("hqAppSlack", "shop").setting).includes("support"),
      );
      expect(r.read("hqAppSlack", "shop").setting).toMatchObject({ held: { channel: null } });
      release();
      r.close();
    },
  );

  it("shows a webhook's secret while the screen that made it is open, never in its list, and forgets it once closed", async () => {
    const made: HqWebhookView = {
      id: "w1",
      name: "Sentry",
      url: "https://hq.example/api/intake/webhook/w1",
      secret: HOOK_SECRET,
      createdAt: "2026-10-17T09:00:00.000Z",
    };
    let list: ReadonlyArray<HqWebhookView> = [];
    const r = rig({
      // An HQ that wrongly lists the secret: the account never holds it there.
      webhooks: async () => list,
      makeWebhook: async () => {
        list = [made];
        return made;
      },
    });
    const release = r.host.demandApp("hqAppWebhooks", SHOP);
    const hold = r.host.holdWebhooks(SHOP);
    await r.host.write(SHOP, { kind: "webhook-make", name: "Sentry" });
    await waitFor(r.store, () => r.read("hqAppWebhooks", "shop").action.kind === "done");
    expect(r.read("hqAppWebhooks", "shop").revealed).toEqual(made);
    const listed = r.read("hqAppWebhooks", "shop").setting;
    expect(listed).toMatchObject({ state: "known", held: [{ id: "w1", name: "Sentry" }] });
    expect(JSON.stringify(listed)).not.toContain(HOOK_SECRET);
    expect(JSON.stringify([...r.store.state().operations.values()])).not.toContain(HOOK_SECRET);
    hold();
    expect(r.read("hqAppWebhooks", "shop").revealed).toBeNull();
    expect(r.records()).not.toContain(HOOK_SECRET);
    release();
    r.close();
  });

  it("never shows a webhook's secret whose answer came after its screen closed", async () => {
    let answer: (view: HqWebhookView) => void = () => {};
    const r = rig({
      webhooks: async () => [],
      makeWebhook: () =>
        new Promise<HqWebhookView>((resolve) => {
          answer = resolve;
        }),
    });
    const hold = r.host.holdWebhooks(SHOP);
    const making = r.host.write(SHOP, { kind: "webhook-make", name: "Sentry" });
    hold();
    answer({
      id: "w1",
      name: "Sentry",
      url: "https://hq.example/api/intake/webhook/w1",
      secret: HOOK_SECRET,
      createdAt: "2026-10-17T09:00:00.000Z",
    });
    await making;
    expect(r.read("hqAppWebhooks", "shop").revealed).toBeNull();
    expect(r.records()).not.toContain(HOOK_SECRET);
    r.close();
  });
});

describe("an application HQ no longer holds", () => {
  it("says the application is gone, never that HQ is too old", async () => {
    const r = rig({
      webhooks: async () => {
        throw new HqError({
          kind: "refused",
          code: "app_not_found",
          reason: "app_not_found",
          status: 404,
          message: "This application is gone from HQ.",
        });
      },
    });
    const release = r.host.demandApp("hqAppWebhooks", SHOP);
    await waitFor(r.store, () => r.read("hqAppWebhooks", "shop").setting.state === "failed");
    expect(r.read("hqAppWebhooks", "shop").setting).toEqual({
      state: "failed",
      words: "This application is gone from HQ.",
    });
    release();
    r.close();
  });
});

describe("the limits on each task", () => {
  it("saves the minutes and the cost, and reads what HQ holds after", async () => {
    let held: HqTaskLimitsView = { minutes: 60, costUsd: null };
    const r = rig({
      taskLimits: async () => held,
      setTaskLimits: async (limits) => {
        held = limits;
        return limits;
      },
    });
    const release = r.host.demandOrg("hqTaskLimits", ORG);
    await waitFor(r.store, () => r.read("hqTaskLimits").setting.state === "known");
    await r.host.write(ORG, { kind: "task-limits", limits: { minutes: 30, costUsd: 5 } });
    await waitFor(r.store, () => r.read("hqTaskLimits").action.kind === "done");
    expect(r.read("hqTaskLimits").setting).toMatchObject({
      state: "known",
      held: { minutes: 30, costUsd: 5 },
    });
    release();
    r.close();
  });
});

describe("an application's tasks", () => {
  const task = (id: string, state: HqAppTask["state"]): HqAppTask => ({
    id,
    title: `Task ${id}`,
    label: `acme/tea-shop#${id}`,
    url: null,
    state,
    mate: state === "queued" ? null : { projectId: "P_JUNO", name: "Juno" },
    requestedBy: "nova",
    createdAt: "2026-10-18T08:00:00.000Z",
    startedAt: null,
    endedAt: null,
    spentUsd: null,
    workedMs: null,
    detail: null,
    change: null,
    pullRequest: null,
    link: null,
  });

  it("reads the board while it is shown, and a task stopped from it shows done once a read after HQ's answer has it stopped", async () => {
    let held: ReadonlyArray<HqAppTask> = [task("1", "working")];
    const stopped: Array<[string, string]> = [];
    const r = rig({
      appTasks: async () => held,
      stopAppTask: async (appId, taskId) => {
        stopped.push([appId, taskId]);
        held = [task("1", "stopped")];
      },
    });
    const release = r.host.demandApp("hqAppTasks", SHOP);
    await waitFor(r.store, () => r.read("hqAppTasks", "shop").setting.state === "known");
    await r.host.write(SHOP, { kind: "task-stop", taskId: "1" });
    const stopOf = () =>
      appTaskStops.derive(readsOfState(r.store.state()), {
        orgId: "org",
        appId: "shop",
        taskIds: ["1"],
      })["1"];
    await waitFor(r.store, () => stopOf()?.kind === "done");
    expect(stopped).toEqual([["shop", "1"]]);
    expect(r.read("hqAppTasks", "shop").setting).toMatchObject({
      state: "known",
      held: [{ id: "1", state: "stopped" }],
    });
    release();
    r.close();
  });
});

describe("the organization's GitHub app", () => {
  const none: HqGithubView = { state: "none" };
  const app: HqGithubView = {
    state: "connected",
    slug: "acme-mate",
    botLogin: "acme-mate[bot]",
    owner: "acme",
    appUrl: "https://github.com/apps/acme-mate",
    installUrl: "https://github.com/apps/acme-mate/installations/new",
    installations: [
      {
        id: 7,
        account: "acme",
        accountType: "Organization",
        repositorySelection: "selected",
        repositories: [{ fullName: "acme/tea-shop", private: true, defaultBranch: "main" }],
        suspended: false,
        manageUrl: "https://github.com/organizations/acme/settings/installations/7",
      },
    ],
  };
  // GitHub's one-time state binding its return to this request: built from parts.
  const STATE = ["state", "tea", "shop", "0042"].join("-");
  const manifest: HqGithubManifestView = {
    postUrl: "https://github.com/organizations/acme/settings/apps/new?state=" + STATE,
    manifest: JSON.stringify({ name: "Acme Mate" }),
    state: STATE,
  };
  const asked = { owner: "acme", name: "Acme Mate", returnTo: "https://mate.example/settings" };

  it("reads where the app is installed, never its key", async () => {
    const r = rig({ github: async () => app });
    const read = waitFor(r.store, () => r.read("hqGithub").setting.state === "known");
    const release = r.host.demandOrg("hqGithub", ORG);
    await read;
    expect(r.read("hqGithub").setting).toMatchObject({ state: "known", held: app });
    release();
    r.close();
  });

  it("hands HQ's manifest to the screen that asked, and keeps its one-time state out of every record", async () => {
    const sent: Array<unknown> = [];
    const r = rig({
      github: async () => none,
      githubManifest: async (request) => {
        sent.push(request);
        return manifest;
      },
    });
    const answer = await r.host.githubManifest(ORG, asked);
    expect(sent).toEqual([asked]);
    expect(answer).toEqual(manifest);
    expect(r.records()).not.toContain(STATE);
    r.close();
  });

  it("says HQ's refusal of the manifest, and hands nothing to post", async () => {
    const r = rig({
      github: async () => none,
      githubManifest: async () => {
        throw new HqError({
          kind: "refused",
          code: "forbidden",
          status: 403,
          message: "Only the organization's Owner and Admins connect GitHub.",
        });
      },
    });
    expect(await r.host.githubManifest(ORG, asked)).toBeNull();
    expect(r.read("hqGithub").action).toEqual({
      kind: "failed",
      words: "Only the organization's Owner and Admins connect GitHub.",
    });
    r.close();
  });

  it("disconnects, and shows done once a read after HQ's answer says none", async () => {
    let held: HqGithubView = app;
    const r = rig({
      github: async () => held,
      githubDisconnect: async () => {
        held = none;
      },
    });
    const read = waitFor(r.store, () => r.read("hqGithub").setting.state === "known");
    const release = r.host.demandOrg("hqGithub", ORG);
    await read;
    const done = waitFor(r.store, () => r.read("hqGithub").action.kind === "done");
    await r.host.write(ORG, { kind: "github-disconnect" });
    await done;
    expect(r.read("hqGithub").setting).toMatchObject({ state: "known", held: none });
    release();
    r.close();
  });

  const waiting: HqGithubView = {
    ...app,
    public: true,
    installations: [
      ...(app.state === "connected" ? app.installations : []),
      {
        id: 9,
        account: "stranger",
        accountType: "User",
        repositorySelection: "selected",
        repositories: [{ fullName: "stranger/notes", private: true, defaultBranch: "main" }],
        suspended: false,
        state: "waiting",
        manageUrl: "https://github.com/settings/installations/9",
      },
    ],
  };
  const standing = (view: HqGithubView, id: number) =>
    view.state === "connected"
      ? view.installations.find((installation) => installation.id === id)?.state
      : undefined;
  /** HQ holding a waiting installation 9, its answer to `write` of it leaving it `state`. */
  const judged = (
    write: "github-accept" | "github-suspend" | "github-resume",
    state: "accepted" | "suspended",
  ) => {
    let held = waiting;
    const asked: Array<number> = [];
    const change = async (id: number) => {
      asked.push(id);
      if (held.state === "connected")
        held = {
          ...held,
          installations: held.installations.map((installation) =>
            installation.id === id
              ? { ...installation, state, suspended: state === "suspended" }
              : installation,
          ),
        };
    };
    return {
      asked,
      api: {
        github: async () => held,
        ...(write === "github-accept"
          ? { githubAcceptInstallation: change }
          : write === "github-suspend"
            ? { githubSuspendInstallation: change }
            : { githubResumeInstallation: change }),
      },
    };
  };

  it.each([
    { title: "Accept makes its repositories available", write: "github-accept", state: "accepted" },
    { title: "Suspend takes it away", write: "github-suspend", state: "suspended" },
    { title: "Resume gives a suspended one back", write: "github-resume", state: "accepted" },
  ] as const)(
    "$title: HQ is asked for the installation, and a read after its answer has it $state",
    async ({ write, state }) => {
      const hq = judged(write, state);
      const r = rig(hq.api);
      const read = waitFor(r.store, () => r.read("hqGithub").setting.state === "known");
      const release = r.host.demandOrg("hqGithub", ORG);
      await read;
      const done = waitFor(r.store, () => r.read("hqGithub").action.kind === "done");
      await r.host.write(ORG, { kind: write, installationId: 9 });
      await done;
      expect(hq.asked).toEqual([9]);
      const setting = r.read("hqGithub").setting;
      expect(setting.state === "known" ? standing(setting.held as HqGithubView, 9) : null).toBe(
        state,
      );
      release();
      r.close();
    },
  );

  it("hands HQ's install link to the screen that asked, and keeps its one-time state out of every record", async () => {
    const sent: Array<unknown> = [];
    const url = `https://github.com/apps/acme-mate/installations/new?state=${STATE}`;
    const r = rig({
      github: async () => app,
      githubInstall: async (request) => {
        sent.push(request);
        return { url };
      },
    });
    expect(await r.host.githubInstall(ORG, "https://mate.example/settings")).toBe(url);
    expect(sent).toEqual([{ returnTo: "https://mate.example/settings" }]);
    expect(r.records()).not.toContain(STATE);
    r.close();
  });

  it("asks for an HQ update where this client's HQ calls have no Accept and no install link", async () => {
    const r = rig({ github: async () => waiting });
    await r.host.write(ORG, { kind: "github-accept", installationId: 9 });
    expect(r.read("hqGithub").action).toEqual({ kind: "failed", words: GITHUB_UNSUPPORTED });
    expect(await r.host.githubInstall(ORG, "https://mate.example/settings")).toBeNull();
    r.close();
  });

  it("an older HQ answering the install link with a bare 404 asks for an HQ update and hands nothing to open", async () => {
    const r = rig({
      github: async () => app,
      githubInstall: async () => {
        throw new HqError({
          kind: "refused",
          code: "http_404",
          status: 404,
          message: "Not found.",
        });
      },
    });
    expect(await r.host.githubInstall(ORG, "https://mate.example/settings")).toBeNull();
    expect(r.read("hqGithub").action).toEqual({ kind: "failed", words: GITHUB_UNSUPPORTED });
    r.close();
  });

  it.each([
    {
      case: "HQ answers that it has no such address",
      api: {
        github: async (): Promise<HqGithubView> => {
          throw new HqError({ kind: "refused", code: "not_found", status: 404, message: "No." });
        },
      },
    },
    { case: "this client's HQ reads no GitHub app", api: {} },
  ])("an HQ older than the GitHub app asks for an update: $case", async ({ api }) => {
    const r = rig(api);
    const read = waitFor(r.store, () => r.read("hqGithub").setting.state === "unsupported");
    const release = r.host.demandOrg("hqGithub", ORG);
    await read;
    expect(await r.host.githubManifest(ORG, asked)).toBeNull();
    expect(r.read("hqGithub").action).toEqual({ kind: "failed", words: GITHUB_UNSUPPORTED });
    release();
    r.close();
  });
});

describe("an application's tasks", () => {
  const task: HqAppTask = {
    id: "task-1",
    title: "Add a search box to the tea list",
    label: "acme/tea-shop#1",
    url: "https://github.com/acme/tea-shop/issues/1",
    state: "merged",
    mate: { projectId: "tea-raya", name: "Raya" },
    requestedBy: "juno",
    createdAt: "2026-10-17T08:00:00.000Z",
    startedAt: "2026-10-17T08:01:00.000Z",
    endedAt: "2026-10-17T08:21:00.000Z",
    spentUsd: 1.25,
    workedMs: 1_200_000,
    detail: null,
    change: { repo: "tea-shop", number: 2 },
    pullRequest: null,
    link: null,
  };
  it("reads what each cost and how long it worked while a screen shows them", async () => {
    const asked: Array<string> = [];
    const r = rig({
      appTasks: async (appId) => {
        asked.push(appId);
        return [task];
      },
    });
    const read = waitFor(r.store, () => r.read("hqAppTasks", "shop").setting.state === "known");
    const release = r.host.demandApp("hqAppTasks", SHOP);
    await read;
    expect(asked).toEqual(["shop"]);
    expect(r.read("hqAppTasks", "shop").setting).toMatchObject({ state: "known", held: [task] });
    release();
    r.close();
  });
  it("says HQ is too old where it has no task board", async () => {
    const r = rig({});
    const read = waitFor(r.store, () =>
      ["unsupported", "failed"].includes(r.read("hqAppTasks", "shop").setting.state),
    );
    const release = r.host.demandApp("hqAppTasks", SHOP);
    await read;
    expect(r.read("hqAppTasks", "shop").setting.state).toBe("unsupported");
    release();
    r.close();
  });
});

describe("a task's stop and the board's reads", () => {
  const task = (id: string, state: HqAppTask["state"]): HqAppTask => ({
    id,
    title: `Task ${id}`,
    label: `acme/tea-shop#${id}`,
    url: null,
    state,
    mate: { projectId: "P_JUNO", name: "Juno" },
    requestedBy: "nova",
    createdAt: "2026-10-18T08:00:00.000Z",
    startedAt: "2026-10-18T08:01:00.000Z",
    endedAt: null,
    spentUsd: 0.2,
    workedMs: 60_000,
    detail: null,
    change: null,
    pullRequest: null,
    link: null,
  });
  /** HQ's navigation placing Juno, automated, in Tea Shop, on `onTask`. */
  const place = (r: ReturnType<typeof rig>, onTask: Record<string, unknown> | null) =>
    commitOwn(r.store, "placement", placementsScope("org"), "P_JUNO", {
      projectId: "P_JUNO",
      appId: "shop",
      name: "Juno",
      kind: "mate",
      mate: { automated: true, task: onTask },
    } as never);
  const stops = (r: ReturnType<typeof rig>, taskIds: ReadonlyArray<string>) =>
    appTaskStops.derive(readsOfState(r.store.state()), { orgId: "org", appId: "shop", taskIds });

  it("keeps each task's stop apart: a second stop never hides the first one's refusal", async () => {
    const r = rig({
      appTasks: async () => [task("1", "working"), task("2", "queued")],
      stopAppTask: async (_appId, taskId) => {
        if (taskId === "1")
          throw new HqError({ kind: "refused", code: "conflict", message: "HQ said no." });
      },
    });
    const release = r.host.demandApp("hqAppTasks", SHOP);
    await waitFor(r.store, () => r.read("hqAppTasks", "shop").setting.state === "known");
    await r.host.write(SHOP, { kind: "task-stop", taskId: "1" });
    await r.host.write(SHOP, { kind: "task-stop", taskId: "2" });
    await waitFor(r.store, () => stops(r, ["2"])["2"]?.kind === "done");
    expect(stops(r, ["1", "2"])).toEqual({
      "1": { kind: "failed", words: "HQ said no." },
      "2": { kind: "done", verb: "task-stop" },
    });
    expect(r.read("hqAppTasks", "shop").action).toEqual({ kind: "idle" });
    release();
    r.close();
  });

  it.each([
    [
      "asks for HQ to be updated where it has no stop of a task",
      new HqError({
        kind: "refused",
        code: "http_404",
        status: 404,
        message: "HQ refused this (http_404).",
      }),
      "Update HQ to stop tasks from Mate.",
    ],
    [
      "says only an Owner or Admin stops a task where HQ refuses the person",
      new HqError({
        kind: "refused",
        code: "forbidden",
        status: 403,
        message: "HQ refused this (forbidden).",
      }),
      "Only an Owner or Admin can stop a task.",
    ],
    [
      "says a task that ended meanwhile has nothing to stop",
      new HqError({
        kind: "refused",
        code: "not_found",
        reason: "task_not_found",
        status: 404,
        message: "HQ refused this (task_not_found).",
      }),
      "That task has ended already.",
    ],
  ])("%s", async (_title, refusal, words) => {
    const r = rig({
      appTasks: async () => [task("1", "working")],
      stopAppTask: async () => {
        throw refusal;
      },
    });
    await r.host.write(SHOP, { kind: "task-stop", taskId: "1" });
    expect(stops(r, ["1"])).toEqual({ "1": { kind: "failed", words } });
    r.close();
  });

  it("reads the board again as navigation says a Mate's task moved, never as only its cost and time do", async () => {
    let reads = 0;
    const r = rig({
      appTasks: async () => {
        reads++;
        return [task("1", "working")];
      },
    });
    place(r, { id: "1", title: "Task 1", url: null, spentUsd: 0.1, workedMs: 1_000 });
    const release = r.host.demandApp("hqAppTasks", SHOP);
    await waitFor(r.store, () => r.read("hqAppTasks", "shop").setting.state === "known");
    expect(reads).toBe(1);
    place(r, { id: "1", title: "Task 1", url: null, spentUsd: 0.4, workedMs: 90_000 });
    await Promise.resolve();
    expect(reads).toBe(1);
    const reread = waitFor(r.store, () => reads === 2);
    place(r, {
      id: "1",
      title: "Task 1",
      url: null,
      waiting: true,
      spentUsd: 0.4,
      workedMs: 90_000,
    });
    await reread;
    const again = waitFor(r.store, () => reads === 3);
    place(r, { id: "2", title: "Task 2", url: null });
    await again;
    release();
    place(r, { id: "2", title: "Task 2", url: null, ended: "done" });
    await Promise.resolve();
    expect(reads).toBe(3);
    r.close();
  });

  it("reads the month's spend again as an automated task ends", async () => {
    let reads = 0;
    const r = rig({
      taskLimits: async () => {
        reads++;
        return { minutes: 60, costUsd: null, spentThisMonthUsd: reads };
      },
    });
    place(r, { id: "1", title: "Task 1", url: null });
    const release = r.host.demandOrg("hqTaskLimits", ORG);
    await waitFor(r.store, () => r.read("hqTaskLimits").setting.state === "known");
    const reread = waitFor(r.store, () => reads === 2);
    place(r, { id: "1", title: "Task 1", url: null, ended: "merged" });
    await reread;
    expect(r.read("hqTaskLimits").setting).toMatchObject({
      state: "known",
      held: { spentThisMonthUsd: 2 },
    });
    release();
    r.close();
  });
});
