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
import { buttonsLabelled, press } from "./__fixtures__/testDom";

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

  // An organization's project list failing fails the whole round, today and
  // after one project's failure stops failing it (DESIGN G1).
  it("shows a failed navigation read with a manual retry while the product stays mounted", async () => {
    const harness = signedInHarness();
    const listing = harness.rest.hold("GET /client/org-1/project");
    const { mounting, accessAtMount } = mountProduct(harness);
    const tab = await mounting;
    expect(listing.waiting()).toBe(1);

    await tab.run(() => listing.fail(503));

    expect(tab.text()).toContain("Zerops isn't answering.");
    expect(tab.text()).toContain(CHILD);
    const retries = buttonsLabelled(tab.container(), "Try now");
    expect(retries).toHaveLength(1);

    await tab.run(() => press(retries[0]!));
    // The retry is an intent: it reaches the grant when its window closes (DESIGN §6.2).
    await tab.run(
      () => new Promise<void>((resolve) => setTimeout(resolve, INVALIDATION_COALESCE_MS)),
    );

    expect(tab.text()).toContain(CHILD);
    expect(tab.text()).not.toContain("Zerops isn't answering.");
    expect(accessAtMount).toEqual(["verified"]);
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
        const { candidateRowsAtom } = await import("../state/zerops");
        function Rows() {
          const rows = useAtomValue(candidateRowsAtom);
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
      projects: [{ id: "p1", clientId: "org-1", name: "Cyd", status: "ACTIVE", userRoles: grants }],
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
  // own grant; each project's own read names everyone's. Cyd's merge, comment and close are
  // offered to them by their OWNER grant, and Cyd's row names them its OWNER.
  it("offers the Developer, refused the organization's list, a change of a project they own", async () => {
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
      projects: [{ id: "p1", clientId: "org-1", name: "Cyd", status: "ACTIVE", userRoles: grants }],
      signedIn: "user-dev",
    });
    const tab = await mountTab(harness, harness.browser.openTab(), {
      page: async () => {
        const { AccountProduct } = await import("./__fixtures__/accountProduct");
        const { useContext } = await import("react");
        const { useAtomValue } = await import("@effect/atom-react");
        const { changeOffers, offerAsker } = await import("@t3tools/client-runtime/zerops");
        const { heldCandidates } = await import("@t3tools/client-runtime/zerops/projections");
        const { candidateRowsAtom } = await import("../state/zerops");
        const { InventoryContext } = await import("./inventoryContext");
        const { sessionOfferViewer } = await import("./offerViewer");
        const { useZeropsSessionOptional } = await import("./sessionContext");
        const placements = new Map([
          ["p1", { appId: "app-c", appName: "C", kind: "mate" as const, mate: null }],
        ]);
        function Developer() {
          const inventory = useContext(InventoryContext);
          const session = useZeropsSessionOptional();
          const rows = heldCandidates(useAtomValue(candidateRowsAtom)).rows;
          if (inventory === null || inventory.isLoading) return "reading";
          const viewer = sessionOfferViewer(session?.user, session?.activeOrganization ?? null);
          const { comment, merge, close } = changeOffers(
            offerAsker(viewer, inventory.projects),
            placements,
            "app-c",
          );
          const owner = rows[0]?.project.userRoles?.find(({ roleCode }) => roleCode === "OWNER");
          return `offers ${JSON.stringify({ comment, merge, close })} owner ${owner?.clientUserId ?? "none"}`;
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
      expect.arrayContaining([
        "GET /client/org-1/project",
        "POST /project/search",
        "GET /project/p1",
      ]),
    );
    expect(tab.text()).toContain(
      `offers ${JSON.stringify({ comment: true, merge: true, close: true })} owner cu-dev`,
    );
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
      projects: [{ id: "p1", clientId: "org-1", name: "Cyd", status: "ACTIVE", userRoles: grants }],
      signedIn: "user-1",
    });
    const tab = await mountTab(harness, harness.browser.openTab(), {
      page: async () => {
        const { AccountProduct } = await import("./__fixtures__/accountProduct");
        const { useAtomValue } = await import("@effect/atom-react");
        const { heldCandidates } = await import("@t3tools/client-runtime/zerops/projections");
        const { candidateRowsAtom } = await import("../state/zerops");
        function Rows() {
          const rows = heldCandidates(useAtomValue(candidateRowsAtom)).rows;
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

  // F11: Hand over writes the project's OWNER grant, which only the access grant's round reads.
  // The renewal the hand over asks for shows the new owner at once; no round's tick comes first.
  it("shows a hand over's new OWNER on the menu's row once the grant is asked for a round", async () => {
    const before = [{ clientUserId: "cu-1", roleCode: "OWNER" }];
    const after = [{ clientUserId: "cu-dev", roleCode: "OWNER" }];
    const harness = makeAccountHarness({
      people: [{ user: person, password: "secret" }],
      projects: [{ id: "p1", clientId: "org-1", name: "Cyd", status: "ACTIVE", userRoles: before }],
      signedIn: "user-1",
    });
    const tab = await mountTab(harness, harness.browser.openTab(), {
      page: async () => {
        const { AccountProduct } = await import("./__fixtures__/accountProduct");
        const { useAtomValue } = await import("@effect/atom-react");
        const { heldCandidates } = await import("@t3tools/client-runtime/zerops/projections");
        const { candidateRowsAtom } = await import("../state/zerops");
        function Owner() {
          const rows = heldCandidates(useAtomValue(candidateRowsAtom)).rows;
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

    // The platform takes the hand over: the project's grants name the Developer its OWNER.
    harness.rest.addProject({
      id: "p1",
      clientId: "org-1",
      name: "Cyd",
      status: "ACTIVE",
      userRoles: after,
    });
    await settle();
    expect(tab.text()).toContain("owner cu-1");

    // What the hand over asks, heard when the bus's window closes (DESIGN §6.2).
    const { invalidateZerops } = await import("./accountInvalidations");
    await tab.run(async () => {
      invalidateZerops({ topic: "access", change: "grants-written" });
    });
    await tab.run(
      () => new Promise<void>((resolve) => setTimeout(resolve, INVALIDATION_COALESCE_MS)),
    );
    await settle();
    expect(tab.text()).toContain("owner cu-dev");
  });
});
