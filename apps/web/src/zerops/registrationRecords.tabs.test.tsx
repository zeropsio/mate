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
 * A signed-in tab whose page keeps the account's records over the web's records port, as the
 * account runtime does, and prints what it read each time the port says another tab wrote them.
 */
async function recordsTab(harness: ReturnType<typeof makeAccountHarness>) {
  let ports!: typeof import("./environmentPorts");
  let environments!: typeof import("@t3tools/client-runtime/zerops/environments");
  const page = await mountTab(harness, harness.browser.openTab(), {
    page: async () => {
      [ports, environments] = await Promise.all([
        import("./environmentPorts"),
        import("@t3tools/client-runtime/zerops/environments"),
      ]);
      const { createElement, useEffect, useState } = await import("react");
      function Records() {
        const [records] = useState(() =>
          environments.makeRegistrationRecords(ports.recordsStorage),
        );
        const [heard, setHeard] = useState(0);
        useEffect(() => ports.recordsStorage.listen(() => setHeard((count) => count + 1)), []);
        const keys = records
          .list()
          .map((entry) => entry.targetKey)
          .join(",");
        return createElement("p", null, `records:${keys} heard:${heard}`);
      }
      return createElement(Records);
    },
  });
  return {
    page,
    records: () => environments.makeRegistrationRecords(ports.recordsStorage),
  };
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
  it("a Mate remembered in tab A reaches tab B's records without a reload", async () => {
    const { a, b } = await twoSignedInTabs();

    await a.page.run(() => a.records().remember(record("project-1:service-1", "environment-1")));
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
});
