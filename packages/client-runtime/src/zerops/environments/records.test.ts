import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  LEGACY_REGISTRATION_KEYS,
  makeRegistrationRecords,
  REGISTRATION_RECORDS_KEY,
  type RecordsStorage,
} from "./records.ts";

/** One account's storage, counting every read and write by key. */
function fakeStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const reads: Array<string> = [];
  const writes: Array<string> = [];
  const storage: RecordsStorage = {
    getItem: (key) => {
      reads.push(key);
      return values.get(key) ?? null;
    },
    setItem: (key, value) => {
      writes.push(key);
      values.set(key, value);
    },
  };
  return { storage, values, reads, writes };
}

const ENV_A = EnvironmentId.make("environment-a");
const ENV_B = EnvironmentId.make("environment-b");

/** What a build before the switch left in one account's storage: Mates in two organizations. */
const preSwitch = (): Record<string, string> => ({
  [LEGACY_REGISTRATION_KEYS.targets]: JSON.stringify([
    { key: "project-a:service-a", environmentId: ENV_A },
    { key: "project-b:service-b", environmentId: ENV_B },
  ]),
  [LEGACY_REGISTRATION_KEYS.projectRefs]: JSON.stringify({
    [ENV_A]: { projectId: "project-a", orgId: "org-1", learnedAt: 1, source: "connect" },
    [ENV_B]: { projectId: "project-b", orgId: "org-2", learnedAt: 2, source: "match" },
  }),
  "zerops-mate.zerops-environments.v1": JSON.stringify([ENV_A, ENV_B]),
});

describe("registration records (DESIGN §2.C C1)", () => {
  it("remembered Mates across orgs survive the switch", () => {
    const { storage } = fakeStorage(preSwitch());

    expect(makeRegistrationRecords(storage).list()).toEqual([
      {
        targetKey: "project-a:service-a",
        environmentId: ENV_A,
        origin: null,
        projectRef: { projectId: "project-a", orgId: "org-1" },
        name: null,
      },
      {
        targetKey: "project-b:service-b",
        environmentId: ENV_B,
        origin: null,
        projectRef: { projectId: "project-b", orgId: "org-2" },
        name: null,
      },
    ]);
  });

  it("the legacy keys are read once and never written or deleted", () => {
    const { storage, reads, writes } = fakeStorage(preSwitch());
    const legacy: ReadonlyArray<string> = Object.values(LEGACY_REGISTRATION_KEYS);

    makeRegistrationRecords(storage).list();
    const records = makeRegistrationRecords(storage);
    records.list();
    records.list();

    for (const key of legacy) {
      expect(reads.filter((read) => read === key)).toHaveLength(1);
    }
    expect(writes).toEqual([REGISTRATION_RECORDS_KEY]);
    expect(records.list()).toHaveLength(2);
  });

  it("an older build redeployed still finds the pre-switch keys", () => {
    const before = preSwitch();
    const { storage, values } = fakeStorage(before);
    const records = makeRegistrationRecords(storage);

    records.list();
    records.remember({
      targetKey: "project-a:service-a",
      environmentId: EnvironmentId.make("environment-a-redeployed"),
      origin: "https://zcp-a-8080.prg1.zerops.app",
      projectRef: { projectId: "project-a", orgId: "org-1" },
      name: "shop",
    });
    records.remember({
      targetKey: "project-c:service-c",
      environmentId: EnvironmentId.make("environment-c"),
      origin: "https://zcp-c-8080.prg1.zerops.app",
      projectRef: null,
      name: "blog",
    });

    for (const [key, value] of Object.entries(before)) expect(values.get(key)).toBe(value);
  });

  it("an exchange's record replaces its target's older one, and an unchanged one writes nothing", () => {
    const { storage, writes } = fakeStorage(preSwitch());
    const records = makeRegistrationRecords(storage);
    const redeployed = {
      targetKey: "project-a:service-a",
      environmentId: EnvironmentId.make("environment-a-redeployed"),
      origin: "https://zcp-a-8080.prg1.zerops.app",
      projectRef: { projectId: "project-a", orgId: "org-1" },
      name: "shop",
    };

    expect(records.remember(redeployed)).toBe(true);
    expect(
      records.remember({
        name: "shop",
        projectRef: { orgId: "org-1", projectId: "project-a" },
        origin: "https://zcp-a-8080.prg1.zerops.app",
        environmentId: EnvironmentId.make("environment-a-redeployed"),
        targetKey: "project-a:service-a",
      }),
    ).toBe(false);

    expect(makeRegistrationRecords(storage).list()).toEqual([
      expect.objectContaining({ targetKey: "project-b:service-b", environmentId: ENV_B }),
      redeployed,
    ]);
    expect(writes).toHaveLength(2);
  });

  it("what an exchange could not learn keeps what its target's record knew", () => {
    const { storage } = fakeStorage(preSwitch());
    const records = makeRegistrationRecords(storage);

    records.remember({
      targetKey: "project-a:service-a",
      environmentId: ENV_A,
      origin: "https://zcp-a-8080.prg1.zerops.app",
      projectRef: null,
      name: null,
    });

    expect(records.list().find((record) => record.targetKey === "project-a:service-a")).toEqual({
      targetKey: "project-a:service-a",
      environmentId: ENV_A,
      origin: "https://zcp-a-8080.prg1.zerops.app",
      projectRef: { projectId: "project-a", orgId: "org-1" },
      name: null,
    });
  });

  it("a storage that keeps no write still answers the same list each read", () => {
    const { storage } = fakeStorage(preSwitch());
    const records = makeRegistrationRecords({ getItem: storage.getItem, setItem: () => undefined });

    expect(records.list()).toHaveLength(2);
    expect(records.list()).toBe(records.list());
  });
});
