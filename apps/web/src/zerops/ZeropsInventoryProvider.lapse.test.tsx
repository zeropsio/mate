import { ZEROPS_SESSION_STORAGE_KEY, type ZeropsUser } from "@t3tools/client-runtime/zerops";
import type { AccountStore } from "@t3tools/client-runtime/data";
import type { Link } from "@t3tools/client-runtime/zerops/environments";
import { INVALIDATION_COALESCE_MS } from "@t3tools/client-runtime/zerops/knowledge/invalidation";
import { makeAccountHarness, type AccountHarness } from "@t3tools/client-runtime/zerops/testing";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mountTab, preloadTabs, unmountTabs, type MountedTab } from "./__fixtures__/harnessTabs";
import { buttonsLabelled, press } from "./__fixtures__/testDom";

preloadTabs(
  () => import("./__fixtures__/accountProduct"),
  () => import("./__fixtures__/platformLayers"),
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

/**
 * The signed-in product, admitted, on a clock the test moves. Timers still
 * run on their own between moves, so the harness's task turns go by.
 */
async function admittedProduct(
  options: {
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
  let store: AccountStore | null = null;
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
      const { AccountProduct, Conversation, ListingState, ProductChild, ProjectNames } =
        await import("./__fixtures__/accountProduct");
      const { ProjectDialog, ProjectTitle } = await import("./__fixtures__/platformLayers");
      return (
        <AccountProduct
          datastream={harness.datastream}
          onStore={(held) => {
            store = held;
          }}
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
  return {
    harness,
    tab,
    pass,
    mounts: () => mounts,
    /** The account's store, as the platform's answers reach it. */
    store: () => {
      if (store === null) throw new Error("The account's store is not mounted.");
      return store;
    },
  };
}

afterEach(async () => {
  await unmountTabs();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ZeropsInventoryProvider lapse", () => {
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
    const { harness, tab, pass } = await admittedProduct({ layers: true });
    await pass(0);
    expect(tab.readable()).toContain("dialog: One, Two");
    expect(tab.title()).toBe("One, Two · Zerops Mate");
    const renewals = harness.rest.hold("GET /user/info");

    await pass(16 * MINUTE_MS);

    // Every region reads its platform facts withheld, and the title; the open dialog, which held
    // what it showed, closed.
    expect(tab.readable()).not.toMatch(/One|Two/);
    expect(tab.title()).not.toMatch(/One|Two/);
    expect(tab.readable()).toContain(CHILD);
    expect(tab.readable()).toContain("listing: withheld");
    expect(tab.readable().match(/Zerops isn't answering\./g)).toHaveLength(1);

    // The next grant gives the regions back within a second of its round: "Try now" starts one, or
    // joins the one out, and Zerops answers it. The dialog stays closed.
    await tab.run(() => press(buttonsLabelled(tab.container(), "Try now")[0]!));
    await pass(INVALIDATION_COALESCE_MS);
    await tab.run(() => renewals.release());
    await pass(1_000);
    expect(tab.readable()).toContain("projects: One, Two");
    expect(tab.readable()).not.toContain("dialog:");
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

  it("a project its owner refused suppresses the target's content and drafts", async () => {
    const { tab, pass, store } = await admittedProduct({
      conversation: { link: CONNECTED, lostAfterMs: null },
    });

    // The platform refuses p1 (a 403 on its own read): the store withholds it, and the grant
    // closes it at once.
    await tab.run(() =>
      store().dispatch({ kind: "access", family: "project", id: "p1", access: "denied" }),
    );
    await pass(0);

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
    harness.rest.hang("GET /user/info");
    await pass(16 * MINUTE_MS);
    expect(tab.readable()).toContain("Zerops isn't answering.");

    await tab.run(() => press(buttonsLabelled(tab.container(), "Sign out")[0]!));
    await pass(0);

    expect(tab.session().status).toBe("signed-out");
    expect(tab.accountId()).toBeNull();
    expect(storedSession(harness)).toBeNull();
    // Local only: `/auth/logout` revokes no personal token.
    expect(harness.rest.requests().filter(({ route }) => route === "POST /auth/logout")).toEqual(
      [],
    );
    expect(tab.text()).not.toMatch(/Zerops isn't answering|product mounted/);
  });
});
