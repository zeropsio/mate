import type { ZeropsUser } from "@t3tools/client-runtime/zerops";
import { makeAccountHarness, type FakeDatastream } from "@t3tools/client-runtime/zerops/testing";
import type { ComponentType, ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { AppRouter } from "../router";
import { resolveZeropsAccountGate } from "../routes/-accountGate";
import { mountTab, unmountTabs } from "./__fixtures__/harnessTabs";

/**
 * What `AppRoot`'s tree reaches outside itself in a harness tab: the fixture's
 * session probe, placed where the landing and the routes render, and the
 * harness datastream the account's data runtime is built over.
 */
const seams = vi.hoisted(() => ({
  Probe: (() => null) as ComponentType,
  datastream: null as FakeDatastream | null,
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

vi.mock("./ZeropsDataProvider", async (importOriginal) => {
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
        <actual.ZeropsDataProvider makeRuntime={makeRuntime}>{children}</actual.ZeropsDataProvider>
      );
    },
  };
});

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
async function signedOutTab(path: string) {
  const harness = makeAccountHarness({ people: [{ user: person, password: "secret" }] });
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

describe("password sign-in in AppRoot", () => {
  it("keeps a password sign-in on the deep link it was opened at, with that route on screen", async () => {
    const harness = makeAccountHarness({
      people: [{ user: person, password: "secret" }],
      projects: [{ id: "p1", clientId: "org-1", name: "One", status: "ACTIVE" }],
    });
    seams.datastream = harness.datastream;
    let router!: AppRouter;
    const tab = await mountTab(harness, harness.browser.openTab(), {
      path: DEEP_LINK,
      app: async (Probe) => {
        seams.Probe = Probe;
        const [{ AppRoot }, { productRouter }, { createElement }] = await Promise.all([
          import("../AppRoot"),
          import("./__fixtures__/productRoutes"),
          import("react"),
        ]);
        router = productRouter(DEEP_LINK, Probe);
        return createElement(AppRoot, { router });
      },
    });
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
