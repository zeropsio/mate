import { AtomRegistry } from "effect/reactivity";
import { expect, it } from "vite-plus/test";
import { liveProjects, liveServices } from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { servicesScope } from "../families/service.ts";
import { mateLinkScope, type MateLinkValue } from "../families/mateLink.ts";
import { emptyAccount, type AccountState } from "../model.ts";
import { reduceAccount } from "../reducer.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { initialContainer } from "../../zerops/environments/containerMachine.ts";
import { discoveryStatus } from "./discoveryStatus.ts";

const key = { orgId: "org", hqAbsent: true };
const read = (state: AccountState, hqAbsent = true) =>
  discoveryStatus.derive(readsOfState(state), { ...key, hqAbsent });
const based = () =>
  [...liveProjects("org", []), ...liveServices("org", [])].reduce(
    (s, input) => reduceAccount(s, input).state,
    emptyAccount,
  );

it("unknown, partial and refused discovery never prove no projects", () => {
  expect(read(emptyAccount)).toBe("incomplete");
  const projectsOnly = liveProjects("org", []).reduce(
    (s, input) => reduceAccount(s, input).state,
    emptyAccount,
  );
  expect(read(projectsOnly)).toBe("incomplete");
  expect(read(based())).toBe("complete");
  const refused = reduceAccount(based(), {
    kind: "stream",
    key: servicesScope("org"),
    now: 0,
    event: {
      kind: "fault",
      fault: { outcome: "definitive-refusal", message: "No listing" },
      jitter: 0,
    },
  }).state;
  expect(read(refused)).toBe("unavailable");
});

it("HQ's unread navigation is independent of platform coverage", () => {
  const registry = AtomRegistry.make();
  const store = makeAccountStore(registry);
  [...liveProjects("org", []), ...liveServices("org", [])].forEach(store.dispatch);
  expect(read(store.state(), false)).toBe("incomplete");
  seedHqNavigation(store, "org", {});
  expect(read(store.state(), false)).toBe("complete");
  store.close();
  registry.dispose();
});

it.each(["none", "backoff", "refused"] as const)(
  "a wanted registration in %s has not completed discovery",
  (kind) => {
    const scope = mateLinkScope("p");
    const value = {
      key: "p:s",
      projectId: "p",
      orgId: "org",
      origin: null,
      shown: true,
      watched: true,
      environment: { guards: { want: true }, credential: { kind } },
      container: initialContainer(),
    } as unknown as MateLinkValue;
    let state = based();
    state = reduceAccount(state, {
      kind: "stream",
      key: scope,
      now: 0,
      event: { kind: "demand", demanded: true },
    }).state;
    state = reduceAccount(state, {
      kind: "stream",
      key: scope,
      now: 0,
      event: { kind: "attempt" },
    }).state;
    state = reduceAccount(state, {
      kind: "rows",
      scope,
      generation: 1,
      via: "mate-direct",
      method: "push",
      rows: [
        { family: "mateLink", id: "p:s", value, revision: { kind: "mate-link", sequence: 1 } },
      ],
    }).state;
    expect(read(state)).toBe(kind === "none" ? "incomplete" : "unavailable");
  },
);
