import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import {
  beginEnvironmentIdentityExchange,
  hasPendingEnvironmentIdentityExchange,
  readRegistrationRecords,
  rememberRegistration,
} from "./registrationRecords";

const record = (targetKey: string, environmentId: string) => ({
  targetKey,
  environmentId: EnvironmentId.make(environmentId),
  origin: "https://zcp-1-8080.prg1.zerops.app",
  projectRef: { projectId: targetKey.split(":")[0] ?? targetKey, orgId: "org-1" },
  name: "shop",
});

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  });
});
afterEach(() => {
  closeAccountLifetime();
  vi.unstubAllGlobals();
});

describe("the web's registration records", () => {
  it("another account's records are invisible", () => {
    openAccountLifetime("user-a");
    rememberRegistration(record("project-a:service-a", "environment-a"));
    openAccountLifetime("user-b");

    expect(readRegistrationRecords()).toEqual([]);
    rememberRegistration(record("project-b:service-b", "environment-b"));

    openAccountLifetime("user-a");
    expect(readRegistrationRecords().map((entry) => entry.targetKey)).toEqual([
      "project-a:service-a",
    ]);
  });
});

describe("an exchange whose record is being written", () => {
  it("keeps the exchange pending until every overlapping caller finishes", () => {
    openAccountLifetime("exchange-account");
    const first = beginEnvironmentIdentityExchange("https://container.example/mate");
    const second = beginEnvironmentIdentityExchange("https://container.example");
    first();
    first();
    expect(hasPendingEnvironmentIdentityExchange("https://container.example")).toBe(true);
    second();
    expect(hasPendingEnvironmentIdentityExchange("https://container.example")).toBe(false);
  });

  it("does not let an old account's completion release a new account's exchange", () => {
    openAccountLifetime("exchange-account-a");
    const oldFinish = beginEnvironmentIdentityExchange("https://container.example");
    closeAccountLifetime();
    openAccountLifetime("exchange-account-b");
    const newFinish = beginEnvironmentIdentityExchange("https://container.example");
    oldFinish();
    expect(hasPendingEnvironmentIdentityExchange("https://container.example")).toBe(true);
    newFinish();
    expect(hasPendingEnvironmentIdentityExchange("https://container.example")).toBe(false);
  });
});
