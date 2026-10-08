import { RegistryContext } from "@effect/atom-react";
import { accountReadsAtom, makeAccountStore, makeMateAdapter } from "@t3tools/client-runtime/data";
import { EnvironmentId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { act, Profiler } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { TestNode } from "./__fixtures__/testDom";

function installTestDom(): TestNode {
  const document = new TestNode("#document", null, 9);
  vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    document,
    HTMLIFrameElement: TestNode,
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal("HTMLIFrameElement", TestNode);
  return document;
}

const MATES = 12;
const keyOf = (mate: number) => `project-${mate}:zcp`;
const environmentOf = (mate: number) => EnvironmentId.make(`env-${mate}`);

/** The account's store with a Mate adapter writing to it, over twelve listed Mates. */
function adapterOverStore() {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  registry.set(accountReadsAtom, {
    data: store.data,
    orgId: "org-1",
    demandDetail: () => () => {},
    renewHeld: () => {},
  });
  const adapter = makeMateAdapter<unknown>({
    store,
    clock: {
      now: () => ({ wall: 0, mono: 0 }),
      random: () => 0.5,
      setTimer: () => () => undefined,
    },
    exchange: () => new Promise(() => undefined),
    install: async () => ({ ok: true }),
    readDescriptor: () => new Promise(() => undefined),
    retryLink: () => undefined,
    retire: () => undefined,
    probe: () => new Promise(() => undefined),
    readInitAt: async () => null,
    readMateFlag: async () => "unknown",
    intents: { read: () => null, write: () => undefined },
  });
  adapter.setTargets(
    Array.from({ length: MATES }, (_, at) => ({
      key: keyOf(at + 1),
      orgId: "org-1",
      presence: { kind: "present", origin: `https://zcp-${at + 1}.example` } as const,
      origin: `https://zcp-${at + 1}.example`,
      platform: { project: "ACTIVE", service: "ACTIVE" },
      record: environmentOf(at + 1),
    })),
  );
  return { registry, adapter };
}

// The modules' first load is the file's setup, with its own time: under load it took most of the
// test's 15 s (measured 2026-10-03), and the test timed out before its first commit.
beforeAll(async () => {
  await Promise.all([import("react-dom/client"), import("./accountEnvironments")]);
}, 120_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Mates as React reads them", () => {
  // After a lapse, the grant reconnects every Mate at once: each one's link publishes on its own,
  // microtask by microtask, all within one task. A surface that schedules an update in a commit
  // counts every commit as nested (React's limit is 50): the burst must reach it as few commits.
  it("a burst of link publications from twelve reconnecting Mates in one task is one commit", async () => {
    const document = installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { useEnvironmentMachines } = await import("./accountEnvironments");
    const { registry, adapter } = adapterOverStore();
    let connected = -1;
    let commits = 0;

    function Surface() {
      connected = [...useEnvironmentMachines().values()].filter(
        (machine) => machine.link.phase === "connected",
      ).length;
      return null;
    }

    const root = createRoot(document.createElement("div") as unknown as Element);
    try {
      await act(async () =>
        root.render(
          <RegistryContext value={registry}>
            <Profiler id="surface" onRender={() => void (commits += 1)}>
              <Surface />
            </Profiler>
          </RegistryContext>,
        ),
      );
      await vi.waitFor(() => expect(connected).toBe(0));
      commits = 0;

      for (let mate = 1; mate <= MATES; mate += 1) {
        for (const phase of ["connecting", "backoff", "connecting", "connected"] as const) {
          adapter.link(
            environmentOf(mate),
            phase === "backoff" ? { phase, retryAtMs: null } : { phase },
          );
          await Promise.resolve();
        }
      }
      await vi.waitFor(() => expect(connected).toBe(MATES));

      expect(commits).toBe(1);
      expect(connected).toBe(MATES);
    } finally {
      await act(async () => root.unmount());
      adapter.dispose();
    }
  });
});
