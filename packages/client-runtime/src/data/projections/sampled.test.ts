import { describe, expect, it } from "vite-plus/test";

import { liveZerops, ORG } from "../__fixtures__/account.ts";
import { locationsScope } from "../families/organizationLocations.ts";
import { membersScope } from "../families/organizationMembers.ts";
import { routingScope } from "../families/publicRouting.ts";
import { agentsScope } from "../families/serviceAgents.ts";
import { emptyAccount, type AccountState, type Family, type ScopeKey } from "../model.ts";
import { reduceAccount, type AccountInput, type Row } from "../reducer.ts";
import { readsOfState } from "../store.ts";
import type { StreamOutcome } from "../streamMachine.ts";
import { publicAccess } from "./publicAccess.ts";
import {
  organizationLocations,
  organizationMembers,
  servicesAgents,
  type SampledRead,
} from "./sampled.ts";

const apply = (state: AccountState, inputs: ReadonlyArray<AccountInput>) =>
  inputs.reduce((current, input) => reduceAccount(current, input).state, state);
const event = (key: ScopeKey, streamEvent: object): AccountInput =>
  ({ kind: "stream", key, now: 0, event: streamEvent }) as AccountInput;

/** A sampled scope demanded and its read begun: what a screen sees before the answer. */
const begun = (scope: ScopeKey): ReadonlyArray<AccountInput> => [
  event(scope, { kind: "demand", demanded: true }),
  event(scope, { kind: "attempt" }),
  event(scope, { kind: "handshake" }),
];
/** The read answered: the owner's value committed whole, and the scope live. */
const answered = (scope: ScopeKey, family: Family, value: unknown): ReadonlyArray<AccountInput> => {
  const ownerId = scope.split(":").slice(3).join(":");
  const generation = 1;
  const row = { family, id: ownerId, value, revision: { kind: "zerops", version: null } } as Row;
  return [
    { kind: "baseline-begin", scope, generation },
    {
      kind: "baseline-commit",
      scope,
      generation,
      via: "zerops-read",
      members: [ownerId],
      rows: [row],
    },
    event(scope, { kind: "baseline-committed" }),
  ];
};
const failed = (scope: ScopeKey, outcome: StreamOutcome): AccountInput =>
  event(scope, { kind: "fault", jitter: 0, fault: { outcome, message: outcome } });
const revalidating = (scope: ScopeKey) => event(scope, { kind: "revalidate" });

const MEMBERS = membersScope(ORG);
const ANNA = { id: "cu1", user: { id: "u1", fullName: "Anna" } };

describe("a sampled read, as a screen reads it", () => {
  it.each<{
    readonly name: string;
    readonly inputs: ReadonlyArray<AccountInput>;
    readonly expected: SampledRead<ReadonlyArray<unknown>>;
  }>([
    {
      name: "nothing demanded: loading, no value",
      inputs: [],
      expected: { value: undefined, status: "loading", settled: false, refused: false },
    },
    {
      name: "being read the first time: loading",
      inputs: begun(MEMBERS),
      expected: { value: undefined, status: "loading", settled: false, refused: false },
    },
    {
      name: "answered: ready and settled",
      inputs: [...begun(MEMBERS), ...answered(MEMBERS, "organizationMembers", [ANNA])],
      expected: { value: [ANNA], status: "ready", settled: true, refused: false },
    },
    {
      name: "read again on its cadence: its value shown, not settled",
      inputs: [
        ...begun(MEMBERS),
        ...answered(MEMBERS, "organizationMembers", [ANNA]),
        revalidating(MEMBERS),
      ],
      expected: { value: [ANNA], status: "ready", settled: false, refused: false },
    },
    {
      name: "its read lost on the way, nothing read: failed, retried",
      inputs: [...begun(MEMBERS), failed(MEMBERS, "transient")],
      expected: { value: undefined, status: "failed", settled: false, refused: false },
    },
    {
      name: "a revalidation lost on the way: the value stays, not settled",
      inputs: [
        ...begun(MEMBERS),
        ...answered(MEMBERS, "organizationMembers", [ANNA]),
        revalidating(MEMBERS),
        failed(MEMBERS, "transient"),
      ],
      expected: { value: [ANNA], status: "ready", settled: false, refused: false },
    },
    {
      name: "refused by its owner: failed for good",
      inputs: [...begun(MEMBERS), failed(MEMBERS, "authoritative-denial")],
      expected: { value: undefined, status: "failed", settled: false, refused: true },
    },
  ])("$name", ({ inputs, expected }) => {
    const reads = readsOfState(apply(emptyAccount, inputs));
    expect(organizationMembers.derive(reads, ORG)).toEqual(expected);
  });

  it("reads an organization's locations the same way, under their own scope", () => {
    const place = { id: "l1", name: "Prague", pingUrl: "https://ping" };
    const scope = locationsScope(ORG);
    const reads = readsOfState(
      apply(emptyAccount, [...begun(scope), ...answered(scope, "organizationLocations", [place])]),
    );
    expect(organizationLocations.derive(reads, ORG)).toMatchObject({
      value: [place],
      status: "ready",
    });
    expect(organizationMembers.derive(reads, ORG).status).toBe("loading");
  });

  it("answers each service's agents apart: read, failed, and not read yet", () => {
    const reads = readsOfState(
      apply(emptyAccount, [
        ...begun(agentsScope(ORG, "s1")),
        ...answered(agentsScope(ORG, "s1"), "serviceAgents", ["codex"]),
        ...begun(agentsScope(ORG, "s2")),
        failed(agentsScope(ORG, "s2"), "transient"),
      ]),
    );
    const agents = servicesAgents.derive(reads, { orgId: ORG, serviceIds: ["s1", "s2", "s3"] });
    expect(agents.s1).toMatchObject({ value: ["codex"], status: "ready" });
    expect(agents.s2).toMatchObject({ value: undefined, status: "failed" });
    expect(agents.s3).toMatchObject({ value: undefined, status: "loading" });
  });
});

describe("publicAccess", () => {
  const ROUTING = routingScope(ORG, "p1");
  const project = {
    id: "p1",
    zeropsSubdomainHost: "1a2b",
    publicZone: "fte2334ab.prg1-zerops.zone",
  };
  const web = {
    id: "web",
    projectId: "p1",
    name: "web",
    subdomainAccess: true,
    ports: [{ port: 3000, scheme: "http" }],
  };
  const api = { id: "api", projectId: "p1", name: "api", ports: [{ port: 8080, scheme: "http" }] };
  const routing = [
    {
      isSynced: true,
      sslEnabled: true,
      domains: [{ domainName: "example.com" }],
      locations: [{ path: "/", port: 3000, serviceStackId: "web" }],
    },
  ];
  const live = (inputs: ReadonlyArray<AccountInput>) =>
    readsOfState(
      apply(emptyAccount, [
        ...liveZerops({ running: [], projects: [project], services: [web, api] }),
        ...inputs,
      ]),
    );
  const derive = (inputs: ReadonlyArray<AccountInput>) =>
    publicAccess.derive(live(inputs), { orgId: ORG, projectId: "p1" });

  it("is read while its routing is: no address before it answers", () => {
    expect(derive(begun(ROUTING))).toEqual({
      state: "reading",
      denied: false,
      routes: [],
      offers: [],
    });
  });

  it("joins its project's subdomains, its services' offers and its routing's domains", () => {
    const access = derive([...begun(ROUTING), ...answered(ROUTING, "publicRouting", routing)]);
    expect(access.state).toBe("ready");
    expect(access.routes.map((route) => route.host)).toContain("example.com");
    expect(access.routes.length).toBeGreaterThan(1);
    expect(access.offers).toEqual([{ service: "api", serviceId: "api", port: 8080 }]);
  });

  it("keeps its addresses through a failed recheck, and says it failed", () => {
    const access = derive([
      ...begun(ROUTING),
      ...answered(ROUTING, "publicRouting", routing),
      revalidating(ROUTING),
      failed(ROUTING, "transient"),
    ]);
    expect(access.state).toBe("failed");
    expect(access.routes.map((route) => route.host)).toContain("example.com");
  });

  it.each<{ readonly outcome: StreamOutcome; readonly denied: boolean }>([
    { outcome: "authoritative-denial", denied: true },
    { outcome: "definitive-refusal", denied: false },
  ])("a routing its owner refuses ($outcome) fails; denied: $denied", ({ outcome, denied }) => {
    expect(derive([...begun(ROUTING), failed(ROUTING, outcome)])).toMatchObject({
      state: "failed",
      denied,
      routes: [],
    });
  });
});
