import type { ZeropsUser } from "@t3tools/client-runtime/zerops";
import { CAPABILITY_WAIT_MS } from "@t3tools/client-runtime/zerops/data";
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

type Product = Awaited<ReturnType<typeof admittedProduct>>;

/**
 * A write at or past the deadline, every renewal still out. The lapsed account
 * is a refusal the grant can still lift, so the write waits it out for
 * {@link CAPABILITY_WAIT_MS} and is then refused, never sent (DESIGN §4.3).
 */
async function refusedWrite({ harness, tab, pass }: Product) {
  const writes = () =>
    harness.rest.requests().filter(({ route }) => route === "PUT /project/p1").length;
  const sent = writes();
  const { refused } = await tab.run(() => ({
    refused: expect(
      tab.session().client.updateProjectGroupTags("p1", { label: "Renamed" }),
    ).rejects.toMatchObject({ message: "Project access could not be verified." }),
  }));
  await pass(CAPABILITY_WAIT_MS);
  await refused;
  expect(writes()).toBe(sent);
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
      async ({ pass }: Product) => {
        vi.setSystemTime(Date.now() - 30_000);
        await pass(15 * MINUTE_MS - 2_000);
      },
      async ({ pass }: Product) => {
        await pass(2_000);
      },
    ],
    [
      "the wall clock",
      async ({ pass }: Product) => {
        await pass(13 * MINUTE_MS);
      },
      async ({ tab }: Product) => {
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
      await refusedWrite(product);
    },
  );

  it("a round that answers 40 s after it started ends its writes 15 min after it started", async () => {
    const product = await admittedProduct({ firstRoundMs: 40_000 });
    const { harness, tab, pass, firstRoundBy } = product;
    harness.rest.hang("GET /user/info");
    const write = () =>
      tab.run(() => tab.session().client.updateProjectGroupTags("p1", { label: "Renamed" }));
    const toDeadline = () => firstRoundBy + 15 * MINUTE_MS - performance.now();

    // Admitted 40 s into its round, the evidence is stamped when the round
    // started, not when it answered (G2, T-L4).
    await pass(toDeadline() - 10_000);
    await expect(write()).resolves.toMatchObject({ id: "p1" });
    await pass(toDeadline());
    await refusedWrite(product);
  });

  it("a lapse names its cause once, beside one way to try again", async () => {
    const { harness, tab, pass } = await admittedProduct();
    harness.rest.hang("GET /user/info");

    await pass(16 * MINUTE_MS);

    expect(tab.text().match(/Zerops isn't answering\./g)).toHaveLength(1);
    expect(tab.text().match(/Try now/g)).toHaveLength(1);
  });

  // `online` is a wake (DESIGN §6.4): the lapse ends as soon as Zerops answers again.
  it("lapsed + offline → online → a round starts at once and the overlay clears when it verifies", async () => {
    const { tab, pass, rounds } = await admittedProduct();
    tab.tab.signals.offline();
    await pass(16 * MINUTE_MS);
    expect(tab.text()).toContain(CHILD);
    expect(tab.readable()).not.toContain(CHILD);
    const before = rounds();

    tab.tab.signals.online();
    await pass(0);

    expect(rounds()).toBe(before + 1);
    await pass(1_000);
    expect(tab.readable()).toContain(CHILD);
    expect(tab.text()).not.toMatch(/Checking your Zerops access|Zerops isn't answering/);
    expect(tab.text()).not.toMatch(/Try (again|now)/);
  });

  // One cause-only sentence for the whole lapse, beside its one affordance (DESIGN §3.4, R-K3).
  it("the overlay copy does not change while the lapse reason is unchanged", async () => {
    const { harness, tab, pass } = await admittedProduct();
    harness.rest.hang("GET /user/info");
    await pass(16 * MINUTE_MS);
    const seen = [tab.readable()];
    // Back after 2 min hidden, the organizations' reads stall past their grace while the rounds
    // keep failing: the inventory's own error appears beneath the overlay (gate CD).
    tab.tab.signals.hide();
    await pass(2 * MINUTE_MS);
    harness.datastream.holdRegistrations();
    tab.tab.signals.show();
    for (let step = 0; step < 6; step++) {
      await pass(30_000);
      seen.push(tab.readable());
    }

    expect(new Set(seen).size).toBe(1);
    expect(seen[0]).not.toContain(CHILD);
    expect(seen[0]).toContain("Zerops isn't answering.");
    expect(seen[0]!.match(/Try (again|now)|Sign out/g)).toEqual(["Try now"]);
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
