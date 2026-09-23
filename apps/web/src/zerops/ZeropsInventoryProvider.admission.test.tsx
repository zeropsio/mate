import type { ZeropsUser } from "@t3tools/client-runtime/zerops";
import { makeAccountHarness } from "@t3tools/client-runtime/zerops/testing";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mountTab, settle, unmountTabs, type MountedTab } from "./__fixtures__/harnessTabs";
import { buttonsLabelled, press } from "./__fixtures__/testDom";

vi.mock("../components/zerops/landing/ZeropsLandingShell", () => ({
  ZeropsLandingWait: ({ label }: { readonly label: string }) => label,
}));

const person: ZeropsUser = {
  id: "user-1",
  email: "person@example.test",
  clientUserList: [{ id: "cu-1", clientId: "org-1", roleCode: "OWNER" }],
};

const CHILD = "product mounted";

function signedInHarness() {
  return makeAccountHarness({
    people: [{ user: person, password: "secret" }],
    projects: [{ id: "p1", clientId: "org-1", name: "One", status: "ACTIVE" }],
    signedIn: "user-1",
  });
}

/**
 * The account's first admission as `AppRoot` composes it, with a child that
 * records the runtime's access state each time it mounts.
 */
function mountProduct(harness: ReturnType<typeof signedInHarness>) {
  const accessAtMount: string[] = [];
  const onMount = (access: string) => accessAtMount.push(access);
  const mounting = mountTab(harness, harness.browser.openTab(), {
    page: async () => {
      const { AccountProduct, ProductChild } = await import("./__fixtures__/accountProduct");
      return (
        <AccountProduct datastream={harness.datastream}>
          <ProductChild label={CHILD} onMount={onMount} />
        </AccountProduct>
      );
    },
  });
  return { mounting, accessAtMount };
}

afterEach(async () => {
  await unmountTabs();
  vi.unstubAllGlobals();
});

describe("ZeropsInventoryProvider first admission", () => {
  it("mounts the product only once the first grant is complete", async () => {
    const harness = signedInHarness();
    const establishing = harness.datastream.holdRegistrations();
    const { mounting, accessAtMount } = mountProduct(harness);
    const tab: MountedTab = await mounting;

    expect(tab.session().status).toBe("signed-in");
    expect(harness.rest.requests().map(({ route }) => route)).toEqual(
      expect.arrayContaining(["GET /user/info", "GET /client/org-1/project", "GET /project/p1"]),
    );
    expect(tab.text()).not.toContain(CHILD);

    establishing.release();
    await settle();

    expect(tab.text()).toContain(CHILD);
    expect(accessAtMount).toEqual(["verified"]);
  });

  it("shows a failed first admission with one retry, and the retry admits", async () => {
    const harness = signedInHarness();
    harness.rest.failProject("p1", 503);
    const { mounting, accessAtMount } = mountProduct(harness);
    const tab = await mounting;

    expect(tab.text()).toContain("Could not load your Zerops projects.");
    expect(tab.text()).not.toContain(CHILD);
    const retries = buttonsLabelled(tab.container(), "Try again");
    expect(retries).toHaveLength(1);

    harness.rest.failProject("p1", null);
    await tab.run(() => press(retries[0]!));

    expect(tab.text()).toContain(CHILD);
    expect(tab.text()).not.toContain("Could not load your Zerops projects.");
    expect(accessAtMount).toEqual(["verified"]);
  });
});
