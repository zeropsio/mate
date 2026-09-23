import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
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

/** One account's remembered Mates in two organizations. */
const remembered = (): Record<string, string> => ({
  [REGISTRATION_RECORDS_KEY]: JSON.stringify([
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
  ]),
});

describe("registration records (DESIGN §2.C C1)", () => {
  it("records no longer read the legacy keys", () => {
    const { storage, reads, writes } = fakeStorage({
      "environment-targets:v1": JSON.stringify([
        { key: "project-a:service-a", environmentId: ENV_A },
      ]),
      "zerops-mate.zerops-environment-project-ref.v1": JSON.stringify({
        [ENV_A]: { projectId: "project-a", orgId: "org-1" },
      }),
      "zerops-mate.zerops-environments.v1": JSON.stringify([ENV_A]),
    });
    const records = makeRegistrationRecords(storage);

    expect(records.list()).toEqual([]);
    expect(records.list()).toBe(records.list());
    expect(new Set(reads)).toEqual(new Set([REGISTRATION_RECORDS_KEY]));
    expect(writes).toEqual([]);
  });

  it("an exchange's record replaces its target's older one, and an unchanged one writes nothing", () => {
    const { storage, writes } = fakeStorage(remembered());
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
    expect(writes).toEqual([REGISTRATION_RECORDS_KEY]);
  });

  it("what an exchange could not learn keeps what its target's record knew", () => {
    const { storage } = fakeStorage(remembered());
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
    const { storage } = fakeStorage(remembered());
    const records = makeRegistrationRecords({ getItem: storage.getItem, setItem: () => undefined });

    expect(records.list()).toHaveLength(2);
    expect(records.list()).toBe(records.list());
  });
});
