import { expect, it } from "vite-plus/test";

import { ORG, pastGrace } from "../__fixtures__/account.ts";
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
