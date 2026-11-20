import { expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import type { HqIntakeView, HqWebhookView } from "@t3tools/shared/hqIntake";
import type { HqGithubManifestView } from "@t3tools/shared/hqGithub";
import { appIntake } from "../projections/hqAutomation.ts";
import { taskSourceSetting } from "../projections/hqTaskSources.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { makeAutomationSettings } from "./hqAutomation.ts";
import { makeTaskSourceSettings } from "./hqTaskSources.ts";

type AutomationApi = Parameters<typeof makeAutomationSettings>[0]["api"];
type TaskSourceApi = Parameters<typeof makeTaskSourceSettings>[0]["api"];
const notFaked = () => Promise.reject(new Error("v0"));
/** An HQ that answers only the calls given; every other call fails. */
const hqOf = <Api extends object>(faked: Partial<Api>): Api =>
  new Proxy(faked, { get: (target, name) => Reflect.get(target, name) ?? notFaked }) as Api;

const ORG = { orgId: "v1" };
const APP = { orgId: "v1", appId: "v2" };

/** Both hosts of one account, and every record the account holds, as text. */
function account(automation: Partial<AutomationApi>, taskSources: Partial<TaskSourceApi>) {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let id = 0;
  const makeId = () => `v-request-${++id}`;
  const settings = makeAutomationSettings({ store, api: hqOf(automation), makeId });
  const sources = makeTaskSourceSettings({ store, api: hqOf(taskSources), makeId });
  return {
    settings,
    sources,
    records: () =>
      JSON.stringify([...store.state().facts.values(), ...store.state().operations.values()]),
    intake: () => appIntake.derive(readsOfState(store.state()), APP).answer,
    webhook: () =>
      taskSourceSetting.derive(readsOfState(store.state()), { family: "hqAppWebhooks", ...APP })
        .revealed,
    close: () => {
      settings.close();
      sources.close();
      registry.dispose();
    },
  };
}

// witness: packages/client-runtime/src/data/adapters/hqAutomation.ts | run({ kind: "set-ai-key", orgId: key.orgId, provider }, requestId) → run({ kind: "set-ai-key", orgId: key.orgId, provider, value }, requestId)
it("AD64: An org API key's value, a Slack bot token or signing secret, and a GitHub app's one-time manifest or install state never enter a held record", async () => {
  const secrets = {
    key: "v-secret-api-key",
    botToken: "v-secret-bot-token",
    signing: "v-secret-signing",
    manifestState: "v-secret-manifest-state",
    installState: "v-secret-install-state",
  };
  const manifest: HqGithubManifestView = {
    postUrl: `https://v3.test/new?state=${secrets.manifestState}`,
    manifest: "{}",
    state: secrets.manifestState,
  };
  const installUrl = `https://v3.test/install?state=${secrets.installState}`;
  const hq = account(
    {
      aiKeys: async () => [],
      setAiKey: async (provider) => ({ provider, set: true, setAt: null, setBy: null }),
    },
    {
      connectSlack: async () => ({
        connected: true,
        workspace: "v4",
        eventsUrl: "https://v3.test/events",
        eventsRefusedAt: null,
        eventsAcceptedAt: null,
        connectedBy: null,
        connectedAt: null,
      }),
      githubManifest: async () => manifest,
      githubInstall: async () => ({ url: installUrl }),
    },
  );

  await hq.settings.setKey(ORG, "v5", secrets.key);
  await hq.sources.write(
    ORG,
    { kind: "slack-connect" },
    { botToken: secrets.botToken, signingSecret: secrets.signing },
  );
  expect(await hq.sources.githubManifest(ORG, { owner: null, name: "v6", returnTo: "v7" })).toEqual(
    manifest,
  );
  expect(await hq.sources.githubInstall(ORG, 8, "v7")).toBe(installUrl);

  const records = hq.records();
  for (const secret of Object.values(secrets)) expect(records, secret).not.toContain(secret);
  hq.close();
});

// witness: packages/client-runtime/src/data/adapters/hqAutomation.ts | held.epoch === (epochs.get(intakeId(held.key)) ?? 0) → held.epoch <= (epochs.get(intakeId(held.key)) ?? 0)
it("AD65: A webhook's or an intake's secret shows only while the screen that made it is open; one answering after it closed is never shown", async () => {
  const paste: HqIntakeView = {
    appId: APP.appId,
    repo: "v8/v9",
    label: "v10",
    public: false,
    webhookUrl: "https://v3.test/hook",
    hook: { kind: "paste", secret: "v-secret-intake", why: "v11" },
  };
  const made: HqWebhookView = {
    id: "v12",
    name: "v13",
    url: "https://v3.test/webhook",
    secret: "v-secret-webhook",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
  const late: Array<() => void> = [];
  let answerLate = false;
  const hq = account(
    {
      setIntake: () =>
        answerLate
          ? new Promise((resolve) => void late.push(() => resolve(paste)))
          : Promise.resolve(paste),
    },
    {
      webhooks: async () => [],
      makeWebhook: () =>
        answerLate
          ? new Promise((resolve) => void late.push(() => resolve(made)))
          : Promise.resolve(made),
    },
  );

  // The screen open while HQ answers shows each secret; closing it forgets them.
  const intakeScreen = hq.settings.holdIntake(APP);
  const webhookScreen = hq.sources.holdWebhooks(APP);
  await hq.settings.setIntake(APP, paste.repo, paste.label);
  await hq.sources.write(APP, { kind: "webhook-make", name: made.name });
  expect(hq.intake()).toEqual(paste);
  expect(hq.webhook()).toEqual(made);
  intakeScreen();
  webhookScreen();
  expect(hq.intake()).toBeNull();
  expect(hq.webhook()).toBeNull();

  // An answer arriving after its screen closed is never shown, not even on the screen opened again.
  answerLate = true;
  const closedIntake = hq.settings.holdIntake(APP);
  const closedWebhooks = hq.sources.holdWebhooks(APP);
  const setting = hq.settings.setIntake(APP, paste.repo, paste.label);
  const making = hq.sources.write(APP, { kind: "webhook-make", name: made.name });
  closedIntake();
  closedWebhooks();
  const reopenedIntake = hq.settings.holdIntake(APP);
  const reopenedWebhooks = hq.sources.holdWebhooks(APP);
  for (const answer of late) answer();
  await Promise.all([setting, making]);
  expect(hq.intake()).toBeNull();
  expect(hq.webhook()).toBeNull();
  reopenedIntake();
  reopenedWebhooks();
  hq.close();
});
