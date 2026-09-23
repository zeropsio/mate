import type { ZeropsUser } from "@t3tools/client-runtime/zerops";
import type { ZeropsResourceAdapter } from "@t3tools/client-runtime/zerops/data";
import { makeAccountHarness, type AccountHarness } from "@t3tools/client-runtime/zerops/testing";
import * as Effect from "effect/Effect";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mountTab, unmountTabs, type MountedTab } from "./__fixtures__/harnessTabs";

vi.mock("../components/zerops/landing/ZeropsLandingShell", () => ({
  ZeropsLandingWait: ({ label }: { readonly label: string }) => label,
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

const person: ZeropsUser = {
  id: "user-1",
  email: "person@example.test",
  clientUserList: [{ id: "cu-1", clientId: "org-1", roleCode: "OWNER" }],
};

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
  const tab: MountedTab = await mountTab(harness, harness.browser.openTab(), {
    page: async () => {
      const { AccountProduct, OrganizationLocations, ProductChild, ProjectNames } =
        await import("./__fixtures__/accountProduct");
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
    expect(tab.text()).toContain("locations: success Prague");
    harness.rest.hang("GET /user/info");

    await pass(16 * MINUTE_MS);

    expect(mounts()).toBe(1);
    expect(tab.text()).toContain("locations: released");
    expect(tab.text()).not.toContain("Prague");
    expect(source.reads()).toBe(1);
  });

  it("a resource erased by lapse re-acquires on the next grant", async () => {
    const source = locationsSource();
    const { harness, tab, pass, mounts } = await admittedProduct({
      resourceAdapter: source.adapter,
    });
    await pass(0);
    const renewals = harness.rest.hang("GET /user/info");
    await pass(16 * MINUTE_MS);
    expect(tab.text()).toContain("locations: released");

    renewals();
    await pass(2 * MINUTE_MS);

    expect(mounts()).toBe(1);
    expect(source.reads()).toBe(2);
    expect(tab.text()).toContain("locations: success Prague");
  });

  // T-L2, Phase 0: the product stays mounted beneath an opaque overlay.
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
    expect(tab.text()).toContain(CHILD);
    expect(tab.readable()).not.toContain(CHILD);
    expect(tab.readable()).not.toMatch(/One|Two|projects:/);
    expect(tab.readable()).toContain("Project access verification expired.");

    await tab.run(() => round.release());
    await pass(0);

    expect(mounts()).toBe(1);
    expect(tab.readable()).toContain(CHILD);
    expect(tab.readable()).toContain("projects: One, Two");
    expect(tab.readable()).not.toContain("Project access verification expired.");
  });

  it("an open dialog at the deadline leaves no platform text anywhere in the document, including the title", async () => {
    const { harness, tab, pass } = await admittedProduct({ layers: true });
    expect(tab.readable()).toContain("dialog: One, Two");
    expect(tab.title()).toBe("One, Two · Zerops Mate");
    const renewals = harness.rest.hang("GET /user/info");

    await pass(16 * MINUTE_MS);

    expect(tab.readable()).not.toMatch(/One|Two|dialog:/);
    expect(tab.readable()).toContain("Project access verification expired.");
    expect(tab.title()).not.toMatch(/One|Two/);

    // The next grant gives it all back.
    renewals();
    await pass(2 * MINUTE_MS);
    expect(tab.readable()).toContain("dialog: One, Two");
    expect(tab.title()).toBe("One, Two · Zerops Mate");
  });
});
