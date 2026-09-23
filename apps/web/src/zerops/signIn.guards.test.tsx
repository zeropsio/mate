import type { ZeropsUser } from "@t3tools/client-runtime/zerops";
import { makeAccountHarness, type FakeDatastream } from "@t3tools/client-runtime/zerops/testing";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { AppRouter } from "../router";
import { resolveZeropsAccountGate } from "../routes/-accountGate";
import { mountTab, settle, unmountTabs } from "./__fixtures__/harnessTabs";

/**
 * What `AppRoot`'s tree reaches outside itself in a harness tab: the fixture's
 * session probe, placed where the landing and the routes render, and the
 * harness datastream the account's data runtime is built over.
 *
 * `dataProvider` is the data provider's mock. A mocked module outlives
 * `vi.resetModules`, so every tab that opens `AppRoot` mocks it again: the
 * provider it wraps is then that tab's own, over that tab's session and
 * account lifetime.
 */
const seams = vi.hoisted(() => ({
  Probe: (() => null) as ComponentType,
  datastream: null as FakeDatastream | null,
  dataProvider: async (importOriginal: <T>() => Promise<T>) => {
    const actual = await importOriginal<typeof import("./ZeropsDataProvider")>();
    const [{ useState }, { harnessRuntime }] = await Promise.all([
      import("react"),
      import("./__fixtures__/harnessRuntime"),
    ]);
    return {
      ...actual,
      ZeropsDataProvider: ({ children }: { readonly children: ReactNode }) => {
        const [makeRuntime] = useState(() => harnessRuntime(seams.datastream!));
        return (
          <actual.ZeropsDataProvider makeRuntime={makeRuntime}>
            {children}
          </actual.ZeropsDataProvider>
        );
      },
    };
  },
}));

vi.mock("../components/zerops/landing/ZeropsHostedLanding", async () => {
  const { createElement, Fragment } = await import("react");
  return {
    ZeropsHostedLanding: () =>
      createElement(Fragment, null, "Sign in to Zerops", createElement(seams.Probe)),
  };
});

vi.mock("../components/zerops/landing/ZeropsLandingShell", () => ({
  ZeropsLandingWait: ({ label }: { readonly label: string }) => label,
}));

vi.mock("./ZeropsDataProvider", seams.dataProvider);

const person: ZeropsUser = {
  id: "user-1",
  email: "person@example.test",
  clientUserList: [{ id: "cu-1", clientId: "org-1", roleCode: "OWNER" }],
};

const DEEP_LINK = "/zerops/project/p1";

/**
 * A signed-out tab open at `path`, with the tab's own navigation and
 * hand-over modules: the return path lives in its storage and its account.
 */
async function signedOutTab(
  path: string,
  harness = makeAccountHarness({ people: [{ user: person, password: "secret" }] }),
) {
  let navigation!: typeof import("./navigationStorage");
  let handover!: typeof import("./handover");
  const tab = await mountTab(harness, harness.browser.openTab(), {
    path,
    page: async () => {
      [navigation, handover] = await Promise.all([
        import("./navigationStorage"),
        import("./handover"),
      ]);
      return null;
    },
  });
  /** The hand-over round trip as the callback route completes it. */
  const signInByHandover = () =>
    tab.run(async () => {
      const state = new URL(handover.startZeropsHandover()).searchParams.get("state");
      const token = harness.rest.issueSession("user-1").accessToken;
      const outcome = handover.completeZeropsHandover({
        fragment: `#token=${token}&state=${state}`,
      });
      if (outcome.kind !== "session") throw new Error(`The hand-over was ${outcome.kind}.`);
      await tab.session().adoptHandover(outcome);
      return navigation.accountReturnPath();
    });
  return { tab, navigation, signInByHandover };
}

/** Where a signed-in person lands: a product path the account gate opens, never the landing. */
function expectLanding(path: string) {
  expect(path).toMatch(/^\/zerops(\/|$)/);
  expect(resolveZeropsAccountGate({ pathname: path, status: "signed-in" })).toBe("app");
}

afterEach(async () => {
  await unmountTabs();
  vi.unstubAllGlobals();
});

describe("deep link after sign-in", () => {
  it("returns a hand-over started on a deep link to that route", async () => {
    const { tab, signInByHandover } = await signedOutTab(DEEP_LINK);

    const landing = await signInByHandover();

    expect(tab.session().status).toBe("signed-in");
    expect(landing).toBe(DEEP_LINK);
    expectLanding(landing);
  });

  it("returns a hand-over started on a deep link with a query to that route, without the query", async () => {
    const { signInByHandover } = await signedOutTab("/zerops/project/p1?tab=services#logs");

    const landing = await signInByHandover();

    expect(landing).toBe(DEEP_LINK);
    expectLanding(landing);
  });

  it.each(["/", "/zerops", "/pair", "//elsewhere.example/zerops"])(
    "returns a hand-over started at %s to /zerops",
    async (path) => {
      const { signInByHandover } = await signedOutTab(path);

      const landing = await signInByHandover();

      expect(landing).toBe("/zerops");
      expectLanding(landing);
    },
  );

  it("returns a hand-over with no route of its own to the account's last route", async () => {
    const { tab, navigation, signInByHandover } = await signedOutTab("/");
    await tab.run(() => tab.session().signIn("person@example.test", "secret"));
    await tab.run(() => navigation.rememberAccountRoute(DEEP_LINK));
    await tab.run(() => tab.session().signOut());

    const landing = await signInByHandover();

    expect(landing).toBe(DEEP_LINK);
    expectLanding(landing);
  });
});

/** A harness whose one person has one project, the deep link's. */
function productHarness() {
  const harness = makeAccountHarness({
    people: [{ user: person, password: "secret" }],
    projects: [{ id: "p1", clientId: "org-1", name: "One", status: "ACTIVE" }],
  });
  seams.datastream = harness.datastream;
  return harness;
}

/**
 * `AppRoot` in a tab of `harness`, opened at the deep link, with its router.
 * `beside` loads what the route tree's root renders beside the session probe,
 * from the tab's own module graph.
 */
async function appTab(
  harness: ReturnType<typeof makeAccountHarness>,
  beside: (() => Promise<ComponentType>) | null = null,
) {
  let router!: AppRouter;
  const tab = await mountTab(harness, harness.browser.openTab(), {
    path: DEEP_LINK,
    app: async (Probe) => {
      seams.Probe = Probe;
      vi.doMock("./ZeropsDataProvider", seams.dataProvider);
      const [{ AppRoot }, { productRouter }, { createElement, Fragment }, Beside] =
        await Promise.all([
          import("../AppRoot"),
          import("./__fixtures__/productRoutes"),
          import("react"),
          beside?.() ?? null,
        ]);
      router = productRouter(
        DEEP_LINK,
        Beside === null
          ? Probe
          : () => createElement(Fragment, null, createElement(Probe), createElement(Beside)),
      );
      return createElement(AppRoot, { router });
    },
  });
  return { tab, router: () => router };
}

describe("password sign-in in AppRoot", () => {
  it("keeps a password sign-in on the deep link it was opened at, with that route on screen", async () => {
    const harness = productHarness();
    const { tab, router: currentRouter } = await appTab(harness);
    const router = currentRouter();
    expect(tab.text()).toContain("Sign in to Zerops");

    await tab.run(() => tab.session().signIn("person@example.test", "secret"));

    expect(tab.text()).toContain("Project p1");
    expect(tab.text()).not.toContain("Sign in to Zerops");
    expect(tab.session().status).toBe("signed-in");
    expect(router.state.location.pathname).toBe(DEEP_LINK);
    expect(tab.navigations()).toEqual([]);
    expectLanding(router.state.location.pathname);
  });
});

describe("a sign-in in another tab", () => {
  it("takes a signed-out tab off the landing page without a reload", async () => {
    const harness = productHarness();
    const b = await appTab(harness);
    const a = await mountTab(harness, harness.browser.openTab());
    expect(b.tab.text()).toContain("Sign in to Zerops");

    await a.run(() => a.session().signIn("person@example.test", "secret"));
    await settle();

    expect(b.tab.text()).toContain("Project p1");
    expect(b.tab.text()).not.toContain("Sign in to Zerops");
    expect(b.tab.session().status).toBe("signed-in");
    expect(b.tab.accountId()).toBe("user-1");
    expect(b.router().state.location.pathname).toBe(DEEP_LINK);
    expect(b.tab.navigations()).toEqual([]);
    expect(b.tab.tab.reloads).toBe(0);
  });

  it("carries a hand-over callback completed in one tab to a signed-out tab", async () => {
    const harness = productHarness();
    const b = await appTab(harness);
    const { tab: a, signInByHandover } = await signedOutTab("/zerops/authorized", harness);

    await signInByHandover();
    await settle();

    expect(a.session().status).toBe("signed-in");
    expect(b.tab.text()).toContain("Project p1");
    expect(b.tab.session().status).toBe("signed-in");
    expect(b.tab.accountId()).toBe("user-1");
    expect(b.tab.navigations()).toEqual([]);
    expect(b.tab.tab.reloads).toBe(0);
  });
});

describe("cold sign-in", () => {
  it("mounts the router on the first grant while services are unknown: the sidebar shows its placeholder, never none, and nothing exchanges before the grant", async () => {
    const harness = productHarness();
    // A Mate this browser remembers: the post-grant stage restores it.
    harness.browser.openTab().localStorage.setItem(
      "mate:account:user-1:zerops-mate.registration-records.v1",
      JSON.stringify([
        {
          targetKey: "p1:zcp",
          environmentId: "environment-1",
          origin: "https://zcp-1-8080.prg1.zerops.app",
          projectRef: { projectId: "p1", orgId: "org-1" },
          name: "One",
        },
      ]),
    );
    const round = harness.rest.hold("GET /project/p1");
    const establishing = harness.datastream.holdRegistrations();
    const accessAtMount: string[] = [];
    let environments!: typeof import("./accountEnvironments");
    const { tab } = await appTab(harness, async () => {
      const [{ ProductChild, SidebarListing }, { createElement, Fragment }] = await Promise.all([
        import("./__fixtures__/accountProduct"),
        import("react"),
      ]);
      environments = await import("./accountEnvironments");
      const onMount = (access: string) => accessAtMount.push(access);
      return () =>
        createElement(
          Fragment,
          null,
          createElement(ProductChild, { label: "", onMount }),
          createElement(SidebarListing),
        );
    });
    const mints = () =>
      harness.rest
        .requests()
        .filter(({ route }) => route === "POST /client/org-1/integration-token");

    await tab.run(() => tab.session().signIn("person@example.test", "secret"));

    // The first round's project read is out: no grant, no route, and no
    // post-grant stage to exchange for the remembered Mate.
    expect(round.waiting()).toBe(1);
    expect(tab.text()).toContain("Checking your Zerops projects…");
    expect(tab.text()).not.toContain("Project p1");
    expect(environments.currentAccountEnvironments()).toBeNull();
    expect(mints()).toEqual([]);

    await tab.run(() => round.release());
    await settle();

    // Granted while the push half still establishes: the route is on screen,
    // and the menu says it is reading rather than that there is nothing.
    expect(accessAtMount).toEqual(["verified"]);
    expect(environments.currentAccountEnvironments()?.machines().has("p1:zcp")).toBe(true);
    expect(tab.text()).toContain("Project p1");
    expect(tab.text()).toContain("Reading your projects…");
    expect(tab.text()).not.toMatch(/No projects|No environment has Mate yet/);

    establishing.release();
    await settle();

    // The push half's answers reach the mounted product: nothing mounts again.
    expect(tab.text()).toContain("Project p1");
    expect(tab.text()).not.toMatch(/No projects|No environment has Mate yet/);
    expect(accessAtMount).toEqual(["verified"]);
  });
});
