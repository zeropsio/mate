import type { ZeropsUser } from "@t3tools/client-runtime/zerops";
import { INVALIDATION_COALESCE_MS } from "@t3tools/client-runtime/zerops/knowledge/invalidation";
import { makeAccountHarness } from "@t3tools/client-runtime/zerops/testing";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  mountTab,
  preloadTabs,
  settle,
  unmountTabs,
  type MountedTab,
} from "./__fixtures__/harnessTabs";

preloadTabs(
  () => import("./__fixtures__/accountProduct"),
  () => import("../state/zerops"),
);

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
  it("mounts the product on the first grant, while the push half still establishes (D2)", async () => {
    const harness = signedInHarness();
    const round = harness.rest.hold("GET /project/p1");
    const establishing = harness.datastream.holdRegistrations();
    const { mounting, accessAtMount } = mountProduct(harness);
    const tab: MountedTab = await mounting;

    expect(tab.session().status).toBe("signed-in");
    expect(round.waiting()).toBe(0);
    expect(tab.text()).toContain(CHILD);

    await tab.run(() => round.release());

    expect(harness.rest.requests().map(({ route }) => route)).toEqual(
      expect.arrayContaining(["GET /user/info"]),
    );
    expect(tab.text()).toContain(CHILD);
    expect(accessAtMount).toEqual(["verified"]);

    establishing.release();
    await settle();

    expect(tab.text()).toContain(CHILD);
    expect(accessAtMount).toEqual(["verified"]);
  });

  // The organization's project list failing is read again by the account's store on its own.
  it("reads a failed navigation list again by itself, while the product stays mounted and silent", async () => {
    const harness = signedInHarness();
    const listing = harness.rest.hold("POST /project/search");
    const { mounting, accessAtMount } = mountProduct(harness);
    const tab = await mounting;
    expect(listing.waiting()).toBe(1);
    // Each attempt registers the list's updates first: the one held, then the one sent again.
    const lists = () =>
      harness.rest
        .requests()
        .filter(
          ({ route, body }) =>
            route === "POST /project/search" &&
            (body as { wsOutputType?: string } | null)?.wsOutputType === "updateStream",
        ).length;

    await tab.run(() => listing.fail(503));

    // A failure the runtime retries on its own says nothing before it has lasted.
    expect(tab.text()).toContain(CHILD);
    expect(tab.text()).not.toContain("Zerops isn't answering.");
    await vi.waitFor(() => expect(lists()).toBe(2), { timeout: 5_000 });
    await settle();

    expect(tab.text()).toContain(CHILD);
    expect(tab.text()).not.toContain("Zerops isn't answering.");
    expect(accessAtMount).toEqual(["verified"]);
  });
});

describe("ZeropsInventoryProvider's projects", () => {
  it("come from one registration pair at start: the account store's, the runtime reading none", async () => {
    const harness = signedInHarness();
    const { mounting } = mountProduct(harness);
    const tab = await mounting;
    await settle();
    const registrations = harness.rest
      .requests()
      .filter(({ route }) => route === "POST /project/search")
      .map(({ body }) => (body as { wsOutputType?: string } | null)?.wsOutputType);
    expect(registrations).toEqual(["updateStream", "listStream"]);
    expect(harness.rest.requests().map(({ route }) => route)).not.toContain(
      "GET /client/org-1/project",
    );
    expect(tab.text()).toContain(CHILD);
  });
});

describe("ZeropsInventoryProvider publication", () => {
  it("publishes the account's inventory into its registry, where the candidate listing derives from it", async () => {
    const harness = signedInHarness();
    const tab = await mountTab(harness, harness.browser.openTab(), {
      page: async () => {
        const { AccountProduct } = await import("./__fixtures__/accountProduct");
        const { useAtomValue } = await import("@effect/atom-react");
        const { heldCandidates } = await import("@t3tools/client-runtime/zerops/projections");
        const { mateRowsAtom } = await import("../state/zerops");
        function Rows() {
          const rows = useAtomValue(mateRowsAtom);
          const names = heldCandidates(rows).rows.map((row) => row.project.name);
          return `rows ${rows.state}: ${names.join(", ")}`;
        }
        return (
          <AccountProduct datastream={harness.datastream}>
            <Rows />
          </AccountProduct>
        );
      },
    });
    await settle();

    expect(tab.text()).toContain("rows known: One");
  });
});

// F12 (e2e, 2026-10-03): a member NO_ACCESS in the organization, OWNER on one project by its
// grant. The platform's records carry no grants; the access grant's round read them, and the
// inventory HQ's rule is asked over carries them.
/** Cyd, as Zerops' rows carry it: its own row's `lastUpdate` orders it against the listing's. */
const CYD = {
  id: "p1",
  clientId: "org-1",
  name: "Cyd",
  status: "ACTIVE",
  lastUpdate: "2026-10-01T10:00:00Z",
} as const;

describe("ZeropsInventoryProvider grants", () => {
  it("carries each project's own grants, as the access grant's round read them", async () => {
    const developer: ZeropsUser = {
      id: "user-dev",
      email: "developer@example.test",
      clientUserList: [{ id: "cu-dev", clientId: "org-1", roleCode: "NO_ACCESS" }],
    };
    const grants = [{ clientUserId: "cu-dev", roleCode: "OWNER" }];
    const harness = makeAccountHarness({
      people: [{ user: developer, password: "secret" }],
      projects: [{ ...CYD, userRoles: grants }],
      signedIn: "user-dev",
    });
    const tab = await mountTab(harness, harness.browser.openTab(), {
      page: async () => {
        const { AccountProduct } = await import("./__fixtures__/accountProduct");
        const { useContext } = await import("react");
        const { InventoryContext } = await import("./inventoryContext");
        function Grants() {
          const projects = useContext(InventoryContext)?.projects ?? [];
          return `grants ${JSON.stringify(projects.map(({ id, userRoles }) => [id, userRoles ?? null]))}`;
        }
        return (
          <AccountProduct datastream={harness.datastream} demandedProjects={["p1"]}>
            <Grants />
          </AccountProduct>
        );
      },
    });
    await settle();

    expect(tab.text()).toContain(`grants ${JSON.stringify([["p1", grants]])}`);
  });

  // F12, F11 for the real Developer (e2e, 2026-10-03): NO_ACCESS in the organization, they are
  // refused its project list and read it through `/project/search`, whose rows carry only their
  // own grant; each project's own read names everyone's, so Cyd's row names them its OWNER. What
  // they may do with its changes is HQ's to stream (`useChangeOffers`).
  it("names the Developer, refused the organization's list, the owner of a project they own", async () => {
    const developer: ZeropsUser = {
      id: "user-dev",
      email: "developer@example.test",
      clientUserList: [{ id: "cu-dev", clientId: "org-1", roleCode: "NO_ACCESS" }],
    };
    const grants = [
      { clientUserId: "cu-mate", roleCode: "BASIC_USER" },
      { clientUserId: "cu-dev", roleCode: "OWNER" },
    ];
    const harness = makeAccountHarness({
      people: [{ user: developer, password: "secret" }],
      projects: [{ ...CYD, userRoles: grants }],
      signedIn: "user-dev",
    });
    const tab = await mountTab(harness, harness.browser.openTab(), {
      page: async () => {
        const { AccountProduct } = await import("./__fixtures__/accountProduct");
        const { useContext } = await import("react");
        const { useAtomValue } = await import("@effect/atom-react");
        const { heldCandidates } = await import("@t3tools/client-runtime/zerops/projections");
        const { mateRowsAtom } = await import("../state/zerops");
        const { InventoryContext } = await import("./inventoryContext");
        const { useMatesInventory } = await import("./useMatesInventory");
        function Developer() {
          // The Mate is drawn: its project's own row is read, which names everybody's grants.
          useMatesInventory(["p1"]);
          const inventory = useContext(InventoryContext);
          const rows = heldCandidates(useAtomValue(mateRowsAtom)).rows;
          if (inventory === null || inventory.isLoading) return "reading";
          const owner = rows[0]?.project.userRoles?.find(({ roleCode }) => roleCode === "OWNER");
          return `owner ${owner?.clientUserId ?? "none"}`;
        }
        return (
          <AccountProduct datastream={harness.datastream} demandedProjects={["p1"]}>
            <Developer />
          </AccountProduct>
        );
      },
    });
    await settle();

    expect(harness.rest.requests().map(({ route }) => route)).toEqual(
      expect.arrayContaining(["POST /project/search", "GET /project/p1"]),
    );
    expect(tab.text()).toContain("owner cu-dev");
  });

  // F11 (e2e, 2026-10-03): after Hand over, a Mate's owner is its OWNER grant (#12), which the
  // menu's rows read — never only whoever signed its agent in.
  it("carries them onto the menu's rows, where a Mate's owner is read", async () => {
    const grants = [
      { clientUserId: "cu-1", roleCode: "BASIC_USER" },
      { clientUserId: "cu-dev", roleCode: "OWNER" },
    ];
    const harness = makeAccountHarness({
      people: [{ user: person, password: "secret" }],
      projects: [{ ...CYD, userRoles: grants }],
      signedIn: "user-1",
    });
    const tab = await mountTab(harness, harness.browser.openTab(), {
      page: async () => {
        const { AccountProduct } = await import("./__fixtures__/accountProduct");
        const { useAtomValue } = await import("@effect/atom-react");
        const { heldCandidates } = await import("@t3tools/client-runtime/zerops/projections");
        const { mateRowsAtom } = await import("../state/zerops");
        const { useMatesInventory } = await import("./useMatesInventory");
        function Rows() {
          // The Mate is drawn: its project's own row is read, which names everybody's grants.
          useMatesInventory(["p1"]);
          const rows = heldCandidates(useAtomValue(mateRowsAtom)).rows;
          return `rows ${JSON.stringify(rows.map(({ project }) => [project.id, project.userRoles ?? null]))}`;
        }
        return (
          <AccountProduct datastream={harness.datastream} demandedProjects={["p1"]}>
            <Rows />
          </AccountProduct>
        );
      },
    });
    await settle();

    expect(tab.text()).toContain(`rows ${JSON.stringify([["p1", grants]])}`);
  });

  // F11: Hand over writes the project's OWNER grant, which only the project's own row names: the
  // operation's answer reads the drawn Mate's own row again, so its row shows the new owner.
  it("shows a hand over's new OWNER on the menu's row once the operation is answered", async () => {
    const before = [{ clientUserId: "cu-1", roleCode: "OWNER" }];
    const harness = makeAccountHarness({
      people: [{ user: person, password: "secret" }],
      projects: [{ ...CYD, userRoles: before }],
      signedIn: "user-1",
    });
    let handOver: () => Promise<unknown> = async () => {};
    const tab = await mountTab(harness, harness.browser.openTab(), {
      page: async () => {
        const { AccountProduct } = await import("./__fixtures__/accountProduct");
        const { useAtomValue } = await import("@effect/atom-react");
        const { heldCandidates } = await import("@t3tools/client-runtime/zerops/projections");
        const { mateRowsAtom } = await import("../state/zerops");
        const { useMatesInventory } = await import("./useMatesInventory");
        const { useAccountOperations } = await import("./accountOperations");
        function Owner() {
          useMatesInventory(["p1"]);
          const operations = useAccountOperations();
          handOver = () =>
            operations.submit({
              kind: "assign-mate-owner",
              orgId: "org-1",
              projectId: "p1",
              clientUserId: "cu-dev",
            });
          const rows = heldCandidates(useAtomValue(mateRowsAtom)).rows;
          const owner = rows[0]?.project.userRoles?.find(({ roleCode }) => roleCode === "OWNER");
          return `owner ${owner?.clientUserId ?? "none"}`;
        }
        return (
          <AccountProduct datastream={harness.datastream} demandedProjects={["p1"]}>
            <Owner />
          </AccountProduct>
        );
      },
    });
    await settle();
    expect(tab.text()).toContain("owner cu-1");

    await tab.run(() => handOver());
    await settle();
    expect(tab.text()).toContain("owner cu-dev");
  });
});
