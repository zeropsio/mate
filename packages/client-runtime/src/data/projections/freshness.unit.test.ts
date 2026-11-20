import { expect, it } from "vite-plus/test";

import { ORG, pastGrace } from "../__fixtures__/account.ts";
import { hqAppsScope } from "../families/hqNavigation.ts";
import { projectsScope } from "../families/project.ts";
import {
  emptyAccount,
  linkKeys,
  type AccountState,
  type LinkKey,
  type ScopeKey,
} from "../model.ts";
import { reduceAccount, type AccountInput } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import type { StreamEvent } from "../streamMachine.ts";
import { scopeFreshness } from "./freshness.ts";
import { organizationProjects } from "./projects.ts";

const event = (key: LinkKey | ScopeKey, event: StreamEvent): AccountInput => ({
  kind: "stream",
  key,
  now: 0,
  event,
});
const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const roster = (state: AccountState) => organizationProjects.derive(readsOfState(state), ORG);

// witness: packages/client-runtime/src/data/projections/freshness.ts | liveOrHeld(link) || CONNECTED.has(link.phase) → liveOrHeld(link)
it("PJ84: A scope that read its own baseline is current while its connection is open, whatever the connection's other scopes still read; a connection that failed leaves it catching up", () => {
  const link = linkKeys.zerops(ORG);
  const scope = projectsScope(ORG);
  const baselined = apply(emptyAccount, [
    event(link, { kind: "demand", demanded: true }),
    event(link, { kind: "handshake" }),
    event(scope, { kind: "demand", demanded: true }),
    event(scope, { kind: "attempt" }),
    event(scope, { kind: "handshake" }),
    { kind: "baseline-begin", scope, generation: 1 },
    {
      kind: "baseline-commit",
      scope,
      generation: 1,
      via: "zerops-realtime",
      members: [],
      rows: [],
    },
    event(scope, { kind: "baseline-committed" }),
  ]);
  expect(roster(baselined)).toMatchObject({ read: "read", live: true });

  const disconnected = apply(baselined, [
    event(link, { kind: "fault", fault: { outcome: "transient", message: "closed" }, jitter: 0 }),
    event(scope, { kind: "parent-lost" }),
  ]);
  expect(roster(pastGrace(disconnected))).toMatchObject({ live: false, reconnecting: true });
});

// witness: packages/client-runtime/src/data/projections/freshness.ts | CATCHING_UP.has(stream.phase) || →
it("PJ109: A scope retrying its own failed read while its connection is open is catching up, so a surface says it is retrying instead of waiting in silence", () => {
  const link = linkKeys.hq(ORG);
  const scope = hqAppsScope(ORG);
  const failed = apply(emptyAccount, [
    event(link, { kind: "demand", demanded: true }),
    event(link, { kind: "handshake" }),
    event(link, { kind: "baseline-committed" }),
    event(scope, { kind: "demand", demanded: true }),
    event(scope, { kind: "attempt" }),
    event(scope, { kind: "handshake" }),
    event(scope, {
      kind: "fault",
      fault: { outcome: "transient", message: "v1", code: "unavailable" },
      jitter: 0,
    }),
  ]);
  const reads = readsOfState(failed);
  expect(reads.stream(link).phase).toBe("live");
  expect(reads.stream(scope).phase).toBe("recovering");
  expect(scopeFreshness(reads, scope)).toMatchObject({
    complete: false,
    live: false,
    reconnecting: true,
  });
});
