import type { ZeropsUser } from "@t3tools/client-runtime/zerops";
import { makeAccountHarness, type AccountHarness } from "@t3tools/client-runtime/zerops/testing";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { mountTab, unmountTabs, type MountedTab } from "./__fixtures__/harnessTabs";

vi.mock("../components/zerops/landing/ZeropsLandingShell", () => ({
  ZeropsLandingWait: ({ label }: { readonly label: string }) => label,
}));

const MINUTE_MS = 60_000;
const CHILD = "product mounted";

const person: ZeropsUser = {
  id: "user-1",
  email: "person@example.test",
  clientUserList: [{ id: "cu-1", clientId: "org-1", roleCode: "OWNER" }],
};

/**
 * The signed-in product, admitted, on a clock the test moves. Timers still
 * run on their own between moves, so the harness's task turns go by.
 */
async function admittedProduct(
  options: {
    readonly before?: (harness: AccountHarness) => void;
    /** How long the first round's project read takes to answer. */
    readonly firstRoundMs?: number;
  } = {},
) {
  vi.useFakeTimers({
    toFake: ["Date", "performance", "setTimeout", "clearTimeout"],
    shouldAdvanceTime: true,
  });
  const harness = makeAccountHarness({
    people: [{ user: person, password: "secret" }],
    projects: [
      { id: "p1", clientId: "org-1", name: "One", status: "ACTIVE" },
      { id: "p2", clientId: "org-1", name: "Two", status: "ACTIVE" },
    ],
    signedIn: "user-1",
  });
  options.before?.(harness);
  const firstRead =
    options.firstRoundMs === undefined ? null : harness.rest.hold("GET /project/p1");
  let mounts = 0;
  const tab: MountedTab = await mountTab(harness, harness.browser.openTab(), {
    page: async () => {
      const { AccountProduct, ProductChild, ProjectNotice } =
        await import("./__fixtures__/accountProduct");
      return (
        <AccountProduct datastream={harness.datastream}>
          <ProductChild
            label={CHILD}
            onMount={() => {
              mounts++;
            }}
          />
          <ProjectNotice projectId="p1" />
          <ProjectNotice projectId="p2" />
        </AccountProduct>
      );
    },
  });
  const pass = (ms: number) => tab.run(() => vi.advanceTimersByTimeAsync(ms));
  // The first round's read is out, so the round started no later than this.
  const firstRoundBy = performance.now();
  if (firstRead !== null) {
    expect(firstRead.waiting()).toBe(1);
    await pass(options.firstRoundMs!);
    expect(tab.text()).not.toContain(CHILD);
    await tab.run(() => firstRead.release());
    await pass(0);
  }
  expect(tab.text()).toContain(CHILD);
  const rounds = () =>
    harness.rest.requests().filter(({ route }) => route === "GET /user/info").length;
  return { harness, tab, pass, rounds, mounts: () => mounts, firstRoundBy };
}

afterEach(async () => {
  await unmountTabs();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ZeropsInventoryProvider renewal", () => {
  it("a tab hidden across the renewal is granted on return with no alert", async () => {
    const { tab, pass, rounds, mounts } = await admittedProduct();
    const before = rounds();

    await pass(MINUTE_MS);
    // Hidden, the data runtime pauses its push half after a minute (T-L1).
    tab.tab.signals.hide();
    await pass(19 * MINUTE_MS);
    expect(tab.text()).not.toContain("Could not load your Zerops projects.");
    await pass(20 * MINUTE_MS);
    tab.tab.signals.show();
    await pass(0);

    expect(rounds()).toBeGreaterThan(before);
    // The product was never taken down and put back.
    expect(mounts()).toBe(1);
    expect(tab.text()).toContain(CHILD);
    expect(tab.text()).not.toContain("Could not load your Zerops projects.");
    expect(tab.text()).not.toContain("Project access could not be verified.");
  });

  it("a renewal never closes writes before the old deadline", async () => {
    const { harness, tab, pass, rounds } = await admittedProduct();
    const before = rounds();
    const renewal = harness.rest.hold("GET /user/info");
    const write = () =>
      tab.run(() => tab.session().client.updateProjectGroupTags("p1", { label: "Renamed" }));

    // Past the renewal and short of the deadline, with every renewal attempt still out.
    await pass(14 * MINUTE_MS + 30_000);
    expect(renewal.waiting()).toBeGreaterThan(0);
    await expect(write()).resolves.toMatchObject({ id: "p1" });

    await tab.run(() => renewal.release());
    await pass(2 * MINUTE_MS);
    expect(rounds()).toBeGreaterThan(before);
    await expect(write()).resolves.toMatchObject({ id: "p1" });
  });

  // The evidence runs out 15 min after its round started, whichever clock gets
  // there first: the monotonic one when the system clock is set back, the wall
  // one when the machine sleeps (DESIGN G2, G5).
  it.each([
    [
      "the monotonic clock",
      async ({ pass }: Awaited<ReturnType<typeof admittedProduct>>) => {
        vi.setSystemTime(Date.now() - 30_000);
        await pass(15 * MINUTE_MS - 2_000);
      },
      async ({ pass }: Awaited<ReturnType<typeof admittedProduct>>) => {
        await pass(2_000);
      },
    ],
    [
      "the wall clock",
      async ({ pass }: Awaited<ReturnType<typeof admittedProduct>>) => {
        await pass(13 * MINUTE_MS);
      },
      async ({ tab }: Awaited<ReturnType<typeof admittedProduct>>) => {
        vi.setSystemTime(Date.now() + 2 * MINUTE_MS);
        tab.tab.signals.freeze();
        tab.tab.signals.resume();
        await tab.run(() => undefined);
      },
    ],
  ] as const)(
    "no write at or past the evidence deadline on %s",
    async (_clock, toJustBefore, toTheDeadline) => {
      const product = await admittedProduct();
      const { harness, tab } = product;
      // Every renewal hangs: nothing extends the evidence the product was admitted on.
      harness.rest.hang("GET /user/info");
      const write = () =>
        tab.run(() => tab.session().client.updateProjectGroupTags("p1", { label: "Renamed" }));

      await toJustBefore(product);
      await expect(write()).resolves.toMatchObject({ id: "p1" });
      await toTheDeadline(product);
      await expect(write()).rejects.toMatchObject({
        message: "Project access could not be verified.",
      });
    },
  );

  it("a round that answers 40 s after it started ends its writes 15 min after it started", async () => {
    const { harness, tab, pass, firstRoundBy } = await admittedProduct({ firstRoundMs: 40_000 });
    harness.rest.hang("GET /user/info");
    const write = () =>
      tab.run(() => tab.session().client.updateProjectGroupTags("p1", { label: "Renamed" }));
    const toDeadline = () => firstRoundBy + 15 * MINUTE_MS - performance.now();

    // Admitted 40 s into its round, the evidence is stamped when the round
    // started, not when it answered (G2, T-L4).
    await pass(toDeadline() - 10_000);
    await expect(write()).resolves.toMatchObject({ id: "p1" });
    await pass(toDeadline());
    await expect(write()).rejects.toMatchObject({
      message: "Project access could not be verified.",
    });
  });

  it("a lapse names its cause once, beside one way to try again", async () => {
    const { harness, tab, pass } = await admittedProduct();
    harness.rest.hang("GET /user/info");

    await pass(16 * MINUTE_MS);

    expect(tab.text()).toContain("Project access verification expired.");
    expect(tab.text().match(/Try again/g)).toHaveLength(1);
  });

  // One project's read failing is that project's problem, never the account's (DESIGN G1, C2b).
  it.each([
    ["the first round", (harness: AccountHarness) => harness.rest.failProject("p2", 503), 0],
    ["a renewal", () => undefined, 16 * MINUTE_MS],
  ] as const)(
    "a round with one failing project admits the account: %s",
    async (_round, before, renewAfterMs) => {
      const { harness, tab, pass, rounds } = await admittedProduct({ before });
      const admitted = rounds();
      harness.rest.failProject("p2", 503);

      await pass(renewAfterMs);

      expect(rounds()).toBeGreaterThanOrEqual(admitted + (renewAfterMs === 0 ? 0 : 1));
      expect(tab.text()).toContain(CHILD);
      expect(tab.text()).not.toContain("Could not load your Zerops projects.");
      // The failing project keeps its place; its content waits for fresh evidence.
      expect(tab.text()).toContain("p2: Checking your access to this project…");
      expect(tab.text()).not.toContain("p1:");
      await expect(
        tab.run(() => tab.session().client.updateProjectGroupTags("p1", { label: "Renamed" })),
      ).resolves.toMatchObject({ id: "p1" });
    },
  );
});
