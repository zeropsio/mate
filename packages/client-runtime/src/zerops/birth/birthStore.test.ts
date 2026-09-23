import { describe, expect, it } from "vite-plus/test";

import { selectAutoConnectTargets, type AutoConnectCandidate } from "../autoConnect.ts";
import type { ZeropsCreationHandoff } from "../creationHandoff.ts";
import {
  BIRTHS_KEY,
  makeBirthStore,
  parseBirths,
  unhardenedBirths,
  type BeginBirth,
  type BirthsStorage,
} from "./birthStore.ts";

const STARTED_AT = 1_800_000_000_000;

function memoryStorage(): BirthsStorage & { readonly values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

const handoff: ZeropsCreationHandoff = {
  environmentName: "Todo - Vera",
  groupName: "Todo",
  role: "dev",
  source: { kind: "none" },
};

const mate: BeginBirth = {
  projectId: "project-1",
  organizationId: "org-1",
  registration: {
    giteaProjectId: "gitea-1",
    giteaOrigin: null,
    groupId: "group-1",
    kind: "mate",
    displayName: "Todo - Vera",
  },
  container: true,
  handoff,
};

describe("the birth store", () => {
  it("keeps a birth from create-accepted until its connect, then the job under its environment", () => {
    const storage = memoryStorage();
    const store = makeBirthStore({ storage, now: () => STARTED_AT });

    store.begin(mate);
    expect(store.birth("project-1")).toEqual({
      projectId: "project-1",
      organizationId: "org-1",
      startedAt: STARTED_AT,
      step: "tags",
      overdue: false,
      registration: mate.registration,
      container: true,
      serviceId: null,
      origin: null,
      handoff,
    });
    // A reload reads the same record back.
    expect(makeBirthStore({ storage, now: () => 0 }).birth("project-1")).toEqual(
      store.birth("project-1"),
    );

    store.promote("project-1", "environment-1");
    expect(store.birth("project-1")).toBeUndefined();
    expect(store.job("environment-1")).toEqual(handoff);
    store.forgetJob("environment-1");
    expect(store.job("environment-1")).toBeUndefined();
    expect(JSON.parse(storage.values.get(BIRTHS_KEY) ?? "null")).toEqual({ births: [], jobs: {} });
  });
});

describe("the birth store's records", () => {
  it("leaves a connect to a project nobody created alone", () => {
    const storage = memoryStorage();
    const store = makeBirthStore({ storage, now: () => STARTED_AT });
    store.begin(mate);
    const before = storage.values.get(BIRTHS_KEY);
    store.promote("project-9", "environment-9");
    expect(storage.values.get(BIRTHS_KEY)).toBe(before);
    expect(store.job("environment-9")).toBeUndefined();
  });

  it("forgets a birth whose project was removed, and only that one", () => {
    const store = makeBirthStore({ storage: memoryStorage(), now: () => STARTED_AT });
    store.begin(mate);
    store.begin({ ...mate, projectId: "project-2" });
    store.forget("project-1");
    expect(store.ledger().births.map((birth) => birth.projectId)).toEqual(["project-2"]);
  });

  it("a birth begun again keeps the job it already had", () => {
    const store = makeBirthStore({ storage: memoryStorage(), now: () => STARTED_AT });
    store.begin(mate);
    store.update("project-1", { step: "harden" });
    // Set up Mate on a Mate whose container never came: harden again, the job kept.
    store.begin({ ...mate, registration: null, handoff: null });
    expect(store.birth("project-1")).toMatchObject({ step: "harden", handoff });
  });

  it("follows another tab's writes on reload, and ignores what it cannot read", () => {
    const storage = memoryStorage();
    const here = makeBirthStore({ storage, now: () => STARTED_AT });
    let heard = 0;
    here.subscribe(() => {
      heard += 1;
    });
    const there = makeBirthStore({ storage, now: () => STARTED_AT });
    there.begin(mate);
    expect(here.birth("project-1")).toBeUndefined();
    here.reload();
    expect(here.birth("project-1")?.step).toBe("tags");
    expect(heard).toBe(1);
    here.reload();
    expect(heard).toBe(1);

    for (const raw of [null, "", "[]", "{oops", '{"births":[{"projectId":"p"}],"jobs":{"e":1}}']) {
      expect(parseBirths(raw)).toEqual({ births: [], jobs: {} });
    }
  });
});

describe("a storage that refuses", () => {
  it("keeps the births in this tab's memory", () => {
    const refusing: BirthsStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const store = makeBirthStore({ storage: refusing, now: () => STARTED_AT });
    store.begin(mate);
    store.update("project-1", { step: "harden" });
    expect(store.birth("project-1")?.step).toBe("harden");
    store.promote("project-1", "environment-1");
    expect(store.job("environment-1")).toEqual(handoff);
  });
});

describe("auto-connect over births", () => {
  const born: AutoConnectCandidate = {
    key: "project-1:zcp",
    project: { id: "project-1", name: "Todo - Vera", status: "ACTIVE", clientId: "org-1" },
    group: "ready",
    service: { id: "zcp", name: "zcp", status: "ACTIVE" },
    containerOrigin: "https://zcp-project-1-8080.prg1.zerops.app",
  };
  const answered = new Map([["project-1:zcp", "ready" as const]]);

  it("unhardened Mate not auto-connected", () => {
    let now = STARTED_AT;
    const store = makeBirthStore({ storage: memoryStorage(), now: () => now });
    store.begin(mate);
    store.update("project-1", { step: "harden", overdue: true });
    // Long past any boot: a birth has no expiry, so it is never admitted on age.
    now += 60 * 60_000;
    const wanted = () =>
      selectAutoConnectTargets({
        candidates: [born],
        health: answered,
        birthProjectIds: unhardenedBirths(store.ledger().births),
      });
    expect(wanted()).toEqual([]);

    store.update("project-1", { step: "health", overdue: false });
    expect(wanted()).toEqual(["project-1:zcp"]);
  });
});
