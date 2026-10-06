import { describe, expect, it } from "@effect/vitest";
import { AtomRegistry } from "effect/unstable/reactivity";

import { ORG } from "../__fixtures__/account.ts";
import { seedHqNavigation } from "../__fixtures__/hqNavigation.ts";
import { linkKeys } from "../model.ts";
import { makeAccountStore, readsOfState } from "../store.ts";
import { recordedEnvironment } from "./recordedEnvironment.ts";

const ENVIRONMENT = {
  projectId: "p-stage",
  tier: "stage",
  name: "stage",
  sources: [],
  order: 0,
  keyHeld: false,
  keyInvalid: false,
  can: {},
  jobs: [],
  release: null,
  birth: null,
};

function derive(
  environments: unknown,
  options: { readonly seeded?: boolean; readonly paused?: boolean } = {},
) {
  const store = makeAccountStore(AtomRegistry.make());
  if (options.seeded !== false)
    seedHqNavigation(store, ORG, {
      structure: {
        apps: [{ id: "app-1", name: "Shop", projects: [], births: [], environments }],
        ungrouped: [],
      } as never,
    });
  if (options.paused === true)
    store.dispatch({
      kind: "stream",
      key: linkKeys.hq(ORG),
      now: 0,
      event: { kind: "demand", demanded: false },
    });
  return recordedEnvironment.derive(readsOfState(store.state()), {
    orgId: ORG,
    appId: "app-1",
    projectId: "p-stage",
  });
}

describe("recordedEnvironment — an attached project as HQ's navigation records its environment", () => {
  it.each([
    ["HQ's navigation not read yet", undefined, { seeded: false }, { kind: "waiting" }],
    ["its application holds no environment of it yet", [], {}, { kind: "waiting" }],
    [
      "recorded: its name and its key as HQ holds it",
      [ENVIRONMENT],
      {},
      { kind: "recorded", name: "stage", keyed: false },
    ],
    [
      "recorded with a key that works",
      [{ ...ENVIRONMENT, keyHeld: true }],
      {},
      { kind: "recorded", name: "stage", keyed: true },
    ],
    [
      "recorded with a key HQ found broken",
      [{ ...ENVIRONMENT, keyHeld: true, keyInvalid: true }],
      {},
      { kind: "recorded", name: "stage", keyed: false },
    ],
    [
      "the reader may not read its environments",
      { refused: "You may not read them." },
      {},
      { kind: "refused", reason: "You may not read them." },
    ],
    ["HQ no longer observed", [], { paused: true }, { kind: "unobserved" }],
  ] as const)("%s", (_label, environments, options, expected) => {
    expect(derive(environments, options)).toEqual(expected);
  });
});
