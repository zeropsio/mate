/**
 * The Mate-key repair as the projects page runs it, counted at the platform: what a load costs
 * the Zerops API. The organization's token list is one heavy response (185 tokens and more on a
 * real account, the whole list every time), so the repair reads it no more than it must.
 */
import type { ZeropsUser } from "@t3tools/client-runtime/zerops";
import { makeAccountHarness } from "@t3tools/client-runtime/zerops/testing";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mountTab, settle, unmountTabs } from "./__fixtures__/harnessTabs";

vi.mock("../components/zerops/landing/ZeropsLandingShell", () => ({
  ZeropsFrameWait: ({
    label,
    children,
  }: {
    readonly label: string;
    readonly children?: import("react").ReactNode;
  }) => children ?? label,
}));

const person: ZeropsUser = {
  id: "user-1",
  email: "person@example.test",
  clientUserList: [{ id: "cu-1", clientId: "org-1", roleCode: "OWNER" }],
};

const TOKEN_LIST = "GET /client/org-1/integration-token/list";

/** The account with one Mate, in p1, whose key `grants` as the test says. */
function accountWithMate(
  grants: ReadonlyArray<{ projectId: string; roleCode: "ADMIN" | "BASIC_USER" }>,
) {
  const harness = makeAccountHarness({
    people: [{ user: person, password: "secret" }],
    projects: [{ id: "p1", clientId: "org-1", name: "Cyd", status: "ACTIVE" }],
    signedIn: "user-1",
  });
  harness.rest.addIntegrationToken("org-1", {
    id: "t1",
    name: "zcp-Cyd",
    roleCode: "NO_ACCESS",
    projects: grants,
  });
  return harness;
}

/** The projects page's repair of the Mates' keys, over the harness platform. */
async function loadRepair(
  harness: ReturnType<typeof accountWithMate>,
  mateProjectIds: ReadonlyArray<string> = ["p1"],
) {
  return mountTab(harness, harness.browser.openTab(), {
    page: async () => {
      const { AccountProduct } = await import("./__fixtures__/accountProduct");
      const { useZeropsMateKeys } = await import("./useZeropsMateKeys");
      function Repair() {
        useZeropsMateKeys({ clientId: "org-1", mateProjectIds, enabled: true });
        return "repairing";
      }
      return (
        <AccountProduct datastream={harness.datastream} overRest>
          <Repair />
        </AccountProduct>
      );
    },
  });
}

const routes = (harness: ReturnType<typeof accountWithMate>) =>
  harness.rest.requests().map(({ route }) => route);

afterEach(async () => {
  await unmountTabs();
  vi.unstubAllGlobals();
});

describe("useZeropsMateKeys at the platform", () => {
  it("reads the token list once on a load with no key owed a write", async () => {
    const harness = accountWithMate([{ projectId: "p1", roleCode: "BASIC_USER" }]);
    await loadRepair(harness);
    await settle();

    expect(routes(harness).filter((route) => route === TOKEN_LIST)).toHaveLength(1);
    expect(routes(harness).filter((route) => route.startsWith("PUT "))).toEqual([]);
  });

  // Two keys owed a write cost two whole lists each, and one more after: each key is planned from
  // a token read by its id, under its lock, right before its write.
  it("reads a key owed a write by its id, never the whole list, right before writing it", async () => {
    const harness = accountWithMate([{ projectId: "p1", roleCode: "ADMIN" }]);
    harness.rest.addProject({ id: "p2", clientId: "org-1", name: "Eva", status: "ACTIVE" });
    harness.rest.addIntegrationToken("org-1", {
      id: "t2",
      name: "zcp-Eva",
      roleCode: "NO_ACCESS",
      projects: [{ projectId: "p2", roleCode: "ADMIN" }],
    });
    await loadRepair(harness, ["p1", "p2"]);
    await settle(60);

    const tokenRoutes = routes(harness).filter((route) => route.includes("/integration-token"));
    const writes = tokenRoutes.filter((route) => route.startsWith("PUT "));
    expect(writes).toEqual([
      "PUT /client/org-1/integration-token/t1",
      "PUT /client/org-1/integration-token/t2",
    ]);
    // Each write right after its own read; the lists left are the shared one's, read again once
    // each write lands.
    for (const write of writes) {
      expect(tokenRoutes[tokenRoutes.indexOf(write) - 1]).toBe(write.replace("PUT ", "GET "));
    }
    expect(tokenRoutes.filter((route) => route === TOKEN_LIST).length).toBeLessThanOrEqual(
      1 + writes.length,
    );
    // The shared list read again after the first write replaces the repair that wrote it: that one
    // stops where it stands, and reads no key the one after it reads.
    expect(tokenRoutes.filter((route) => route.startsWith("GET ") && route !== TOKEN_LIST)).toEqual(
      ["GET /client/org-1/integration-token/t1", "GET /client/org-1/integration-token/t2"],
    );
    expect(harness.rest.integrationToken("org-1", "t2")?.projects).toEqual([
      { projectId: "p2", roleCode: "BASIC_USER" },
    ]);
  });
});
