import { describe, expect, it } from "vite-plus/test";

import { liveServices, liveZerops, ORG, zeropsVersion } from "../__fixtures__/account.ts";
import { serviceFamily, servicesScope, type ServiceValue } from "../families/service.ts";
import { emptyAccount, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { serviceRuns, type ServiceRuns } from "./serviceRuns.ts";

const apply = (inputs: ReadonlyArray<AccountInput>): AccountState =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, emptyAccount);

const named = (id: string, name: string): NonNullable<ServiceValue["userData"]> => [
  { key: "hostname", content: "app" },
  { key: "appVersionId", content: id },
  { key: "appVersionName", content: name },
];

const listed = (row: Partial<ServiceValue>) =>
  apply(liveServices(ORG, [{ id: "app", projectId: "p1", ...row }]));

it.each(["v-old", "v-other"])(
  "joins only the exact active version after a failed newer build (%s)",
  (versionId) => {
    const state = apply(
      liveZerops({
        services: [
          {
            id: "app",
            projectId: "p1",
            activeAppVersion: { id: "v-old", source: "GIT" },
            userData: named("v-new", "new commit"),
          },
        ],
        running: [
          {
            id: "old-build",
            projectId: "p1",
            serviceStackIds: ["app"],
            status: "FINISHED",
            appVersion: { id: versionId, name: "old commit" },
          },
        ],
      }),
    );
    expect(serviceRuns.derive(readsOfState(state), { orgId: ORG, serviceId: "app" })).toMatchObject(
      {
        activeId: "v-old",
        name: versionId === "v-old" ? "old commit" : null,
      },
    );
  },
);

describe("serviceRuns", () => {
  it.each<{
    readonly name: string;
    readonly state: () => AccountState;
    readonly expected: ServiceRuns;
  }>([
    {
      name: "the services listing not read yet: unread",
      state: () => emptyAccount,
      expected: "unread",
    },
    {
      name: "a row silent on what it runs: unread",
      state: () => listed({}),
      expected: "unread",
    },
    {
      name: "a row that runs nothing: no version",
      state: () => listed({ activeAppVersion: null }),
      expected: { activeId: null, source: null, name: null },
    },
    {
      name: "its variables name the version it runs: that name",
      state: () =>
        listed({
          activeAppVersion: { id: "v2", source: "GIT" },
          userData: named("v2", "main 6aeae99"),
        }),
      expected: { activeId: "v2", source: "GIT", name: "main 6aeae99" },
    },
    {
      name: "its variables name a build started since: nameless",
      state: () =>
        listed({ activeAppVersion: { id: "v2", source: "GIT" }, userData: named("v3", "next") }),
      expected: { activeId: "v2", source: "GIT", name: null },
    },
    {
      name: "the version's own name stands",
      state: () =>
        listed({ activeAppVersion: { id: "v2", name: "v1.0.0" }, userData: named("v3", "next") }),
      expected: { activeId: "v2", source: null, name: "v1.0.0" },
    },
    {
      name: "a blank name (a no-code version) is none",
      state: () =>
        listed({ activeAppVersion: { id: "v1", source: "NONE" }, userData: named("v1", "  ") }),
      expected: { activeId: "v1", source: "NONE", name: null },
    },
    {
      name: "a service the listing does not hold: not there",
      state: () => apply(liveServices(ORG, [{ id: "db", projectId: "p1" }])),
      expected: "absent",
    },
  ])("$name", ({ state, expected }) => {
    expect(serviceRuns.derive(readsOfState(state()), { orgId: ORG, serviceId: "app" })).toEqual(
      expected,
    );
  });
});

/** A pushed frame, as the platform sends it, decoded as the adapter decodes it. */
const pushed = (frame: Readonly<Record<string, unknown>>): AccountInput => {
  const row = serviceFamily.zerops!.decode(frame)!;
  return {
    kind: "rows",
    scope: servicesScope(ORG),
    generation: 1,
    method: "push",
    via: "zerops-realtime",
    rows: [{ family: "service", id: row.id, value: row.value, revision: zeropsVersion(2) }],
  };
};

it("a push that names only part of a service's row keeps what it runs", () => {
  const running = listed({
    activeAppVersion: { id: "v2", source: "GIT" },
    userData: named("v2", "main 6aeae99"),
  });
  const state = reduceAccount(
    running,
    pushed({ id: "app", projectId: "p1", name: "app", status: "STOPPED", _version: 2 }),
  ).state;
  expect(readsOfState(state).fact("service", "app")).toMatchObject({
    kind: "known",
    value: { status: "STOPPED" },
  });
  expect(serviceRuns.derive(readsOfState(state), { orgId: ORG, serviceId: "app" })).toEqual({
    activeId: "v2",
    source: "GIT",
    name: "main 6aeae99",
  });
});
