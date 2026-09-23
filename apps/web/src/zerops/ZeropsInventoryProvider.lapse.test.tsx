import { ZEROPS_SESSION_STORAGE_KEY, type ZeropsUser } from "@t3tools/client-runtime/zerops";
import type { ZeropsResourceAdapter } from "@t3tools/client-runtime/zerops/data";
import type { Link } from "@t3tools/client-runtime/zerops/environments";
import { INVALIDATION_COALESCE_MS } from "@t3tools/client-runtime/zerops/knowledge/invalidation";
import { makeAccountHarness, type AccountHarness } from "@t3tools/client-runtime/zerops/testing";
import * as Effect from "effect/Effect";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mountTab, unmountTabs, type MountedTab } from "./__fixtures__/harnessTabs";
import { buttonsLabelled, press } from "./__fixtures__/testDom";

vi.mock("../components/zerops/landing/ZeropsLandingShell", () => ({
  ZeropsLandingWait: ({ label }: { readonly label: string }) => label,
}));

// The route gate's "Go to projects" is a router link; no router runs under these tabs.
vi.mock("@tanstack/react-router", async (actual) => ({
  ...(await actual<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { readonly children?: ReactNode }) => children ?? null,
}));

// The dialog's own behaviour is the library's; what matters here is that its
// popup renders into a portal in the body, beside the page.
vi.mock("@base-ui/react/dialog", async () => {
  const { createPortal } = await import("react-dom");
  const Pass = ({ children }: { readonly children?: ReactNode }) => children;
  return {
    Dialog: {
      Root: Pass,
      Portal: ({ children }: { readonly children?: ReactNode }) =>
        createPortal(children, document.body as unknown as Element),
      Backdrop: () => null,
      Viewport: Pass,
      Popup: Pass,
      Close: () => null,
    },
  };
});

const MINUTE_MS = 60_000;
const CHILD = "product mounted";
const MESSAGES = "conversation: hello";
const DRAFT = "draft: my words";
const CONNECTED: Link = { phase: "connected", since: { wall: 0, mono: 0 } };
const DOWN: Link = { phase: "backoff", retryAtMs: null };

const person: ZeropsUser = {
  id: "user-1",
  email: "person@example.test",
  clientUserList: [{ id: "cu-1", clientId: "org-1", roleCode: "OWNER" }],
};

const storedSession = (harness: AccountHarness) =>
  harness.browser.openTab().localStorage.getItem(ZEROPS_SESSION_STORAGE_KEY);

/** The platform's locations, counting how often the broker reads them. */
function locationsSource() {
  let reads = 0;
  const unavailable = () =>
    Effect.fail({
      _tag: "ZeropsResourceSourceError" as const,
      kind: "unavailable" as const,
      retryable: false,
    });
  const adapter: ZeropsResourceAdapter = {
    readOrganizationLocations: () =>
      Effect.sync(() => {
        reads++;
        return [{ id: "loc-1", name: "Prague", pingUrl: "https://prague.example.test" }];
      }),
    readServiceAuthorizedAgents: unavailable,
    readServiceDeployedVersion: unavailable,
    readServiceMateFlag: unavailable,
    readOrganizationIntegrationTokenGrants: unavailable,
  };
  return { adapter, reads: () => reads };
}

/**
 * The signed-in product, admitted, on a clock the test moves. Timers still
 * run on their own between moves, so the harness's task turns go by.
 */
async function admittedProduct(
  options: {
    readonly resourceAdapter?: ZeropsResourceAdapter;
    /** An open dialog and a document title that name the projects. */
    readonly layers?: boolean;
    /** Mate p1's conversation over this link, which dropped this long after the mount (null: never). */
    readonly conversation?: { readonly link: Link; readonly lostAfterMs: number | null };
  } = {},
) {
  vi.useFakeTimers({
    toFake: ["Date", "performance", "setTimeout", "clearTimeout"],
    shouldAdvanceTime: true,
  });
  const harness: AccountHarness = makeAccountHarness({
    people: [{ user: person, password: "secret" }],
    projects: [
      { id: "p1", clientId: "org-1", name: "One", status: "ACTIVE" },
      { id: "p2", clientId: "org-1", name: "Two", status: "ACTIVE" },
    ],
    signedIn: "user-1",
  });
  let mounts = 0;
  const conversation = options.conversation;
  const linkLostAt =
    conversation?.lostAfterMs === undefined || conversation.lostAfterMs === null
      ? null
      : {
          wall: Date.now() + conversation.lostAfterMs,
          mono: performance.now() + conversation.lostAfterMs,
        };
  const tab: MountedTab = await mountTab(harness, harness.browser.openTab(), {
    page: async () => {
      const {
        AccountProduct,
        Conversation,
        ListingState,
        OrganizationLocations,
        ProductChild,
        ProjectNames,
      } = await import("./__fixtures__/accountProduct");
      const { ProjectDialog, ProjectTitle } = await import("./__fixtures__/platformLayers");
      return (
        <AccountProduct
          datastream={harness.datastream}
          {...(options.resourceAdapter === undefined
            ? {}
            : { resourceAdapter: options.resourceAdapter })}
        >
          <ProductChild
            label={CHILD}
            onMount={() => {
              mounts++;
            }}
          />
          <ProjectNames />
          <ListingState />
          {conversation === undefined ? null : (
            <Conversation projectId="p1" link={conversation.link} linkLostAt={linkLostAt} />
          )}
          {options.resourceAdapter === undefined ? null : (
            <OrganizationLocations organizationId="org-1" />
          )}
          {options.layers === true ? (
            <>
              <ProjectDialog />
              <ProjectTitle />
            </>
          ) : null}
        </AccountProduct>
      );
    },
  });
  const pass = (ms: number) => tab.run(() => vi.advanceTimersByTimeAsync(ms));
  expect(tab.text()).toContain(CHILD);
  return { harness, tab, pass, mounts: () => mounts };
}

afterEach(async () => {
  await unmountTabs();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ZeropsInventoryProvider lapse", () => {
  // The one erasure a lapse keeps: the broker's values (DESIGN law 5, §9 C4).
  it("broker values erased at the deadline", async () => {
    const source = locationsSource();
    const { harness, tab, pass, mounts } = await admittedProduct({
      resourceAdapter: source.adapter,
    });
    await pass(0);
    expect(tab.text()).toContain("locations: known Prague");
    harness.rest.hang("GET /user/info");

    await pass(16 * MINUTE_MS);

    expect(mounts()).toBe(1);
    expect(tab.text()).toContain("locations: withheld");
    expect(tab.text()).not.toContain("Prague");
    expect(source.reads()).toBe(1);
  });

  it("a resource erased by lapse reads again on the next grant", async () => {
    const source = locationsSource();
    const { harness, tab, pass, mounts } = await admittedProduct({
      resourceAdapter: source.adapter,
    });
    await pass(0);
    const renewals = harness.rest.hang("GET /user/info");
    await pass(16 * MINUTE_MS);
    expect(tab.text()).toContain("locations: withheld");

    renewals();
    await pass(2 * MINUTE_MS);

    expect(mounts()).toBe(1);
    expect(source.reads()).toBe(2);
    expect(tab.text()).toContain("locations: known Prague");
  });

  // T-L2: the product stays mounted and usable; only its platform regions are withheld.
  it("a frozen tab past the deadline keeps children mounted, shows no platform text, renews on return", async () => {
    const { harness, tab, pass, mounts } = await admittedProduct();
    expect(tab.readable()).toContain("projects: One, Two");
    await pass(MINUTE_MS);

    // Frozen from +1 min to +40 min: no timer runs, and the clock jumps.
    tab.tab.signals.freeze();
    vi.setSystemTime(Date.now() + 39 * MINUTE_MS);
    const round = harness.rest.hold("GET /user/info");
    tab.tab.signals.resume();
    await tab.run(() => undefined);

    // Past its deadline on return, the grant lapses and a round starts at once.
    expect(round.waiting()).toBeGreaterThan(0);
    expect(mounts()).toBe(1);
    expect(tab.readable()).toContain(CHILD);
    expect(tab.readable()).not.toMatch(/One|Two/);
    expect(tab.readable()).toContain("listing: withheld");
    expect(tab.readable()).toContain("Checking your Zerops access…");

    await tab.run(() => round.release());
    await pass(0);

    expect(mounts()).toBe(1);
    expect(tab.readable()).toContain(CHILD);
    expect(tab.readable()).toContain("projects: One, Two");
    expect(tab.readable()).not.toContain("Checking your Zerops access…");
  });

  it("no platform text anywhere in the document while lapsed", async () => {
    const source = locationsSource();
    const { harness, tab, pass } = await admittedProduct({
      layers: true,
      resourceAdapter: source.adapter,
    });
    await pass(0);
    expect(tab.readable()).toContain("dialog: One, Two");
    expect(tab.readable()).toContain("locations: known Prague");
    expect(tab.title()).toBe("One, Two · Zerops Mate");
    const renewals = harness.rest.hold("GET /user/info");

    await pass(16 * MINUTE_MS);

    // Every region reads its platform facts withheld, the open dialog's and the title's included.
    expect(tab.text()).not.toMatch(/One|Two|Prague/);
    expect(tab.title()).not.toMatch(/One|Two/);
    expect(tab.readable()).toContain(CHILD);
    expect(tab.readable()).toContain("listing: withheld");
    expect(tab.readable().match(/Zerops isn't answering\./g)).toHaveLength(1);

    // The next grant gives it all back within a second of its round: "Try now" starts one, or
    // joins the one out, and Zerops answers it.
    await tab.run(() => press(buttonsLabelled(tab.container(), "Try now")[0]!));
    await pass(INVALIDATION_COALESCE_MS);
    await tab.run(() => renewals.release());
    await pass(1_000);
    expect(tab.readable()).toContain("projects: One, Two");
    expect(tab.readable()).toContain("dialog: One, Two");
    expect(tab.title()).toBe("One, Two · Zerops Mate");
    expect(tab.readable()).not.toContain("Zerops isn't answering.");
  });

  // DESIGN §9 C1b: while the link is connected, the Mate's own membership watch is the authority.
  it("a lapsed grant hides project names and keeps a connected conversation", async () => {
    const { harness, tab, pass } = await admittedProduct({
      conversation: { link: CONNECTED, lostAfterMs: null },
    });
    expect(tab.readable()).toContain("projects: One, Two");
    harness.rest.hang("GET /user/info");

    await pass(40 * MINUTE_MS);

    expect(tab.readable()).not.toMatch(/One|Two/);
    expect(tab.readable()).toContain(MESSAGES);
    expect(tab.readable()).toContain(DRAFT);
  });

  it("a conversation disconnected for more than 10 min while lapsed is suppressed", async () => {
    // The link drops 10 min in; the grant lapses 15 min in.
    const { harness, tab, pass, mounts } = await admittedProduct({
      conversation: { link: DOWN, lostAfterMs: 10 * MINUTE_MS },
    });
    harness.rest.hang("GET /user/info");

    await pass(16 * MINUTE_MS);
    expect(tab.readable()).not.toMatch(/One|Two/);
    expect(tab.readable()).toContain(MESSAGES);

    await pass(3 * MINUTE_MS);
    expect(tab.readable()).toContain(MESSAGES);

    // 10 min after the drop: hidden, still mounted, drafts included.
    await pass(MINUTE_MS);
    expect(tab.readable()).not.toContain(MESSAGES);
    expect(tab.readable()).not.toContain(DRAFT);
    expect(tab.text()).toContain(MESSAGES);
    expect(mounts()).toBe(1);
  });

  it("confirmed loss suppresses the target's content and drafts", async () => {
    const { harness, tab, pass } = await admittedProduct({
      conversation: { link: CONNECTED, lostAfterMs: null },
    });
    harness.rest.failProject("p1", 403);

    // The renewal meets the 403 and closes p1; a confirming read at least 5 s later proves it.
    await pass(14 * MINUTE_MS);

    expect(tab.readable()).not.toContain(MESSAGES);
    expect(tab.readable()).not.toContain(DRAFT);
    expect(tab.readable()).toContain("Your access to this project changed.");
    expect(tab.readable()).toContain("projects: Two");
    expect(tab.text()).toContain(MESSAGES);
  });

  // DESIGN A9: whatever the lapse says, the way out of the account is on it; "Try now" only
  // beside a failure it names.
  it.each([
    [
      "no cause yet",
      "Checking your Zerops access…",
      ["Sign out"],
      async ({ harness, tab }: Awaited<ReturnType<typeof admittedProduct>>) => {
        tab.tab.signals.freeze();
        vi.setSystemTime(Date.now() + 39 * MINUTE_MS);
        harness.rest.hold("GET /user/info");
        tab.tab.signals.resume();
        await tab.run(() => undefined);
      },
    ],
    [
      "Zerops not answering",
      "Zerops isn't answering.",
      ["Try now", "Sign out"],
      async ({ harness, pass }: Awaited<ReturnType<typeof admittedProduct>>) => {
        harness.rest.hang("GET /user/info");
        await pass(16 * MINUTE_MS);
      },
    ],
  ] as const)(
    "every lapse banner offers Sign out: %s",
    async (_state, sentence, controls, lapse) => {
      const product = await admittedProduct();

      await lapse(product);

      expect(product.tab.readable()).toContain(sentence);
      expect(product.tab.readable().match(/Try (again|now)|Sign out/g)).toEqual(controls);
    },
  );

  it("Sign out from the lapse banner signs out", async () => {
    const { harness, tab, pass } = await admittedProduct();
    const token = JSON.parse(storedSession(harness)!).accessToken as string;
    harness.rest.hang("GET /user/info");
    await pass(16 * MINUTE_MS);
    expect(tab.readable()).toContain("Zerops isn't answering.");

    await tab.run(() => press(buttonsLabelled(tab.container(), "Sign out")[0]!));
    await pass(0);

    expect(tab.session().status).toBe("signed-out");
    expect(tab.accountId()).toBeNull();
    expect(storedSession(harness)).toBeNull();
    expect(
      harness.rest.requests().filter(({ route }) => route === "POST /auth/logout"),
    ).toMatchObject([{ token }]);
    expect(tab.text()).not.toMatch(/Zerops isn't answering|product mounted/);
  });
});
