import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import { AtomRegistry } from "effect/unstable/reactivity";

import type { ZeropsLocation } from "../api.ts";
import { settledValue } from "./cellSelectors.ts";
import {
  makeZeropsCells,
  CELL_FRESH_MS,
  zeropsCellKeyOf,
  type MembersCellRequest,
  type TokensCellRequest,
  type LocationsCellRequest,
  type AgentsCellRequest,
  type ZeropsCellAdapter,
  type ZeropsCellReadContext,
  type ZeropsCellSourceError,
  type ZeropsCellRequest,
  type ZeropsCells,
} from "./cells.ts";
import {
  AccountEpoch,
  makeZeropsApiOrigin,
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  ZeropsServiceId,
  type AccountScope,
  type AccessState,
  type OrganizationRef,
  type ProjectRef,
  type ServiceRef,
} from "./types.ts";

const accountScope = (
  accountId = "account-a",
  epoch = 1,
  apiOrigin = "https://api.example.test",
): AccountScope => ({
  account: {
    apiOrigin: makeZeropsApiOrigin(apiOrigin),
    accountId: ZeropsAccountId.make(accountId),
  },
  epoch: AccountEpoch.make(epoch),
});

const organization = (scope: AccountScope, id = "org-a"): OrganizationRef => ({
  kind: "organization",
  account: scope.account,
  organizationId: ZeropsOrganizationId.make(id),
});

const project = (scope: AccountScope, projectId = "project-a", orgId = "org-a"): ProjectRef => ({
  kind: "project",
  organization: organization(scope, orgId),
  projectId: ZeropsProjectId.make(projectId),
});

const service = (
  scope: AccountScope,
  serviceId = "service-a",
  projectId = "project-a",
  orgId = "org-a",
): ServiceRef => ({
  kind: "service",
  project: project(scope, projectId, orgId),
  serviceId: ZeropsServiceId.make(serviceId),
});

const locationsRequest = (scope: AccountScope, orgId = "org-a"): LocationsCellRequest => ({
  kind: "locations",
  account: scope,
  organization: organization(scope, orgId),
});

const authorizedAgentsRequest = (
  scope: AccountScope,
  serviceId = "service-a",
  projectId = "project-a",
): AgentsCellRequest => ({
  kind: "agents",
  account: scope,
  service: service(scope, serviceId, projectId),
});

const tokenGrantsRequest = (scope: AccountScope): TokensCellRequest => ({
  kind: "tokens",
  account: scope,
  organization: organization(scope),
});

const membersRequest = (scope: AccountScope): MembersCellRequest => ({
  kind: "members",
  account: scope,
  organization: organization(scope),
});

const unusedAdapter = (overrides: Partial<ZeropsCellAdapter> = {}): ZeropsCellAdapter => ({
  readProjectPublicAccess: () => Effect.never,
  readOrganizationLocations: () => Effect.succeed([]),
  readOrganizationMembers: () => Effect.succeed([]),
  readServiceAuthorizedAgents: () => Effect.succeed([]),
  readServiceMateFlag: () => Effect.succeed({ enabled: "unknown" }),
  readOrganizationIntegrationTokenGrants: () => Effect.succeed([]),
  ...overrides,
});

const verifiedAccess = (
  scope: AccountScope,
  deadlineMs = Number.MAX_SAFE_INTEGER,
): Extract<AccessState, { readonly status: "verified" }> => ({
  status: "verified",
  account: scope.account,
  accountEpoch: scope.epoch,
  verifiedAtMs: 0,
  deadlineMs,
  mutationsAllowed: true,
  organizations: [{ organization: organization(scope), mutationsAllowed: true }],
  projects: [{ project: project(scope), role: "OWNER", mutationsAllowed: true }],
});

const MINUTE_MS = 60_000;
const PRAGUE: ZeropsLocation = { id: "prg1", name: "Prague", pingUrl: "https://ping.test" };

const expiredAccess = (scope: AccountScope, deadlineMs: number): AccessState => ({
  status: "expired",
  accountEpoch: scope.epoch,
  expiredAtMs: deadlineMs,
  previous: verifiedAccess(scope, deadlineMs),
});

const transportFailure = (retryable = true): ZeropsCellSourceError => ({
  _tag: "ZeropsCellSourceError",
  kind: "transport",
  retryable,
});

describe("zeropsCellKeyOf", () => {
  // A runtime's cells are one account epoch's: a request from any other is refused, never keyed.
  it.each([
    ["an organization's locations", locationsRequest(accountScope()), "locations:org-a"],
    ["an organization's tokens", tokenGrantsRequest(accountScope()), "tokens:org-a"],
    ["an organization's members", membersRequest(accountScope()), "members:org-a"],
    ["a service's agents", authorizedAgentsRequest(accountScope()), "agents:service-a"],
    [
      "another service's agents",
      authorizedAgentsRequest(accountScope(), "service-b"),
      "agents:service-b",
    ],
  ] as const)("keys %s by what it is of", (_, request, key) => {
    expect(zeropsCellKeyOf(request)).toBe(key);
  });
});

describe("makeZeropsCells", () => {
  it.effect("lapse → withheld → grant → re-read without remount", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      let access: AccessState = verifiedAccess(scope, 15 * MINUTE_MS);
      const gates: Array<Deferred.Deferred<void>> = [];
      const broker = yield* makeZeropsCells({
        scope,
        access: () => access,
        adapter: unusedAdapter({
          readOrganizationLocations: () =>
            Effect.gen(function* () {
              const gate = yield* Deferred.make<void>();
              gates.push(gate);
              yield* Deferred.await(gate);
              return [PRAGUE];
            }),
        }),
      });
      const registry = AtomRegistry.make();
      const atom = broker.known(locationsRequest(scope));
      const unmount = registry.mount(atom);
      yield* Effect.yieldNow;
      yield* Deferred.succeed(gates[0]!, undefined);
      yield* Effect.yieldNow;
      expect(registry.get(atom)).toMatchObject({ state: "known", value: [PRAGUE] });

      access = expiredAccess(scope, 15 * MINUTE_MS);
      yield* broker.reconcileAccess;
      expect(registry.get(atom)).toEqual({
        state: "withheld",
        reason: "access-lapsed",
        cause: null,
      });

      // The next grant covers the scope: the same mounted atom reads again, and
      // the erased value never comes back on its own.
      access = verifiedAccess(scope, 30 * MINUTE_MS);
      yield* broker.reconcileAccess;
      yield* Effect.yieldNow;
      expect(gates).toHaveLength(2);
      expect(registry.get(atom)).toMatchObject({ state: "reading" });
      yield* Deferred.succeed(gates[1]!, undefined);
      yield* Effect.yieldNow;
      expect(registry.get(atom)).toMatchObject({ state: "known", value: [PRAGUE] });

      unmount();
      registry.dispose();
      yield* broker.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("a failed lease stays failed until one manual Read again", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const outcomes: Array<"fail" | "answer"> = ["fail", "fail", "answer"];
      let reads = 0;
      const broker = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        adapter: unusedAdapter({
          readOrganizationLocations: () =>
            Effect.suspend(() => {
              reads += 1;
              return outcomes[reads - 1] === "answer"
                ? Effect.succeed([PRAGUE])
                : Effect.fail(transportFailure());
            }),
        }),
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* broker.acquire(locationsRequest(scope)).pipe(Scope.provide(leaseScope));

      expect(yield* lease.awaitSettled).toMatchObject({
        state: "failed",
        attempt: 1,
        retryAtMs: null,
      });
      yield* TestClock.adjust("2 seconds");
      yield* Effect.yieldNow;
      expect(reads).toBe(1);
      expect(yield* lease.retry).toBe(true);
      yield* lease.awaitSettled;
      expect(yield* lease.snapshot).toMatchObject({
        state: "failed",
        attempt: 2,
        retryAtMs: null,
      });
      yield* TestClock.adjust("4 seconds");
      yield* Effect.yieldNow;
      expect(reads).toBe(2);
      expect(yield* lease.retry).toBe(true);
      yield* lease.awaitSettled;
      expect(yield* lease.snapshot).toMatchObject({ state: "known", value: [PRAGUE] });

      // An answered read has nothing left to retry.
      expect(yield* lease.retry).toBe(false);
      yield* TestClock.adjust("1 minute");
      yield* Effect.yieldNow;
      expect(reads).toBe(3);
      yield* Scope.close(leaseScope, Exit.void);
      yield* broker.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );

  // The token and member lists are each one heavy answer the platform may sit on: a read with no
  // deadline held its cell reading for as long as the platform did, with nothing retried.
  it.effect.each([["tokens", tokenGrantsRequest] as const, ["members", membersRequest] as const])(
    "a %s read the platform sits on fails at 30 s and stays failed until Read again",
    ([kind, request]) =>
      Effect.gen(function* () {
        const scope = accountScope();
        const signals: AbortSignal[] = [];
        const never = (_input: unknown, context: ZeropsCellReadContext) =>
          Effect.suspend(() => {
            signals.push(context.abortSignal);
            return Effect.never;
          });
        const broker = yield* makeZeropsCells({
          scope,
          access: () => verifiedAccess(scope),
          adapter: unusedAdapter(
            kind === "tokens"
              ? { readOrganizationIntegrationTokenGrants: never }
              : { readOrganizationMembers: never },
          ),
        });
        const leaseScope = yield* Scope.make();
        const lease = yield* broker.acquire(request(scope)).pipe(Scope.provide(leaseScope));
        yield* Effect.yieldNow;
        expect(yield* lease.snapshot).toMatchObject({ state: "reading" });

        yield* TestClock.adjust("30 seconds");
        yield* Effect.yieldNow;
        expect(yield* lease.snapshot).toMatchObject({
          state: "failed",
          failure: { kind: "transport" },
          attempt: 1,
          retryAtMs: null,
        });
        expect(signals[0]?.aborted).toBe(true);
        yield* TestClock.adjust("2 seconds");
        yield* Effect.yieldNow;
        expect(signals).toHaveLength(1);
        expect(yield* lease.retry).toBe(true);
        yield* Effect.yieldNow;
        expect(signals).toHaveLength(2);
        yield* Scope.close(leaseScope, Exit.void);
        yield* broker.shutdown;
      }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("an idle lease retains its value for the retention window", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      let reads = 0;
      // Every read after the first waits for the test to let it answer.
      const gates = [yield* Deferred.make<void>(), yield* Deferred.make<void>()];
      const broker = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        adapter: unusedAdapter({
          readOrganizationLocations: () =>
            Effect.gen(function* () {
              reads += 1;
              const name = `Prague ${reads}`;
              if (reads > 1) yield* Deferred.await(gates[reads - 2]!);
              return [{ ...PRAGUE, name }];
            }),
        }),
      });
      const request = locationsRequest(scope);
      const firstScope = yield* Scope.make();
      const first = yield* broker.acquire(request).pipe(Scope.provide(firstScope));
      expect(yield* first.awaitSettled).toMatchObject({ state: "known" });
      yield* Scope.close(firstScope, Exit.void);
      expect(yield* broker.diagnostics).toMatchObject({ entries: 1, leases: 0, known: 1 });

      // A demand inside the window shows the retained value at once, and reads again under it.
      yield* TestClock.adjust(10 * MINUTE_MS - 1);
      yield* Effect.yieldNow;
      const secondScope = yield* Scope.make();
      const second = yield* broker.acquire(request).pipe(Scope.provide(secondScope));
      expect(yield* second.snapshot).toMatchObject({
        state: "known",
        value: [{ name: "Prague 1" }],
        freshness: { kind: "revalidating" },
      });
      yield* Deferred.succeed(gates[0]!, undefined);
      expect(yield* second.awaitSettled).toMatchObject({
        state: "known",
        value: [{ name: "Prague 2" }],
        freshness: { kind: "settled" },
      });
      yield* Scope.close(secondScope, Exit.void);

      // The window restarts at the last release; past it the entry is gone.
      yield* TestClock.adjust(10 * MINUTE_MS - 1);
      yield* Effect.yieldNow;
      expect(yield* broker.diagnostics).toMatchObject({ entries: 1 });
      yield* TestClock.adjust(1);
      yield* Effect.yieldNow;
      expect(yield* broker.diagnostics).toMatchObject({ entries: 0 });
      const thirdScope = yield* Scope.make();
      const third = yield* broker.acquire(request).pipe(Scope.provide(thirdScope));
      expect(yield* third.snapshot).toMatchObject({ state: "reading", attempt: 1 });
      yield* Deferred.succeed(gates[1]!, undefined);
      expect(yield* third.awaitSettled).toMatchObject({ value: [{ name: "Prague 3" }] });
      expect(reads).toBe(3);
      yield* Scope.close(thirdScope, Exit.void);
      yield* broker.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("a demand inside its kind's freshness reads nothing, and past it reads again", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      let reads = 0;
      const broker = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        adapter: unusedAdapter({
          readOrganizationMembers: () =>
            Effect.sync(() => {
              reads += 1;
              return [{ id: `member-${reads}` }];
            }),
        }),
      });
      const request = membersRequest(scope);
      const demand = Effect.gen(function* () {
        const held = yield* Scope.make();
        const lease = yield* broker.acquire(request).pipe(Scope.provide(held));
        const settled = yield* lease.awaitSettled;
        yield* Scope.close(held, Exit.void);
        return settled;
      });
      expect(yield* demand).toMatchObject({ state: "known", value: [{ id: "member-1" }] });
      yield* TestClock.adjust(CELL_FRESH_MS["members"] - 1);
      expect(yield* demand).toMatchObject({ state: "known", value: [{ id: "member-1" }] });
      expect(reads).toBe(1);
      yield* TestClock.adjust(1);
      expect(yield* demand).toMatchObject({ state: "known", value: [{ id: "member-2" }] });
      expect(reads).toBe(2);
      yield* broker.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect(
    "an invalidation re-reads a demanded resource, and an idle one on its next demand",
    () =>
      Effect.gen(function* () {
        const scope = accountScope();
        let reads = 0;
        const broker = yield* makeZeropsCells({
          scope,
          access: () => verifiedAccess(scope),
          adapter: unusedAdapter({
            readOrganizationIntegrationTokenGrants: () =>
              Effect.sync(() => {
                reads += 1;
                return [{ tokenId: `token-${reads}`, name: "t", grants: [] }];
              }),
          }),
        });
        const request = tokenGrantsRequest(scope);
        const held = yield* Scope.make();
        const lease = yield* broker.acquire(request).pipe(Scope.provide(held));
        yield* lease.awaitSettled;

        yield* broker.invalidate(request);
        expect(yield* lease.awaitSettled).toMatchObject({ value: [{ tokenId: "token-2" }] });
        expect(reads).toBe(2);

        yield* Scope.close(held, Exit.void);
        yield* broker.invalidate(request);
        expect(reads).toBe(2);
        const again = yield* Scope.make();
        const next = yield* broker.acquire(request).pipe(Scope.provide(again));
        expect(yield* next.awaitSettled).toMatchObject({ value: [{ tokenId: "token-3" }] });
        yield* Scope.close(again, Exit.void);
        yield* broker.shutdown;
      }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("a lapse erases a value retained with no demand", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      let access: AccessState = verifiedAccess(scope, 15 * MINUTE_MS);
      const broker = yield* makeZeropsCells({
        scope,
        access: () => access,
        adapter: unusedAdapter({ readOrganizationLocations: () => Effect.succeed([PRAGUE]) }),
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* broker.acquire(locationsRequest(scope)).pipe(Scope.provide(leaseScope));
      expect((yield* lease.awaitSettled).state).toBe("known");
      yield* Scope.close(leaseScope, Exit.void);
      expect(yield* broker.diagnostics).toMatchObject({ entries: 1, known: 1 });

      access = expiredAccess(scope, 15 * MINUTE_MS);
      yield* broker.reconcileAccess;

      expect(yield* broker.diagnostics).toMatchObject({ entries: 0, known: 0 });
      yield* broker.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("a non-retryable failure waits for a user retry", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      let reads = 0;
      const broker = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        adapter: unusedAdapter({
          readOrganizationLocations: () =>
            Effect.suspend(() => {
              reads += 1;
              return Effect.fail(transportFailure(false));
            }),
        }),
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* broker.acquire(locationsRequest(scope)).pipe(Scope.provide(leaseScope));

      expect(yield* lease.awaitSettled).toMatchObject({ state: "failed", retryAtMs: null });
      yield* TestClock.adjust("10 minutes");
      yield* Effect.yieldNow;
      expect(reads).toBe(1);
      yield* Scope.close(leaseScope, Exit.void);
      yield* broker.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("a grant that stops covering one project withholds only that project's resources", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const both: AccessState = {
        ...verifiedAccess(scope),
        projects: [
          { project: project(scope), role: "OWNER", mutationsAllowed: true },
          { project: project(scope, "project-b"), role: "OWNER", mutationsAllowed: true },
        ],
      };
      let access: AccessState = both;
      let reads = 0;
      const broker = yield* makeZeropsCells({
        scope,
        access: () => access,
        adapter: unusedAdapter({
          readServiceAuthorizedAgents: () =>
            Effect.sync(() => {
              reads += 1;
              return ["codex"] as const;
            }),
        }),
      });
      const registry = AtomRegistry.make();
      const kept = broker.known(authorizedAgentsRequest(scope, "service-a", "project-a"));
      const lost = broker.known(authorizedAgentsRequest(scope, "service-b", "project-b"));
      const locations = broker.known(locationsRequest(scope));
      const unmounts = [registry.mount(kept), registry.mount(lost), registry.mount(locations)];
      yield* Effect.yieldNow;

      access = verifiedAccess(scope);
      yield* broker.reconcileAccess;

      expect(registry.get(kept)).toMatchObject({ state: "known", value: ["codex"] });
      expect(registry.get(locations)).toMatchObject({ state: "known" });
      expect(registry.get(lost)).toEqual({
        state: "withheld",
        reason: "access-denied",
        cause: null,
      });
      expect(reads).toBe(2);

      access = both;
      yield* broker.reconcileAccess;
      yield* Effect.yieldNow;
      expect(registry.get(lost)).toMatchObject({ state: "known", value: ["codex"] });
      expect(reads).toBe(3);

      for (const unmount of unmounts) unmount();
      registry.dispose();
      yield* broker.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("a denial scoped to one project withholds only that project's resources", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const both: Extract<AccessState, { readonly status: "verified" }> = {
        ...verifiedAccess(scope),
        projects: [
          { project: project(scope), role: "OWNER", mutationsAllowed: true },
          { project: project(scope, "project-b"), role: "OWNER", mutationsAllowed: true },
        ],
      };
      let access: AccessState = both;
      let reads = 0;
      const broker = yield* makeZeropsCells({
        scope,
        access: () => access,
        adapter: unusedAdapter({
          readServiceAuthorizedAgents: () =>
            Effect.sync(() => {
              reads += 1;
              return ["codex"] as const;
            }),
        }),
      });
      const registry = AtomRegistry.make();
      const kept = broker.known(authorizedAgentsRequest(scope, "service-a", "project-a"));
      const lost = broker.known(authorizedAgentsRequest(scope, "service-b", "project-b"));
      const locations = broker.known(locationsRequest(scope));
      const unmounts = [registry.mount(kept), registry.mount(lost), registry.mount(locations)];
      yield* Effect.yieldNow;

      const { status: _status, ...previous } = both;
      access = {
        status: "denied",
        accountEpoch: scope.epoch,
        scope: { kind: "project", project: project(scope, "project-b") },
        deniedAtMs: 1,
        previous,
      };
      yield* broker.reconcileAccess;

      expect(registry.get(kept)).toMatchObject({ state: "known", value: ["codex"] });
      expect(registry.get(locations)).toMatchObject({ state: "known" });
      expect(registry.get(lost)).toEqual({
        state: "withheld",
        reason: "access-denied",
        cause: null,
      });
      expect(reads).toBe(2);

      // With no earlier grant to stand on, nothing outside the project is admitted either.
      access = { ...access, previous: null };
      yield* broker.reconcileAccess;
      expect(registry.get(kept)).toMatchObject({ state: "withheld", reason: "access-unverified" });

      for (const unmount of unmounts) unmount();
      registry.dispose();
      yield* broker.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("shares one in-flight read while each lease has an independent release fence", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const started = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      let calls = 0;
      let signal: AbortSignal | undefined;
      const broker = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        adapter: unusedAdapter({
          readOrganizationLocations: (_request, context) =>
            Effect.sync(() => {
              calls += 1;
              signal = context.abortSignal;
            }).pipe(
              Effect.andThen(Deferred.succeed(started, undefined)),
              Effect.andThen(Deferred.await(finish)),
              Effect.as([PRAGUE]),
            ),
        }),
      });
      const firstScope = yield* Scope.make();
      const secondScope = yield* Scope.make();
      const request = locationsRequest(scope);
      const first = yield* broker.acquire(request).pipe(Scope.provide(firstScope));
      const second = yield* broker.acquire(request).pipe(Scope.provide(secondScope));
      yield* Deferred.await(started);

      expect(calls).toBe(1);
      expect(yield* first.snapshot).toMatchObject({ state: "reading", attempt: 1 });
      expect((yield* broker.diagnostics).leases).toBe(2);
      yield* first.release;
      expect(yield* first.snapshot).toEqual({ state: "unread", waitingFor: null });
      expect(signal?.aborted).toBe(false);
      yield* Deferred.succeed(finish, undefined);
      expect(yield* second.awaitSettled).toMatchObject({
        state: "known",
        value: [PRAGUE],
        coverage: "complete",
        freshness: { kind: "settled" },
      });
      yield* Scope.close(firstScope, Exit.void);
      yield* Scope.close(secondScope, Exit.void);
      yield* broker.shutdown;
    }),
  );

  it.effect("releasing a lease interrupts a wait for its settled state", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const broker = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        adapter: unusedAdapter({ readOrganizationLocations: () => Effect.never }),
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* broker.acquire(locationsRequest(scope)).pipe(Scope.provide(leaseScope));
      const waiting = yield* Effect.forkChild(lease.awaitSettled);
      yield* Effect.yieldNow;

      yield* lease.release;
      yield* Effect.yieldNow;

      const exit = waiting.pollUnsafe();
      expect(exit !== undefined && Exit.hasInterrupts(exit)).toBe(true);
      yield* Scope.close(leaseScope, Exit.void);
      yield* broker.shutdown;
    }),
  );

  it.effect("routes every named resource through its restricted adapter result", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const calls: Array<string> = [];
      const broker = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        adapter: unusedAdapter({
          readOrganizationLocations: () => {
            calls.push("locations");
            return Effect.succeed([PRAGUE]);
          },
          readServiceAuthorizedAgents: () => {
            calls.push("agents");
            return Effect.succeed(["codex"]);
          },
          readOrganizationIntegrationTokenGrants: () => {
            calls.push("grants");
            return Effect.succeed([
              {
                tokenId: "token-id",
                name: "zcp-project",
                grants: [{ projectId: "project-a", roleCode: "ADMIN" }],
              },
            ]);
          },
        }),
      });
      const requests = [
        locationsRequest(scope),
        authorizedAgentsRequest(scope),
        tokenGrantsRequest(scope),
      ] as const;
      const scopes = yield* Effect.forEach(requests, () => Scope.make());
      const leases = yield* Effect.forEach(requests, (request, index) =>
        broker.acquire(request).pipe(Scope.provide(scopes[index]!)),
      );
      yield* Effect.forEach(leases, (lease) => lease.awaitSettled, { concurrency: "unbounded" });

      expect(calls.sort()).toEqual(["agents", "grants", "locations"]);
      const agents = yield* leases[1]!.snapshot;
      expect(agents.state === "known" ? agents.value : null).toEqual(["codex"]);
      const grants = yield* leases[2]!.snapshot;
      expect(grants.state === "known" ? grants.value : null).toEqual([
        {
          tokenId: "token-id",
          name: "zcp-project",
          grants: [{ projectId: "project-a", roleCode: "ADMIN" }],
        },
      ]);
      const diagnostics = yield* broker.diagnostics;
      expect(diagnostics).toMatchObject({ entries: 3, known: 3 });
      expect(diagnostics).not.toHaveProperty("value");
      expect(diagnostics).not.toHaveProperty("error");
      yield* broker.shutdown;
      yield* Effect.forEach(scopes, (leaseScope) => Scope.close(leaseScope, Exit.void), {
        discard: true,
      });
    }),
  );

  it.effect("retains an adapter-owned value without normalizing its nested data", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const value: ReadonlyArray<ZeropsLocation> = [PRAGUE];
      const broker = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        adapter: unusedAdapter({ readOrganizationLocations: () => Effect.succeed(value) }),
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* broker.acquire(locationsRequest(scope)).pipe(Scope.provide(leaseScope));
      const loaded = yield* lease.awaitSettled;

      expect(loaded.state === "known" ? loaded.value : null).toBe(value);
      expect(loaded.state === "known" ? loaded.value[0] : null).toBe(value[0]);
      yield* Scope.close(leaseScope, Exit.void);
      yield* broker.shutdown;
    }),
  );

  it.effect("rejects a stale epoch or mismatched nested account before adapter I/O", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      let calls = 0;
      const broker = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        adapter: unusedAdapter({
          readOrganizationLocations: () => {
            calls += 1;
            return Effect.succeed([]);
          },
        }),
      });
      const leaseScope = yield* Scope.make();
      const stale = yield* broker
        .acquire(locationsRequest(accountScope("account-a", 2)))
        .pipe(Scope.provide(leaseScope), Effect.result);
      const mismatched = yield* broker
        .acquire({
          ...locationsRequest(scope),
          organization: organization(accountScope("account-b")),
        })
        .pipe(Scope.provide(leaseScope), Effect.result);
      const registry = AtomRegistry.make();
      const refused = broker.known(locationsRequest(accountScope("account-a", 2)));
      const unmount = registry.mount(refused);

      expect(stale).toMatchObject({ _tag: "Failure", failure: { reason: "account-mismatch" } });
      expect(mismatched).toMatchObject({
        _tag: "Failure",
        failure: { reason: "account-mismatch" },
      });
      expect(registry.get(refused)).toEqual({ state: "unread", waitingFor: "zerops-session" });
      expect(calls).toBe(0);
      unmount();
      registry.dispose();
      yield* Scope.close(leaseScope, Exit.void);
      yield* broker.shutdown;
    }),
  );

  it.effect(
    "withholds a resource outside the grant's organization or project without reading it",
    () =>
      Effect.gen(function* () {
        const scope = accountScope();
        let calls = 0;
        const broker = yield* makeZeropsCells({
          scope,
          access: () => verifiedAccess(scope),
          adapter: unusedAdapter({
            readServiceAuthorizedAgents: () => {
              calls += 1;
              return Effect.succeed([]);
            },
          }),
        });
        const leaseScope = yield* Scope.make();
        const denied = yield* broker
          .acquire(authorizedAgentsRequest(scope, "service-a", "not-granted"))
          .pipe(Scope.provide(leaseScope));

        expect(yield* denied.awaitSettled).toEqual({
          state: "withheld",
          reason: "access-denied",
          cause: null,
        });
        expect(calls).toBe(0);
        yield* Scope.close(leaseScope, Exit.void);
        yield* broker.shutdown;
      }),
  );

  it.effect(
    "erases a held value and aborts its read when access is revoked, keeping the demand",
    () =>
      Effect.gen(function* () {
        const scope = accountScope();
        let access: AccessState = verifiedAccess(scope);
        const signals: Array<AbortSignal> = [];
        const broker = yield* makeZeropsCells({
          scope,
          access: () => access,
          adapter: unusedAdapter({
            readOrganizationLocations: (_request, context) => {
              signals.push(context.abortSignal);
              return signals.length === 1 ? Effect.succeed([PRAGUE]) : Effect.never;
            },
          }),
        });
        const leaseScope = yield* Scope.make();
        const lease = yield* broker
          .acquire(locationsRequest(scope))
          .pipe(Scope.provide(leaseScope));
        expect((yield* lease.awaitSettled).state).toBe("known");
        expect(yield* lease.retry).toBe(false);

        access = {
          status: "denied",
          accountEpoch: scope.epoch,
          scope: { kind: "account", account: scope.account },
          deniedAtMs: 1,
          previous: verifiedAccess(scope),
        };
        yield* broker.reconcileAccess;

        expect(yield* lease.snapshot).toEqual({
          state: "withheld",
          reason: "access-denied",
          cause: null,
        });
        expect(yield* broker.diagnostics).toMatchObject({ entries: 1, leases: 1, withheld: 1 });

        // A grant starts a read; a revocation while it runs aborts it.
        access = verifiedAccess(scope);
        yield* broker.reconcileAccess;
        yield* Effect.yieldNow;
        expect(yield* lease.snapshot).toMatchObject({ state: "reading" });
        access = {
          status: "denied",
          accountEpoch: scope.epoch,
          scope: { kind: "account", account: scope.account },
          deniedAtMs: 2,
          previous: verifiedAccess(scope),
        };
        yield* broker.reconcileAccess;
        expect(signals.map((signal) => signal.aborted)).toEqual([false, true]);
        expect((yield* lease.snapshot).state).toBe("withheld");
        yield* Scope.close(leaseScope, Exit.void);
        yield* broker.shutdown;
      }),
  );

  it.effect("withholds retained resources at the absolute access deadline", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const broker = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope, 10),
        adapter: unusedAdapter({
          readOrganizationLocations: () => Effect.succeed([PRAGUE]),
        }),
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* broker.acquire(locationsRequest(scope)).pipe(Scope.provide(leaseScope));
      expect((yield* lease.awaitSettled).state).toBe("known");

      yield* TestClock.adjust("10 millis");
      yield* Effect.yieldNow;

      expect(yield* lease.snapshot).toEqual({
        state: "withheld",
        reason: "access-lapsed",
        cause: null,
      });
      expect(yield* broker.diagnostics).toMatchObject({ entries: 1, known: 0, withheld: 1 });
      yield* Scope.close(leaseScope, Exit.void);
      expect(yield* broker.diagnostics).toMatchObject({ entries: 0 });
      yield* broker.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("rejects late completion after the final lease releases", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const started = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      let signal: AbortSignal | undefined;
      const broker = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        adapter: unusedAdapter({
          readServiceAuthorizedAgents: (_request, context) => {
            signal = context.abortSignal;
            return Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(finish)),
              Effect.as(["codex"] as const),
            );
          },
        }),
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* broker
        .acquire(authorizedAgentsRequest(scope))
        .pipe(Scope.provide(leaseScope));
      yield* Deferred.await(started);
      yield* lease.release;
      expect(signal?.aborted).toBe(true);
      yield* Deferred.succeed(finish, undefined);
      yield* Effect.yieldNow;
      expect(yield* lease.snapshot).toEqual({ state: "unread", waitingFor: null });
      expect(yield* broker.diagnostics).toMatchObject({ entries: 0, leases: 0 });
      yield* Scope.close(leaseScope, Exit.void);
      yield* broker.shutdown;
    }),
  );

  it.effect("publishes a sanitized failure and shares one explicit retry", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      let calls = 0;
      // Both leases join the first read while it is out, so both hear it fail.
      const gate = yield* Deferred.make<void>();
      const broker = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        adapter: unusedAdapter({
          readOrganizationLocations: () => {
            calls += 1;
            return calls === 1
              ? Deferred.await(gate).pipe(
                  Effect.andThen(
                    Effect.fail({
                      ...transportFailure(false),
                      message: "signed-url=do-not-publish",
                    }),
                  ),
                )
              : Effect.succeed([]);
          },
        }),
      });
      const firstScope = yield* Scope.make();
      const secondScope = yield* Scope.make();
      const request = locationsRequest(scope);
      const first = yield* broker.acquire(request).pipe(Scope.provide(firstScope));
      const second = yield* broker.acquire(request).pipe(Scope.provide(secondScope));
      yield* Deferred.succeed(gate, undefined);
      const failed = yield* first.awaitSettled;
      expect(failed).toMatchObject({
        state: "failed",
        failure: { kind: "transport", detail: "Zerops did not answer." },
        attempt: 1,
        retryAtMs: null,
      });
      expect(failed.state === "failed" && "message" in failed.failure).toBe(false);

      const retryResults = yield* Effect.all([first.retry, second.retry], {
        concurrency: "unbounded",
      });
      expect(retryResults.filter(Boolean)).toHaveLength(1);
      expect(yield* second.awaitSettled).toMatchObject({ state: "known", value: [] });
      expect(calls).toBe(2);
      yield* Scope.close(firstScope, Exit.void);
      yield* Scope.close(secondScope, Exit.void);
      yield* broker.shutdown;
    }),
  );

  it.effect("bounds distinct active resources while identical demand still shares", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const broker = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        maxEntries: 1,
        adapter: unusedAdapter(),
      });
      const firstScope = yield* Scope.make();
      const sharedScope = yield* Scope.make();
      const rejectedScope = yield* Scope.make();
      const first = yield* broker.acquire(locationsRequest(scope)).pipe(Scope.provide(firstScope));
      yield* broker.acquire(locationsRequest(scope)).pipe(Scope.provide(sharedScope));
      const queued = yield* broker
        .acquire(authorizedAgentsRequest(scope))
        .pipe(Scope.provide(rejectedScope));
      expect(yield* queued.snapshot).toEqual({ state: "unread", waitingFor: "data-slot" });
      expect(yield* broker.diagnostics).toMatchObject({ entries: 1, leases: 3, waiting: 1 });
      yield* first.release;
      expect(yield* queued.snapshot).toEqual({ state: "unread", waitingFor: "data-slot" });
      yield* Scope.close(sharedScope, Exit.void);
      expect((yield* queued.awaitSettled).state).toBe("known");
      yield* Scope.close(firstScope, Exit.void);
      yield* Scope.close(rejectedScope, Exit.void);
      yield* broker.shutdown;
    }),
  );

  it.effect("a resource waits for a data slot and reads once on capacity release", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const broker = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        maxEntries: 1,
        adapter: unusedAdapter({ readOrganizationLocations: () => Effect.succeed([PRAGUE]) }),
      });
      const holderScope = yield* Scope.make();
      yield* broker.acquire(authorizedAgentsRequest(scope)).pipe(Scope.provide(holderScope));
      const registry = AtomRegistry.make();
      const atom = broker.known(locationsRequest(scope));
      const unmount = registry.mount(atom);

      expect(registry.get(atom)).toMatchObject({
        state: "unread",
        waitingFor: "data-slot",
      });
      yield* TestClock.adjust("2 seconds");
      yield* Effect.yieldNow;
      expect(registry.get(atom)).toMatchObject({ state: "unread", waitingFor: "data-slot" });

      yield* Scope.close(holderScope, Exit.void);
      yield* Effect.yieldNow;
      expect(registry.get(atom)).toMatchObject({ state: "known", value: [PRAGUE] });

      unmount();
      registry.dispose();
      yield* broker.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("queued demand expires visibly and Read again makes one new admission attempt", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      let reads = 0;
      const broker = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        maxEntries: 1,
        adapter: unusedAdapter({
          readOrganizationLocations: () =>
            Effect.sync(() => {
              reads++;
              return [PRAGUE];
            }),
        }),
      });
      const holderScope = yield* Scope.make();
      yield* broker.acquire(authorizedAgentsRequest(scope)).pipe(Scope.provide(holderScope));
      const display = yield* Scope.make();
      const queued = yield* broker.acquire(locationsRequest(scope)).pipe(Scope.provide(display));
      expect(yield* queued.snapshot).toEqual({ state: "unread", waitingFor: "data-slot" });
      yield* TestClock.adjust("30 seconds");
      const failure = yield* queued.awaitSettled;
      expect(failure).toMatchObject({
        state: "failed",
        failure: { kind: "refused", code: "data-slot-deadline" },
        retryAtMs: null,
      });
      yield* Scope.close(holderScope, Exit.void);
      yield* Effect.yieldNow;
      expect(yield* queued.snapshot).toEqual(failure);
      expect(reads).toBe(0);
      expect(yield* queued.retry).toBe(true);
      expect(yield* queued.retry).toBe(false);
      expect(yield* queued.awaitSettled).toMatchObject({ state: "known", value: [PRAGUE] });
      expect(reads).toBe(1);
      yield* Scope.close(display, Exit.void);
      yield* broker.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("unmount cancels queued demand and a full queue refuses visibly", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      let reads = 0;
      const broker = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        maxEntries: 1,
        maxQueuedEntries: 1,
        adapter: unusedAdapter({
          readOrganizationLocations: () =>
            Effect.sync(() => {
              reads++;
              return [PRAGUE];
            }),
        }),
      });
      const holderScope = yield* Scope.make();
      yield* broker.acquire(authorizedAgentsRequest(scope)).pipe(Scope.provide(holderScope));
      const registry = AtomRegistry.make();
      const unmount = registry.mount(broker.known(locationsRequest(scope)));
      const rejected = yield* broker
        .acquire(membersRequest(scope))
        .pipe(Effect.scoped, Effect.result);
      expect(rejected).toMatchObject({ _tag: "Failure", failure: { reason: "account-capacity" } });
      unmount();
      registry.dispose();
      yield* Scope.close(holderScope, Exit.void);
      yield* Effect.yieldNow;
      expect(reads).toBe(0);
      expect(yield* broker.diagnostics).toMatchObject({ waiting: 0 });
      yield* broker.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect(
    "failed revalidation keeps its value and access reconciliation does not read again",
    () =>
      Effect.gen(function* () {
        const scope = accountScope();
        let reads = 0;
        const broker = yield* makeZeropsCells({
          scope,
          access: () => verifiedAccess(scope),
          adapter: unusedAdapter({
            readOrganizationMembers: () =>
              Effect.suspend(() =>
                ++reads === 1
                  ? Effect.succeed([{ id: "member-1" }])
                  : Effect.fail(transportFailure()),
              ),
          }),
        });
        const display = yield* Scope.make();
        const lease = yield* broker.acquire(membersRequest(scope)).pipe(Scope.provide(display));
        yield* lease.awaitSettled;
        yield* broker.invalidate(membersRequest(scope));
        const failed = yield* lease.awaitSettled;
        expect(failed).toMatchObject({
          state: "known",
          value: [{ id: "member-1" }],
          freshness: { kind: "stale", reason: { kind: "revalidation-failed", retryAtMs: null } },
        });
        yield* broker.reconcileAccess;
        yield* TestClock.adjust("1 minute");
        yield* broker.reconcileAccess;
        expect(reads).toBe(2);
        expect(yield* lease.snapshot).toEqual(failed);
        yield* broker.readAgain(membersRequest(scope));
        yield* lease.awaitSettled;
        expect(reads).toBe(3);
        yield* Scope.close(display, Exit.void);
        yield* broker.shutdown;
      }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("a full-queue atom stays refused after capacity release until Read again", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      let reads = 0;
      const broker = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        maxEntries: 1,
        maxQueuedEntries: 1,
        adapter: unusedAdapter({
          readOrganizationMembers: () =>
            Effect.sync(() => {
              reads++;
              return [{ id: "member-1" }];
            }),
        }),
      });
      const holderScope = yield* Scope.make();
      yield* broker.acquire(authorizedAgentsRequest(scope)).pipe(Scope.provide(holderScope));
      const queuedScope = yield* Scope.make();
      yield* broker.acquire(locationsRequest(scope)).pipe(Scope.provide(queuedScope));
      const registry = AtomRegistry.make();
      const atom = broker.known(membersRequest(scope));
      const unmount = registry.mount(atom);
      const failure = registry.get(atom);
      expect(failure).toMatchObject({
        state: "failed",
        failure: { code: "data-slot-queue-full" },
        retryAtMs: null,
      });
      yield* Scope.close(queuedScope, Exit.void);
      yield* Scope.close(holderScope, Exit.void);
      yield* Effect.yieldNow;
      expect(registry.get(atom)).toEqual(failure);
      expect(reads).toBe(0);
      expect(yield* broker.readAgain(membersRequest(scope))).toBe(true);
      yield* Effect.yieldNow;
      expect(registry.get(atom)).toMatchObject({ state: "known", value: [{ id: "member-1" }] });
      expect(reads).toBe(1);
      unmount();
      registry.dispose();
      yield* broker.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect(
    "queued keys share demand and start in order on releases, including a failed holder",
    () =>
      Effect.gen(function* () {
        const scope = accountScope();
        const reads: string[] = [];
        const broker = yield* makeZeropsCells({
          scope,
          access: () => verifiedAccess(scope),
          maxEntries: 1,
          adapter: unusedAdapter({
            readServiceAuthorizedAgents: () => Effect.fail(transportFailure()),
            readOrganizationLocations: () =>
              Effect.sync(() => {
                reads.push("locations");
                return [PRAGUE];
              }),
            readOrganizationMembers: () =>
              Effect.sync(() => {
                reads.push("members");
                return [{ id: "member-1" }];
              }),
          }),
        });
        const holderScope = yield* Scope.make();
        const holder = yield* broker
          .acquire(authorizedAgentsRequest(scope))
          .pipe(Scope.provide(holderScope));
        yield* holder.awaitSettled;
        const firstScope = yield* Scope.make();
        const secondScope = yield* Scope.make();
        const first = yield* broker
          .acquire(locationsRequest(scope))
          .pipe(Scope.provide(firstScope));
        const shared = yield* broker
          .acquire(locationsRequest(scope))
          .pipe(Scope.provide(firstScope));
        const second = yield* broker
          .acquire(membersRequest(scope))
          .pipe(Scope.provide(secondScope));
        expect(yield* broker.diagnostics).toMatchObject({ waiting: 2 });
        yield* Scope.close(holderScope, Exit.void);
        yield* first.awaitSettled;
        expect(yield* shared.snapshot).toMatchObject({ state: "known" });
        expect(reads).toEqual(["locations"]);
        expect(yield* second.snapshot).toMatchObject({ waitingFor: "data-slot" });
        yield* Scope.close(firstScope, Exit.void);
        yield* second.awaitSettled;
        expect(reads).toEqual(["locations", "members"]);
        yield* Scope.close(secondScope, Exit.void);
        yield* broker.shutdown;
      }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("queued access is withheld on revocation and a new grant resumes it once", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      let access: AccessState = verifiedAccess(scope);
      let reads = 0;
      const broker = yield* makeZeropsCells({
        scope,
        access: () => access,
        maxEntries: 1,
        adapter: unusedAdapter({
          readOrganizationLocations: () =>
            Effect.sync(() => {
              reads++;
              return [PRAGUE];
            }),
        }),
      });
      const holderScope = yield* Scope.make();
      yield* broker.acquire(authorizedAgentsRequest(scope)).pipe(Scope.provide(holderScope));
      const display = yield* Scope.make();
      const queued = yield* broker.acquire(locationsRequest(scope)).pipe(Scope.provide(display));
      access = expiredAccess(scope, 0);
      yield* broker.reconcileAccess;
      expect(yield* queued.snapshot).toMatchObject({ state: "withheld", reason: "access-lapsed" });
      yield* Scope.close(holderScope, Exit.void);
      yield* TestClock.adjust("1 minute");
      expect(reads).toBe(0);
      expect(yield* queued.snapshot).toMatchObject({ state: "withheld" });
      access = verifiedAccess(scope);
      yield* broker.reconcileAccess;
      yield* queued.awaitSettled;
      expect(reads).toBe(1);
      yield* Scope.close(display, Exit.void);
      yield* broker.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("a resource waiting for capacity waits for the Zerops session after shutdown", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const broker = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        maxEntries: 1,
        adapter: unusedAdapter(),
      });
      const holderScope = yield* Scope.make();
      yield* broker.acquire(authorizedAgentsRequest(scope)).pipe(Scope.provide(holderScope));
      const registry = AtomRegistry.make();
      const atom = broker.known(locationsRequest(scope));
      const unmount = registry.mount(atom);
      expect(registry.get(atom)).toMatchObject({ state: "unread", waitingFor: "data-slot" });

      yield* broker.shutdown;

      expect(registry.get(atom)).toEqual({ state: "unread", waitingFor: "zerops-session" });
      unmount();
      registry.dispose();
      yield* Scope.close(holderScope, Exit.void);
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("a closed broker shows every resource waiting for the Zerops session", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const broker = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        adapter: unusedAdapter({ readOrganizationLocations: () => Effect.succeed([PRAGUE]) }),
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* broker.acquire(locationsRequest(scope)).pipe(Scope.provide(leaseScope));
      const registry = AtomRegistry.make();
      const openAtom = broker.known(authorizedAgentsRequest(scope));
      const unmounts = [registry.mount(openAtom)];
      yield* Effect.yieldNow;

      yield* broker.shutdown;
      const lateAtom = broker.known(tokenGrantsRequest(scope));
      unmounts.push(registry.mount(lateAtom));
      const stale = broker.known(locationsRequest(accountScope("account-a", 2)));
      unmounts.push(registry.mount(stale));

      const closed = { state: "unread", waitingFor: "zerops-session" };
      expect(yield* lease.snapshot).toEqual(closed);
      expect(registry.get(openAtom)).toEqual(closed);
      expect(registry.get(lateAtom)).toEqual(closed);
      expect(registry.get(stale)).toEqual(closed);
      for (const unmount of unmounts) unmount();
      registry.dispose();
      yield* Scope.close(leaseScope, Exit.void);
    }),
  );

  it.effect("erases every value and aborts every read on an idempotent shutdown", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const signals: Array<AbortSignal> = [];
      const broker = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        adapter: unusedAdapter({
          readOrganizationLocations: (_request, context) => {
            signals.push(context.abortSignal);
            return Effect.succeed([{ id: "prg1", name: "erase-me", pingUrl: "https://ping.test" }]);
          },
          readServiceAuthorizedAgents: (_request, context) => {
            signals.push(context.abortSignal);
            return Effect.never;
          },
        }),
      });
      const recipeScope = yield* Scope.make();
      const cloneScope = yield* Scope.make();
      const recipe = yield* broker
        .acquire(locationsRequest(scope))
        .pipe(Scope.provide(recipeScope));
      const clone = yield* broker
        .acquire(authorizedAgentsRequest(scope))
        .pipe(Scope.provide(cloneScope));
      const loaded = yield* recipe.awaitSettled;
      expect(loaded.state === "known" ? loaded.value[0]?.name : undefined).toBe("erase-me");
      const cloneSettled = yield* Effect.forkChild(clone.awaitSettled);
      yield* Effect.yieldNow;

      yield* broker.shutdown;
      yield* broker.shutdown;
      expect(yield* recipe.snapshot).toEqual({ state: "unread", waitingFor: "zerops-session" });
      expect(yield* clone.snapshot).toEqual({ state: "unread", waitingFor: "zerops-session" });
      expect(Exit.hasInterrupts(yield* Fiber.await(cloneSettled))).toBe(true);
      expect(Exit.hasInterrupts(yield* Effect.exit(recipe.awaitSettled))).toBe(true);
      // The finished read has nothing left to abort; the one in flight is aborted.
      expect(signals.map((signal) => signal.aborted)).toEqual([false, true]);
      expect(yield* broker.diagnostics).toMatchObject({ entries: 0, leases: 0 });
      const afterCloseScope = yield* Scope.make();
      const afterClose = yield* broker
        .acquire(locationsRequest(scope))
        .pipe(Scope.provide(afterCloseScope), Effect.result);
      expect(afterClose).toMatchObject({
        _tag: "Failure",
        failure: { reason: "runtime-closed" },
      });
      yield* Scope.close(recipeScope, Exit.void);
      yield* Scope.close(cloneScope, Exit.void);
      yield* Scope.close(afterCloseScope, Exit.void);
    }),
  );
});

describe("the cells' one-shot reads", () => {
  /** A one-shot read: a lease held until the cell settles, then let go. */
  const oneShot = (cells: ZeropsCells, request: ZeropsCellRequest) =>
    Effect.gen(function* () {
      const held = yield* Scope.make();
      const lease = yield* cells.acquire(request).pipe(Scope.provide(held));
      const settled = yield* lease.awaitSettled;
      yield* Scope.close(held, Exit.void);
      return settled;
    });

  it.effect("a reader joining a held cell past its freshness reads it again", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      let reads = 0;
      const cells = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        adapter: unusedAdapter({
          readOrganizationMembers: () =>
            Effect.sync(() => {
              reads += 1;
              return [{ id: `member-${reads}` }];
            }),
        }),
      });
      const request = membersRequest(scope);
      // A surface holds the members all along.
      const display = yield* Scope.make();
      const held = yield* cells.acquire(request).pipe(Scope.provide(display));
      yield* held.awaitSettled;

      yield* TestClock.adjust(CELL_FRESH_MS["members"] - 1);
      expect(yield* oneShot(cells, request)).toMatchObject({ value: [{ id: "member-1" }] });
      expect(reads).toBe(1);
      yield* TestClock.adjust(1);
      expect(yield* oneShot(cells, request)).toMatchObject({
        value: [{ id: "member-2" }],
        freshness: { kind: "settled" },
      });
      expect(reads).toBe(2);
      yield* Scope.close(display, Exit.void);
      yield* cells.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("an invalidation that lands while the cell is first read reads it once more", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const gate = yield* Deferred.make<void>();
      let reads = 0;
      const cells = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        adapter: unusedAdapter({
          readOrganizationIntegrationTokenGrants: () =>
            Effect.suspend(() => {
              reads += 1;
              const answer = [{ tokenId: `token-${reads}`, name: "t", grants: [] }];
              return reads === 1
                ? Deferred.await(gate).pipe(Effect.as(answer))
                : Effect.succeed(answer);
            }),
        }),
      });
      const request = tokenGrantsRequest(scope);
      const held = yield* Scope.make();
      const lease = yield* cells.acquire(request).pipe(Scope.provide(held));
      expect(yield* lease.snapshot).toMatchObject({ state: "reading" });

      // Our own write lands while the first read is out: that read may predate it.
      yield* cells.invalidate(request);
      yield* Deferred.succeed(gate, undefined);

      expect(yield* lease.awaitSettled).toMatchObject({
        value: [{ tokenId: "token-2" }],
        freshness: { kind: "settled" },
      });
      expect(reads).toBe(2);
      yield* Scope.close(held, Exit.void);
      yield* cells.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("a reader of a cell being read again waits for the new value, never a rejection", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const gate = yield* Deferred.make<void>();
      let reads = 0;
      const cells = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        adapter: unusedAdapter({
          readOrganizationIntegrationTokenGrants: () =>
            Effect.suspend(() => {
              reads += 1;
              const answer = [{ tokenId: `token-${reads}`, name: "t", grants: [] }];
              return reads === 2
                ? Deferred.await(gate).pipe(Effect.as(answer))
                : Effect.succeed(answer);
            }),
        }),
      });
      const request = tokenGrantsRequest(scope);
      const display = yield* Scope.make();
      const held = yield* cells.acquire(request).pipe(Scope.provide(display));
      yield* held.awaitSettled;
      // Our write starts a re-read; a second write lands while that read is out.
      yield* cells.invalidate(request);
      const reader = yield* Effect.forkChild(oneShot(cells, request));
      yield* Effect.yieldNow;
      yield* cells.invalidate(request);
      yield* Deferred.succeed(gate, undefined);
      const settled = yield* Fiber.join(reader);

      expect(settled).toMatchObject({ value: [{ tokenId: "token-3" }] });
      expect(settledValue(settled)).not.toBe(null);
      expect(reads).toBe(3);
      yield* Scope.close(display, Exit.void);
      yield* cells.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("a newer input revision gets one read even when the superseded read failed", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const gate = yield* Deferred.make<void>();
      let reads = 0;
      const cells = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        adapter: unusedAdapter({
          readOrganizationIntegrationTokenGrants: () =>
            Effect.suspend(() => {
              reads++;
              return reads === 1
                ? Deferred.await(gate).pipe(Effect.andThen(Effect.fail(transportFailure())))
                : Effect.succeed([{ tokenId: "token-new", name: "new", grants: [] }]);
            }),
        }),
      });
      const request = tokenGrantsRequest(scope);
      const reader = yield* Effect.forkChild(oneShot(cells, request));
      yield* Effect.yieldNow;
      yield* cells.invalidate(request);
      yield* cells.invalidate(request);
      yield* Deferred.succeed(gate, undefined);
      expect(yield* Fiber.join(reader)).toMatchObject({
        state: "known",
        value: [{ tokenId: "token-new" }],
      });
      expect(reads).toBe(2);
      yield* TestClock.adjust("1 minute");
      expect(reads).toBe(2);
      yield* cells.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("a new one-shot demand reads once after five manual failed reads", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      let reads = 0;
      const cells = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        adapter: unusedAdapter({
          readServiceAuthorizedAgents: () =>
            Effect.suspend(() => {
              reads += 1;
              return reads <= 5 ? Effect.fail(transportFailure(true)) : Effect.succeed(["codex"]);
            }),
        }),
      });
      const request = authorizedAgentsRequest(scope);
      // A surface holds the agents while the person asks to read again.
      const display = yield* Scope.make();
      const held = yield* cells.acquire(request).pipe(Scope.provide(display));
      yield* held.awaitSettled;
      for (let attempt = 1; attempt < 5; attempt++) {
        expect(yield* held.retry).toBe(true);
        yield* held.awaitSettled;
      }
      expect(yield* held.snapshot).toMatchObject({ state: "failed" });

      // A person creates an environment: that new demand gets one read.
      const reader = yield* Effect.forkChild(oneShot(cells, request));
      yield* Effect.yieldNow;
      expect(reads).toBe(6);
      expect(yield* Fiber.join(reader)).toMatchObject({ value: ["codex"] });
      yield* Scope.close(display, Exit.void);
      yield* cells.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("a surface joining a failed cell keeps the failure until Read again", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      let reads = 0;
      const cells = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        adapter: unusedAdapter({
          readOrganizationMembers: () =>
            Effect.suspend(() => {
              reads += 1;
              return reads === 1
                ? Effect.fail(transportFailure(true))
                : Effect.succeed([{ id: "member-1" }]);
            }),
        }),
      });
      const request = membersRequest(scope);
      const display = yield* Scope.make();
      const held = yield* cells.acquire(request).pipe(Scope.provide(display));
      expect(yield* held.awaitSettled).toMatchObject({ state: "failed" });

      const registry = AtomRegistry.make();
      const unmount = registry.mount(cells.known(request));
      yield* Effect.yieldNow;
      expect(reads).toBe(1);
      unmount();
      registry.dispose();
      yield* Scope.close(display, Exit.void);
      yield* cells.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("a reader of a held failed cell starts a fresh read rather than the old failure", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      let reads = 0;
      const cells = yield* makeZeropsCells({
        scope,
        access: () => verifiedAccess(scope),
        adapter: unusedAdapter({
          readOrganizationMembers: () =>
            Effect.suspend(() => {
              reads += 1;
              return reads === 1
                ? Effect.fail(transportFailure(false))
                : Effect.succeed([{ id: "member-1" }]);
            }),
        }),
      });
      const request = membersRequest(scope);
      const display = yield* Scope.make();
      const held = yield* cells.acquire(request).pipe(Scope.provide(display));
      expect(yield* held.awaitSettled).toMatchObject({ state: "failed" });

      expect(yield* oneShot(cells, request)).toMatchObject({ value: [{ id: "member-1" }] });
      expect(reads).toBe(2);
      yield* Scope.close(display, Exit.void);
      yield* cells.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );
});
