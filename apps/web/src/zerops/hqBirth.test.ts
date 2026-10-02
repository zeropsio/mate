import {
  HQ_BIRTH_START,
  type HqBirthOutcome,
  type HqBirthRecord,
} from "@t3tools/client-runtime/zerops/hq";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import {
  accountHqBirthStorage,
  bearHq,
  bearHqOnce,
  hqBirthView,
  useHqBirths,
  type HqBirthStorage,
} from "./hqBirth";
import type { LockManagerLike } from "./mateLocks";

const HQ = { projectId: "hq-1", address: "https://hq-1-8080.prg1.zerops.app" } as const;
const BORN: HqBirthOutcome = { ok: true, hq: HQ };

/** What this browser keeps of each birth, in memory. */
function keptBirths(initial: Readonly<Record<string, HqBirthRecord>> = {}) {
  const kept = new Map(Object.entries(initial));
  const storage: HqBirthStorage = {
    read: (clientId) => kept.get(clientId),
    write: (clientId, record) => {
      kept.set(clientId, record);
    },
    forget: (clientId) => {
      kept.delete(clientId);
    },
  };
  return { kept, storage };
}

/** The browser's locks: one holder per name, the others waiting their turn. */
function browserLocksFake(): LockManagerLike {
  const tails = new Map<string, Promise<unknown>>();
  return {
    request: (name, _options, hold) => {
      const before = tails.get(name) ?? Promise.resolve();
      const turn = before.then(() => hold({}));
      tails.set(
        name,
        turn.catch(() => undefined),
      );
      return turn;
    },
  };
}

const AT_DEPLOY: HqBirthRecord = {
  ...HQ_BIRTH_START,
  step: "deploy",
  projectId: "hq-1",
  serviceId: "svc-hq",
  address: HQ.address,
};

describe("bearHqOnce — one birth, under the organization's lock", () => {
  it("goes on after a reload from the step this browser kept, keeping every step it reaches", async () => {
    const { kept, storage } = keptBirths({ "org-1": AT_DEPLOY });
    const run = vi.fn(
      async (record: HqBirthRecord, moved: (patch: Partial<HqBirthRecord>) => void) => {
        moved({ step: "ready" });
        expect(kept.get("org-1")).toEqual({ ...record, step: "ready" });
        moved({ step: "done" });
        return BORN;
      },
    );
    const ended = await bearHqOnce({
      clientId: "org-1",
      locks: undefined,
      storage,
      startOver: false,
      alreadyBorn: async () => false,
      run,
      moved: () => undefined,
    });
    expect(ended).toEqual({ ok: true });
    expect(run).toHaveBeenCalledWith(AT_DEPLOY, expect.any(Function));
    // HQ stands: nothing is kept to go on from.
    expect(kept.has("org-1")).toBe(false);
  });

  it("starts over from nothing only when asked to", async () => {
    const { storage } = keptBirths({
      "org-1": { ...HQ_BIRTH_START, importTag: "mate:hq-birth:b0" },
    });
    const run = vi.fn(async () => BORN);
    await bearHqOnce({
      clientId: "org-1",
      locks: undefined,
      storage,
      startOver: true,
      alreadyBorn: async () => false,
      run,
      moved: () => undefined,
    });
    expect(run).toHaveBeenCalledWith(HQ_BIRTH_START, expect.any(Function));
  });

  it("makes nothing in a second tab: it waits for the first, and finds HQ born", async () => {
    const { storage } = keptBirths();
    const locks = browserLocksFake();
    let born = false;
    const run = vi.fn(async () => {
      await Promise.resolve();
      born = true;
      return BORN;
    });
    const tab = () =>
      bearHqOnce({
        clientId: "org-1",
        locks,
        storage,
        startOver: false,
        alreadyBorn: async () => born,
        run,
        moved: () => undefined,
      });
    expect(await Promise.all([tab(), tab()])).toEqual([{ ok: true }, { ok: true }]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("names the project step where the member list could not be read first", async () => {
    const { storage } = keptBirths();
    const run = vi.fn(async () => BORN);
    const ended = await bearHqOnce({
      clientId: "org-1",
      locks: undefined,
      storage,
      startOver: false,
      alreadyBorn: async () => {
        throw new Error("Zerops could not be reached.");
      },
      run,
      moved: () => undefined,
    });
    expect(ended).toEqual({
      ok: false,
      step: "project",
      reason: "Zerops could not be reached.",
      uncertain: false,
    });
    expect(run).not.toHaveBeenCalled();
  });
});

describe("bearHq — the birth the gate runs", () => {
  beforeEach(() => {
    openAccountLifetime("u-ada");
    useHqBirths.setState({ byOrg: {} });
  });
  afterEach(() => {
    closeAccountLifetime();
  });

  const held = () => useHqBirths.getState().byOrg["org-1"];

  it("says the step it is on, names the step that stopped it, and Try again goes on from there", async () => {
    const { storage } = keptBirths();
    const onBorn = vi.fn();
    let fail = true;
    const run = vi.fn(
      async (_record: HqBirthRecord, moved: (patch: Partial<HqBirthRecord>) => void) => {
        await Promise.resolve();
        moved({ step: "deploy", projectId: "hq-1" });
        if (fail) {
          return {
            ok: false as const,
            step: "deploy" as const,
            reason: "offline.",
            uncertain: false,
          };
        }
        moved({ step: "done" });
        return BORN;
      },
    );
    const ask = () =>
      bearHq({
        clientId: "org-1",
        run,
        alreadyBorn: async () => false,
        onBorn,
        storage,
        locks: undefined,
      });

    ask();
    expect(hqBirthView(held())).toEqual({ kind: "running", step: "project" });
    await vi.waitFor(() => expect(held()?.failed).not.toBeNull());
    expect(hqBirthView(held())).toEqual({
      kind: "failed",
      step: "deploy",
      reason: "offline.",
      startOver: false,
    });

    fail = false;
    ask();
    await vi.waitFor(() => expect(onBorn).toHaveBeenCalledTimes(1));
    expect(run.mock.calls[1]?.[0]).toMatchObject({ step: "deploy", projectId: "hq-1" });
    // Held as done until the member list names HQ: asking again bears nothing.
    expect(held()).toMatchObject({ running: false, failed: null, record: { step: "done" } });
  });

  it("runs once at a time; after a stop that may have made HQ's project, Try again looks again and Start over begins anew", async () => {
    const { storage } = keptBirths();
    let finish: (outcome: HqBirthOutcome) => void = () => undefined;
    const run = vi.fn(
      (_record: HqBirthRecord) =>
        new Promise<HqBirthOutcome>((resolve) => {
          finish = resolve;
        }),
    );
    const ask = (startOver = false) =>
      bearHq({
        clientId: "org-1",
        run,
        alreadyBorn: async () => false,
        onBorn: () => undefined,
        storage,
        locks: undefined,
        startOver,
      });
    ask();
    ask();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));

    finish({ ok: false, step: "project", reason: "Unsure.", uncertain: true });
    await vi.waitFor(() => expect(held()?.failed?.uncertain).toBe(true));
    expect(hqBirthView(held())).toMatchObject({ kind: "failed", startOver: true });
    // Try again never imports over an unanswered import (`runHqBirth`): it looks for its tag again.
    ask();
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2));
    finish({ ok: false, step: "project", reason: "Unsure.", uncertain: true });
    await vi.waitFor(() => expect(held()?.running).toBe(false));

    ask(true);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(3));
    expect(run.mock.calls[2]?.[0]).toEqual(HQ_BIRTH_START);
  });

  it("forgets what it shows once its account is signed out, and keeps what it made for the next sign-in", () => {
    const { kept, storage } = keptBirths({ "org-1": AT_DEPLOY });
    bearHq({
      clientId: "org-1",
      run: () => new Promise(() => undefined),
      alreadyBorn: () => new Promise(() => undefined),
      onBorn: () => undefined,
      storage,
      locks: undefined,
    });
    closeAccountLifetime();
    expect(useHqBirths.getState().byOrg).toEqual({});
    expect(kept.get("org-1")).toEqual(AT_DEPLOY);
  });
});

describe("accountHqBirthStorage — what this browser keeps of a birth", () => {
  const stored = new Map<string, string>();
  beforeEach(() => {
    stored.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
        removeItem: (key: string) => stored.delete(key),
      },
    });
  });
  afterEach(() => {
    closeAccountLifetime();
    vi.unstubAllGlobals();
  });

  it("keeps each organization's record for the account, through a sign-out and back", () => {
    openAccountLifetime("u-ada");
    accountHqBirthStorage.write("org-1", AT_DEPLOY);
    accountHqBirthStorage.write("org-2", HQ_BIRTH_START);
    closeAccountLifetime();
    openAccountLifetime("u-jan");
    expect(accountHqBirthStorage.read("org-1")).toBeUndefined();
    closeAccountLifetime();
    openAccountLifetime("u-ada");
    expect(accountHqBirthStorage.read("org-1")).toEqual(AT_DEPLOY);
    accountHqBirthStorage.forget("org-1");
    expect(accountHqBirthStorage.read("org-1")).toBeUndefined();
    expect(accountHqBirthStorage.read("org-2")).toEqual(HQ_BIRTH_START);
  });
});
