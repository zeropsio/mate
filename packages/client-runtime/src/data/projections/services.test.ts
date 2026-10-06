import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG, serviceValue, zeropsVersion } from "../__fixtures__/account.ts";
import { servicesScope } from "../families/service.ts";
import { emptyAccount, linkKeys, type AccountState } from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import { projectServices, type ProjectServices } from "./services.ts";

const SCOPE = servicesScope(ORG);
const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const event = (key: string, streamEvent: object): AccountInput =>
  ({ kind: "stream", key, now: 0, event: streamEvent }) as AccountInput;

const live = () =>
  apply(
    emptyAccount,
    liveZerops({
      running: [],
      projects: [{ id: "p1" }, { id: "p2" }],
      services: [
        { id: "zcp", projectId: "p1" },
        { id: "db", projectId: "p1" },
        { id: "web", projectId: "p2" },
      ],
    }),
  );
const pushed = (row: Parameters<typeof serviceValue>[0], version: number): AccountInput => ({
  kind: "rows",
  scope: SCOPE,
  generation: 1,
  method: "push",
  via: "zerops-realtime",
  rows: [
    { family: "service", id: row.id, value: serviceValue(row), revision: zeropsVersion(version) },
  ],
});
const delta = (add: ReadonlyArray<string>, remove: ReadonlyArray<string>): AccountInput => ({
  kind: "membership",
  scope: SCOPE,
  generation: 1,
  delta: { add, remove },
});

describe("projectServices", () => {
  it.each<{
    readonly name: string;
    readonly state: () => AccountState;
    readonly expected: Partial<Omit<ProjectServices, "services">> & {
      readonly services: ReadonlyArray<string> | undefined;
      readonly statuses?: ReadonlyArray<string>;
    };
  }>([
    {
      name: "nothing read yet: not known, never empty",
      state: () => emptyAccount,
      expected: { services: undefined, live: false, reconnecting: false },
    },
    {
      name: "the organization's listing read: the project's own services, by name",
      state: live,
      expected: { services: ["db", "zcp"], live: true },
    },
    {
      name: "a service pushed later: its newest row",
      state: () => apply(live(), [pushed({ id: "zcp", projectId: "p1", status: "STOPPED" }, 2)]),
      expected: { services: ["db", "zcp"], statuses: ["ACTIVE", "STOPPED"] },
    },
    {
      name: "a new service in the project: listed once its row is read",
      state: () => apply(live(), [delta(["api"], []), pushed({ id: "api", projectId: "p1" }, 1)]),
      expected: { services: ["api", "db", "zcp"] },
    },
    {
      name: "a service that left the listing: none of the project's",
      state: () => apply(live(), [delta([], ["db"])]),
      expected: { services: ["zcp"] },
    },
    {
      name: "an outage: what was read stays, catching up",
      state: () =>
        apply(live(), [
          event(linkKeys.zerops(ORG), {
            kind: "fault",
            fault: { outcome: "transient", message: "socket closed" },
            jitter: 0,
          }),
        ]),
      expected: { services: ["db", "zcp"], live: false, reconnecting: true },
    },
    {
      name: "refused: unavailable, and why",
      state: () =>
        apply(emptyAccount, [
          event(linkKeys.zerops(ORG), { kind: "demand", demanded: true }),
          event(SCOPE, { kind: "demand", demanded: true }),
          event(SCOPE, { kind: "attempt" }),
          event(SCOPE, {
            kind: "fault",
            fault: { outcome: "authoritative-denial", message: "HTTP 403" },
            jitter: 0,
          }),
        ]),
      expected: { services: undefined, unavailableReason: "forbidden" },
    },
  ])("$name", ({ state, expected }) => {
    const { services: ids, statuses, ...rest } = expected;
    const derived = projectServices.derive(readsOfState(state()), { orgId: ORG, projectId: "p1" });
    expect(derived.services?.map((service) => service.id)).toEqual(ids);
    if (statuses !== undefined)
      expect(derived.services?.map((service) => service.status)).toEqual(statuses);
    expect(derived).toMatchObject(rest);
  });
});
