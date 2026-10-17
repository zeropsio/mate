import { describe, expect, it } from "vite-plus/test";
import { AtomRegistry } from "effect/reactivity";
import type { HqAiKeyView, HqIntakeView } from "@t3tools/shared/hqIntake";
import { HqError } from "../../zerops/hq/client.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { appIntake, orgAiKeys } from "../projections/hqAutomation.ts";
import { makeAutomationSettings } from "./hqAutomation.ts";

const ORG = { orgId: "org" };
const SHOP = { orgId: "org", appId: "shop" };
// Built from parts: never a whole secret-shaped literal in the source.
const SECRET = ["whsec", "tea", "shop", "0001"].join("_");
const KEY = ["nb", "key", "acme", "42"].join("-");

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

function rig(api: Parameters<typeof makeAutomationSettings>[0]["api"]) {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  let id = 0;
  const host = makeAutomationSettings({ store, api, makeId: () => `request-${++id}` });
  return {
    store,
    host,
    keys: () => orgAiKeys.derive(readsOfState(store.state()), ORG),
    intake: () => appIntake.derive(readsOfState(store.state()), SHOP),
    close: () => {
      host.close();
      registry.dispose();
    },
  };
}

const unset: HqAiKeyView = { provider: "nebius", set: false, setAt: null };
const set: HqAiKeyView = { provider: "nebius", set: true, setAt: "2026-10-17T09:00:00.000Z" };

describe("the organization's API keys", () => {
  it("reads whether each key is set while a screen shows them, and keeps a key's value out of every record", async () => {
    let held: HqAiKeyView = unset;
    const sent: Array<[string, string]> = [];
    const r = rig({
      aiKeys: async () => [held],
      setAiKey: async (provider, value) => {
        sent.push([provider, value]);
        held = set;
        return set;
      },
    });
    expect(r.keys().keys.state).toBe("unread");
    const read = waitFor(r.store, () => r.keys().keys.state === "known");
    const release = r.host.demandKeys(ORG);
    await read;
    expect(r.keys().keys).toMatchObject({ state: "known", keys: [unset] });
    const reread = waitFor(
      r.store,
      () => r.keys().keys.state === "known" && JSON.stringify(r.keys().keys).includes('"set":true'),
    );
    await r.host.setKey(ORG, "nebius", KEY);
    await reread;
    expect(sent).toEqual([["nebius", KEY]]);
    expect(r.keys().action).toEqual({ kind: "done", verb: "set" });
    expect(JSON.stringify([...r.store.state().operations.values()])).not.toContain(KEY);
    expect(JSON.stringify([...r.store.state().facts.values()])).not.toContain(KEY);
    release();
    r.close();
  });

  it.each([
    {
      case: "a key saved reads as set at once, before the list is read again",
      before: unset,
      write: "set" as const,
      after: set,
    },
    {
      case: "a key removed reads as not set at once, before the list is read again",
      before: set,
      write: "remove" as const,
      after: { provider: "nebius", set: false, setAt: null },
    },
  ])("$case", async ({ before, write, after }) => {
    let reads = 0;
    let answerReread: (keys: ReadonlyArray<HqAiKeyView>) => void = () => {};
    let rereadAsked: () => void = () => {};
    const reread = new Promise<void>((resolve) => {
      rereadAsked = resolve;
    });
    const r = rig({
      aiKeys: () => {
        reads++;
        if (reads === 1) return Promise.resolve([before]);
        rereadAsked();
        return new Promise((resolve) => {
          answerReread = resolve;
        });
      },
      setAiKey: async () => set,
      removeAiKey: async () => {},
    });
    const read = waitFor(r.store, () => r.keys().keys.state === "known");
    const release = r.host.demandKeys(ORG);
    await read;
    if (write === "set") await r.host.setKey(ORG, "nebius", KEY);
    else await r.host.removeKey(ORG, "nebius");
    expect(r.keys().keys).toMatchObject({ state: "known", keys: [after] });
    // The list read again confirms it, and says what HQ holds from then on.
    await reread;
    expect(r.keys().keys).toMatchObject({ state: "known", keys: [after] });
    const later = { provider: "nebius", set: true, setAt: "2026-10-18T09:00:00.000Z" };
    const settled = waitFor(r.store, () => JSON.stringify(r.keys().keys).includes("10-18"));
    answerReread([later]);
    await settled;
    expect(r.keys().keys).toMatchObject({ state: "known", keys: [later] });
    release();
    r.close();
  });

  it("says HQ's refusal of a key, never the key itself", async () => {
    const r = rig({
      aiKeys: async () => [unset],
      setAiKey: async (_provider, value) => {
        throw new HqError({ kind: "refused", code: "invalid", message: `Rejected ${value}` });
      },
    });
    await r.host.setKey(ORG, "nebius", KEY);
    expect(r.keys().action).toEqual({ kind: "failed", words: "HQ did not take this key." });
    r.close();
  });

  it.each([
    {
      case: "HQ answers that it has no such address",
      api: {
        aiKeys: async (): Promise<ReadonlyArray<HqAiKeyView>> => {
          throw new HqError({
            kind: "refused",
            code: "not_found",
            status: 404,
            message: "Not found.",
          });
        },
      },
    },
    { case: "this client's HQ reads no keys", api: {} },
  ])("an HQ that keeps no organization keys can't do automated Mates: $case", async ({ api }) => {
    const r = rig(api);
    const read = waitFor(r.store, () => r.keys().keys.state === "unsupported");
    const release = r.host.demandKeys(ORG);
    await read;
    expect(r.keys().keys).toEqual({ state: "unsupported" });
    release();
    r.close();
  });

  it("asks for an update where HQ does not keep organization keys yet", async () => {
    const r = rig({});
    await r.host.setKey(ORG, "nebius", KEY);
    expect(r.keys().action).toEqual({
      kind: "failed",
      words: "Update HQ to set up automated Mates.",
    });
    r.close();
  });
});

describe("an application's intake", () => {
  const paste: HqIntakeView = {
    appId: "shop",
    repo: "acme/tea-shop",
    label: "mate",
    webhookUrl: "https://hq.example/api/github/webhook",
    hook: { kind: "paste", secret: SECRET, why: "The repository's token may not make webhooks." },
  };

  it("shows the secret to paste while the screen that set it is open, and forgets it once closed", async () => {
    const r = rig({ setIntake: async () => paste });
    const release = r.host.holdIntake(SHOP);
    await r.host.setIntake(SHOP, "acme/tea-shop", "mate");
    expect(r.intake().answer).toEqual(paste);
    expect(JSON.stringify([...r.store.state().operations.values()])).not.toContain(SECRET);
    release();
    expect(r.intake().answer).toBeNull();
    expect(JSON.stringify([...r.store.state().facts.values()])).not.toContain(SECRET);
    r.close();
  });

  it("never shows a secret whose answer came after its screen closed", async () => {
    let answer: (view: HqIntakeView) => void = () => {};
    const r = rig({
      setIntake: () =>
        new Promise<HqIntakeView>((resolve) => {
          answer = resolve;
        }),
    });
    const release = r.host.holdIntake(SHOP);
    const setting = r.host.setIntake(SHOP, "acme/tea-shop", "mate");
    expect(r.intake().action).toEqual({ kind: "working", verb: "set" });
    release();
    answer(paste);
    await setting;
    expect(r.intake().answer).toBeNull();
    r.close();
  });
});
