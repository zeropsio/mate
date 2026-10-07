import { AtomRegistry } from "effect/unstable/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { makeAccountStore, readsOfState } from "../store.ts";
import { regionRecommendation } from "../projections/regionRecommendation.ts";
import { demandLocationLatency } from "./locationLatency.ts";

const locations = [
  { id: "a", name: "A", pingUrl: "https://a.example/ping" },
  { id: "b", name: "B", pingUrl: "https://b.example/ping" },
];
function rig() {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  const read = () =>
    regionRecommendation.derive(readsOfState(store.state()), { orgId: "org", locations });
  return { registry, store, read };
}

it("no sample supplies no measured recommendation; only successful measured locations compete", async () => {
  const r = rig();
  const clock = vi
    .fn()
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(0)
    .mockReturnValueOnce(15)
    .mockReturnValueOnce(5);
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(null));
  expect(r.read()).toBeNull();
  const release = locations.map((location) =>
    demandLocationLatency({ store: r.store, orgId: "org", location, fetch, now: clock }),
  );
  await vi.waitFor(() => expect(r.read()).toBe("b"));
  release.forEach((stop) => stop());
  const again = demandLocationLatency({
    store: r.store,
    orgId: "org",
    location: locations[1]!,
    fetch,
    now: clock,
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(r.read()).toBe("b");
  again();
  r.store.close();
  r.registry.dispose();
});

it("a failed sample is not guessed and remount does not repeat it", async () => {
  const r = rig();
  const fetch = vi.fn<typeof globalThis.fetch>().mockRejectedValue(new Error("offline"));
  const location = locations[0]!;
  const release = demandLocationLatency({ store: r.store, orgId: "org", location, fetch });
  await vi.waitFor(() =>
    expect([...r.store.state().streams.values()].some((s) => s.fault !== null)).toBe(true),
  );
  release();
  const again = demandLocationLatency({ store: r.store, orgId: "org", location, fetch });
  expect(fetch).toHaveBeenCalledOnce();
  expect(r.read()).toBeNull();
  again();
  r.store.close();
  r.registry.dispose();
});

it("holders share one read and a late answer after the last release is fenced", async () => {
  const r = rig();
  let answer!: (response: Response) => void;
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  const input = { store: r.store, orgId: "org", location: locations[0]!, fetch };
  const one = demandLocationLatency(input);
  const two = demandLocationLatency(input);
  one();
  expect(fetch).toHaveBeenCalledOnce();
  two();
  answer(new Response(null));
  await Promise.resolve();
  await Promise.resolve();
  expect(r.read()).toBeNull();
  r.store.close();
  r.registry.dispose();
});
