import type { ZeropsUser } from "@t3tools/client-runtime/zerops";
import { makeAccountHarness } from "@t3tools/client-runtime/zerops/testing";
import { EnvironmentId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mountTab, settle, unmountTabs } from "./__fixtures__/harnessTabs";

const person: ZeropsUser = {
  id: "user-1",
  email: "person@example.test",
  clientUserList: [{ id: "cu-1", clientId: "org-1", roleCode: "OWNER" }],
};

const record = (targetKey: string, environmentId: string) => ({
  targetKey,
  environmentId: EnvironmentId.make(environmentId),
  origin: "https://zcp-1-8080.prg1.zerops.app",
  projectRef: { projectId: targetKey.split(":")[0] ?? targetKey, orgId: "org-1" },
  name: "shop",
});

/**
 * A signed-in tab whose page reads the registration records through its own
 * module graph, and prints what it read.
 */
async function recordsTab(harness: ReturnType<typeof makeAccountHarness>) {
  let records!: typeof import("./registrationRecords");
  let lifetime!: typeof import("./accountLifetime");
  const page = await mountTab(harness, harness.browser.openTab(), {
    page: async () => {
      [records, lifetime] = await Promise.all([
        import("./registrationRecords"),
        import("./accountLifetime"),
      ]);
      const { createElement } = await import("react");
      function Records() {
        const keys = records
          .useRegistrationRecords()
          .map((entry) => entry.targetKey)
          .join(",");
        const version = records.useRegistrationVersion();
        return createElement("p", null, `records:${keys} version:${version}`);
      }
      return createElement(Records);
    },
  });
  return { page, records: () => records, lifetime: () => lifetime };
}

async function twoSignedInTabs() {
  const harness = makeAccountHarness({
    people: [{ user: person, password: "secret" }],
    signedIn: "user-1",
  });
  const a = await recordsTab(harness);
  const b = await recordsTab(harness);
  expect([a.page.accountId(), b.page.accountId()]).toEqual(["user-1", "user-1"]);
  return { a, b };
}

afterEach(async () => {
  await unmountTabs();
  vi.unstubAllGlobals();
});

describe("registration records across tabs", () => {
  it("a Mate remembered in tab A appears in tab B without a reload", async () => {
    const { a, b } = await twoSignedInTabs();

    await a.page.run(() =>
      a.records().rememberRegistration(record("project-1:service-1", "environment-1")),
    );
    await settle();

    expect(b.page.text()).toContain("records:project-1:service-1 ");
    expect(b.page.tab.reloads).toBe(0);
  });

  it("another account's records key change is ignored", async () => {
    const { a, b } = await twoSignedInTabs();
    const before = b.page.text();

    a.page.tab.localStorage.setItem(
      "mate:account:user-2:zerops-mate.registration-records.v1",
      JSON.stringify([record("project-2:service-2", "environment-2")]),
    );
    await settle();

    expect(b.page.text()).toBe(before);
  });

  it("an account closed and opened again hears another tab's write once", async () => {
    const { a, b } = await twoSignedInTabs();
    await b.page.run(() => {
      b.lifetime().closeAccountLifetime();
      b.lifetime().openAccountLifetime("user-1");
    });
    const version = Number(/version:(\d+)/.exec(b.page.text())?.[1]);

    await a.page.run(() =>
      a.records().rememberRegistration(record("project-1:service-1", "environment-1")),
    );
    await settle();

    expect(b.page.text()).toBe(`records:project-1:service-1 version:${version + 1}`);
  });
});
