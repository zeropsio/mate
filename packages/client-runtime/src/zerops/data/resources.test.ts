import { describe, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";

import type { ZeropsGroupRecord } from "../recipeStore.ts";
import {
  makeZeropsResourceBroker,
  zeropsResourceKeyOf,
  type OrganizationIntegrationTokenGrantsResourceRequest,
  type OrganizationLocationsResourceRequest,
  type ProjectCloneSourceRecipeResourceRequest,
  type RecipeGroupResourceRequest,
  type ServiceAuthorizedAgentsResourceRequest,
  type ZeropsResourceAdapter,
  type ZeropsResourceSourceError,
} from "./resources.ts";
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

const recipeGroupRequest = (
  scope: AccountScope,
  groupId = "group-a",
): RecipeGroupResourceRequest => ({
  kind: "recipe-group",
  account: scope,
  organization: organization(scope),
  groupId,
});

const locationsRequest = (
  scope: AccountScope,
  orgId = "org-a",
): OrganizationLocationsResourceRequest => ({
  kind: "organization-locations",
  account: scope,
  organization: organization(scope, orgId),
});

const cloneRequest = (
  scope: AccountScope,
  projectId = "project-a",
): ProjectCloneSourceRecipeResourceRequest => ({
  kind: "project-clone-source-recipe",
  account: scope,
  project: project(scope, projectId),
});

const authorizedAgentsRequest = (
  scope: AccountScope,
  serviceId = "service-a",
): ServiceAuthorizedAgentsResourceRequest => ({
  kind: "service-authorized-agents",
  account: scope,
  service: service(scope, serviceId),
});

const tokenGrantsRequest = (
  scope: AccountScope,
): OrganizationIntegrationTokenGrantsResourceRequest => ({
  kind: "organization-integration-token-grants",
  account: scope,
  organization: organization(scope),
});

const unusedAdapter = (overrides: Partial<ZeropsResourceAdapter> = {}): ZeropsResourceAdapter => ({
  readRecipeGroup: () => Effect.sync(() => undefined),
  readProjectCloneSourceRecipe: () => Effect.sync(() => undefined),
  readOrganizationLocations: () => Effect.succeed([]),
  readServiceAuthorizedAgents: () => Effect.succeed([]),
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

const transportFailure = (retryable = true): ZeropsResourceSourceError => ({
  _tag: "ZeropsResourceSourceError",
  kind: "transport",
  retryable,
});

describe("zeropsResourceKeyOf", () => {
  it("uses the complete account epoch, origin, organization and entity scope", () => {
    const base = accountScope();
    const requests = [
      authorizedAgentsRequest(base),
      authorizedAgentsRequest(base, "service-b"),
      {
        ...authorizedAgentsRequest(base),
        service: service(base, "service-a", "project-b"),
      },
      {
        ...authorizedAgentsRequest(base),
        service: service(base, "service-a", "project-a", "org-b"),
      },
      authorizedAgentsRequest(accountScope("account-b")),
      authorizedAgentsRequest(accountScope("account-a", 2)),
      authorizedAgentsRequest(accountScope("account-a", 1, "https://other.example.test")),
    ];

    expect(new Set(requests.map(zeropsResourceKeyOf)).size).toBe(requests.length);
    expect(zeropsResourceKeyOf(locationsRequest(base))).not.toBe(
      zeropsResourceKeyOf(tokenGrantsRequest(base)),
    );
  });
});

describe("makeZeropsResourceBroker", () => {
  it.effect("shares one in-flight read while each lease has an independent release fence", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const started = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      let calls = 0;
      let signal: AbortSignal | undefined;
      const broker = yield* makeZeropsResourceBroker({
        scope,
        access: Effect.succeed(verifiedAccess(scope)),
        adapter: unusedAdapter({
          readOrganizationLocations: (_request, context) =>
            Effect.sync(() => {
              calls += 1;
              signal = context.abortSignal;
            }).pipe(
              Effect.andThen(Deferred.succeed(started, undefined)),
              Effect.andThen(Deferred.await(finish)),
              Effect.as([{ id: "prg1", name: "Prague", pingUrl: "https://ping.test" }]),
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
      expect(yield* first.snapshot).toEqual({ status: "loading", attempt: 1 });
      expect((yield* broker.diagnostics).leases).toBe(2);
      yield* first.release;
      expect(yield* first.snapshot).toEqual({ status: "released" });
      expect(signal?.aborted).toBe(false);
      yield* Deferred.succeed(finish, undefined);
      expect(yield* second.awaitSettled).toEqual({
        status: "success",
        attempt: 1,
        value: [{ id: "prg1", name: "Prague", pingUrl: "https://ping.test" }],
      });
      yield* Scope.close(firstScope, Exit.void);
      yield* Scope.close(secondScope, Exit.void);
      expect(signal?.aborted).toBe(true);
      expect((yield* broker.diagnostics).entries).toBe(0);
      yield* broker.shutdown;
    }),
  );

  it.effect("routes every named resource through its restricted adapter result", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const calls: Array<string> = [];
      const broker = yield* makeZeropsResourceBroker({
        scope,
        access: Effect.succeed(verifiedAccess(scope)),
        adapter: unusedAdapter({
          readRecipeGroup: () => {
            calls.push("recipe");
            return Effect.succeed({
              groupId: "group-a",
              name: "App",
              recipes: { dev: "services:\n  - hostname: app\n    envSecrets:\n      KEY: secret" },
            });
          },
          readProjectCloneSourceRecipe: () => {
            calls.push("clone");
            return Effect.succeed({
              servicesYaml: "services:\n  - hostname: app\n",
              services: ["app"],
              droppedContainers: ["zcp"],
              builtFromGit: ["app"],
              scrubbedBlocks: 2,
            });
          },
          readOrganizationLocations: () => {
            calls.push("locations");
            return Effect.succeed([{ id: "prg1", name: "Prague", pingUrl: "https://ping.test" }]);
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
        recipeGroupRequest(scope),
        cloneRequest(scope),
        locationsRequest(scope),
        authorizedAgentsRequest(scope),
        tokenGrantsRequest(scope),
      ] as const;
      const scopes = yield* Effect.forEach(requests, () => Scope.make());
      const leases = yield* Effect.forEach(requests, (request, index) =>
        broker.acquire(request).pipe(Scope.provide(scopes[index]!)),
      );
      yield* Effect.forEach(leases, (lease) => lease.awaitSettled, { concurrency: "unbounded" });

      expect(calls.sort()).toEqual(["agents", "clone", "grants", "locations", "recipe"]);
      const agents = yield* leases[3]!.snapshot;
      expect(agents.status === "success" ? agents.value : null).toEqual(["codex"]);
      const grants = yield* leases[4]!.snapshot;
      expect(grants.status === "success" ? grants.value : null).toEqual([
        {
          tokenId: "token-id",
          name: "zcp-project",
          grants: [{ projectId: "project-a", roleCode: "ADMIN" }],
        },
      ]);
      const diagnostics = yield* broker.diagnostics;
      expect(diagnostics).toMatchObject({ entries: 5, success: 5, sensitiveEntries: 2 });
      expect(diagnostics).not.toHaveProperty("value");
      expect(diagnostics).not.toHaveProperty("error");
      yield* broker.shutdown;
      yield* Effect.forEach(scopes, (leaseScope) => Scope.close(leaseScope, Exit.void), {
        discard: true,
      });
    }),
  );

  it.effect("retains an adapter-owned recipe value without normalizing its nested data", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const recipes: ZeropsGroupRecord["recipes"] = {
        dev: "services:\n  - hostname: app\n    config:\n      exact: <@keep(this)>",
        prod: "services:\n  - hostname: app\n",
        stage: "services:\n  - hostname: app\n",
      };
      const value: ZeropsGroupRecord = { groupId: "group-a", name: "App", recipes };
      const broker = yield* makeZeropsResourceBroker({
        scope,
        access: Effect.succeed(verifiedAccess(scope)),
        adapter: unusedAdapter({ readRecipeGroup: () => Effect.succeed(value) }),
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* broker
        .acquire(recipeGroupRequest(scope))
        .pipe(Scope.provide(leaseScope));
      const loaded = yield* lease.awaitSettled;

      expect(loaded.status === "success" ? loaded.value : null).toBe(value);
      expect(loaded.status === "success" ? loaded.value?.recipes : null).toBe(recipes);
      yield* Scope.close(leaseScope, Exit.void);
      yield* broker.shutdown;
    }),
  );

  it.effect("rejects a stale epoch or mismatched nested account before adapter I/O", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      let calls = 0;
      const broker = yield* makeZeropsResourceBroker({
        scope,
        access: Effect.succeed(verifiedAccess(scope)),
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

      expect(stale).toMatchObject({ _tag: "Failure", failure: { reason: "account-mismatch" } });
      expect(mismatched).toMatchObject({
        _tag: "Failure",
        failure: { reason: "account-mismatch" },
      });
      expect(calls).toBe(0);
      yield* Scope.close(leaseScope, Exit.void);
      yield* broker.shutdown;
    }),
  );

  it.effect("rejects resources outside current organization and project access", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      let calls = 0;
      const broker = yield* makeZeropsResourceBroker({
        scope,
        access: Effect.succeed(verifiedAccess(scope)),
        adapter: unusedAdapter({
          readProjectCloneSourceRecipe: () => {
            calls += 1;
            return Effect.succeed(undefined);
          },
        }),
      });
      const leaseScope = yield* Scope.make();
      const denied = yield* broker
        .acquire(cloneRequest(scope, "not-granted"))
        .pipe(Scope.provide(leaseScope), Effect.result);

      expect(denied).toMatchObject({
        _tag: "Failure",
        failure: { reason: "access-denied" },
      });
      expect(calls).toBe(0);
      yield* Scope.close(leaseScope, Exit.void);
      yield* broker.shutdown;
    }),
  );

  it.effect("erases active sensitive resources when access is revoked", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const access = yield* Ref.make<AccessState>(verifiedAccess(scope));
      let signal: AbortSignal | undefined;
      const broker = yield* makeZeropsResourceBroker({
        scope,
        access: Ref.get(access),
        adapter: unusedAdapter({
          readRecipeGroup: (_request, context) => {
            signal = context.abortSignal;
            return Effect.succeed({
              groupId: "group-a",
              name: "Private",
              recipes: { dev: "SECRET=erase-me" },
            });
          },
        }),
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* broker
        .acquire(recipeGroupRequest(scope))
        .pipe(Scope.provide(leaseScope));
      expect((yield* lease.awaitSettled).status).toBe("success");

      yield* Ref.set(access, {
        status: "denied",
        accountEpoch: scope.epoch,
        scope: { kind: "account", account: scope.account },
        deniedAtMs: 1,
        previous: verifiedAccess(scope),
      });
      yield* broker.reconcileAccess;

      expect(yield* lease.snapshot).toEqual({ status: "released" });
      expect(signal?.aborted).toBe(true);
      expect(yield* broker.diagnostics).toMatchObject({ entries: 0, sensitiveEntries: 0 });
      yield* Scope.close(leaseScope, Exit.void);
      yield* broker.shutdown;
    }),
  );

  it.effect("expires retained resources at the absolute access deadline", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const broker = yield* makeZeropsResourceBroker({
        scope,
        access: Effect.succeed(verifiedAccess(scope, 10)),
        adapter: unusedAdapter({
          readRecipeGroup: () =>
            Effect.succeed({ groupId: "group-a", name: "Private", recipes: { dev: "secret" } }),
        }),
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* broker
        .acquire(recipeGroupRequest(scope))
        .pipe(Scope.provide(leaseScope));
      expect((yield* lease.awaitSettled).status).toBe("success");

      yield* TestClock.adjust("10 millis");
      yield* Effect.yieldNow;

      expect(yield* lease.snapshot).toEqual({ status: "released" });
      expect(yield* broker.diagnostics).toMatchObject({ entries: 0, sensitiveEntries: 0 });
      yield* Scope.close(leaseScope, Exit.void);
      yield* broker.shutdown;
    }).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("rejects late completion after the final lease releases", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const started = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      let signal: AbortSignal | undefined;
      const broker = yield* makeZeropsResourceBroker({
        scope,
        access: Effect.succeed(verifiedAccess(scope)),
        adapter: unusedAdapter({
          readProjectCloneSourceRecipe: (_request, context) => {
            signal = context.abortSignal;
            return Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(finish)),
              Effect.as({
                servicesYaml: "services:\n  - hostname: private\n",
                services: ["private"],
                droppedContainers: [],
                builtFromGit: [],
                scrubbedBlocks: 1,
              }),
            );
          },
        }),
      });
      const leaseScope = yield* Scope.make();
      const lease = yield* broker.acquire(cloneRequest(scope)).pipe(Scope.provide(leaseScope));
      yield* Deferred.await(started);
      yield* lease.release;
      expect(signal?.aborted).toBe(true);
      yield* Deferred.succeed(finish, undefined);
      yield* Effect.yieldNow;
      expect(yield* lease.snapshot).toEqual({ status: "released" });
      expect(yield* broker.diagnostics).toMatchObject({ entries: 0, leases: 0 });
      yield* Scope.close(leaseScope, Exit.void);
      yield* broker.shutdown;
    }),
  );

  it.effect("publishes sanitized failure and shares one explicit retry", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      let calls = 0;
      const broker = yield* makeZeropsResourceBroker({
        scope,
        access: Effect.succeed(verifiedAccess(scope)),
        adapter: unusedAdapter({
          readRecipeGroup: () => {
            calls += 1;
            return calls === 1
              ? Effect.fail({ ...transportFailure(), message: "signed-url=do-not-publish" })
              : Effect.succeed({ groupId: "group-a", name: "App", recipes: {} });
          },
        }),
      });
      const firstScope = yield* Scope.make();
      const secondScope = yield* Scope.make();
      const request = recipeGroupRequest(scope);
      const first = yield* broker.acquire(request).pipe(Scope.provide(firstScope));
      const second = yield* broker.acquire(request).pipe(Scope.provide(secondScope));
      const failed = yield* first.awaitSettled;
      expect(failed).toEqual({
        status: "failure",
        attempt: 1,
        failure: { _tag: "ZeropsResourceReadFailure", kind: "transport", retryable: true },
      });
      expect(failed.status === "failure" && "message" in failed.failure).toBe(false);

      const retryResults = yield* Effect.all([first.retry, second.retry], {
        concurrency: "unbounded",
      });
      expect(retryResults.filter(Boolean)).toHaveLength(1);
      expect(yield* second.awaitSettled).toEqual({
        status: "success",
        attempt: 2,
        value: { groupId: "group-a", name: "App", recipes: {} },
      });
      expect(calls).toBe(2);
      yield* Scope.close(firstScope, Exit.void);
      yield* Scope.close(secondScope, Exit.void);
      yield* broker.shutdown;
    }),
  );

  it.effect("bounds distinct active resources while identical demand still shares", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const broker = yield* makeZeropsResourceBroker({
        scope,
        access: Effect.succeed(verifiedAccess(scope)),
        maxEntries: 1,
        adapter: unusedAdapter(),
      });
      const firstScope = yield* Scope.make();
      const sharedScope = yield* Scope.make();
      const rejectedScope = yield* Scope.make();
      const first = yield* broker.acquire(locationsRequest(scope)).pipe(Scope.provide(firstScope));
      yield* broker.acquire(locationsRequest(scope)).pipe(Scope.provide(sharedScope));
      const rejected = yield* broker
        .acquire(authorizedAgentsRequest(scope))
        .pipe(Scope.provide(rejectedScope), Effect.result);

      expect(rejected).toMatchObject({
        _tag: "Failure",
        failure: { reason: "account-capacity" },
      });
      expect(yield* broker.diagnostics).toMatchObject({ entries: 1, leases: 2 });
      yield* first.release;
      yield* Scope.close(sharedScope, Exit.void);
      const replacement = yield* broker
        .acquire(authorizedAgentsRequest(scope))
        .pipe(Scope.provide(rejectedScope));
      expect((yield* replacement.awaitSettled).status).toBe("success");
      yield* Scope.close(firstScope, Exit.void);
      yield* Scope.close(rejectedScope, Exit.void);
      yield* broker.shutdown;
    }),
  );

  it.effect("aborts and erases sensitive values on idempotent release and shutdown", () =>
    Effect.gen(function* () {
      const scope = accountScope();
      const signals: Array<AbortSignal> = [];
      const broker = yield* makeZeropsResourceBroker({
        scope,
        access: Effect.succeed(verifiedAccess(scope)),
        adapter: unusedAdapter({
          readRecipeGroup: (_request, context) => {
            signals.push(context.abortSignal);
            return Effect.succeed({
              groupId: "group-a",
              name: "App",
              recipes: { dev: "services:\n  - envSecrets:\n      SECRET: erase-me" },
            });
          },
          readProjectCloneSourceRecipe: (_request, context) => {
            signals.push(context.abortSignal);
            return Effect.never;
          },
        }),
      });
      const recipeScope = yield* Scope.make();
      const cloneScope = yield* Scope.make();
      const recipe = yield* broker
        .acquire(recipeGroupRequest(scope))
        .pipe(Scope.provide(recipeScope));
      const clone = yield* broker.acquire(cloneRequest(scope)).pipe(Scope.provide(cloneScope));
      const loaded = yield* recipe.awaitSettled;
      expect(
        loaded.status === "success" ? loaded.value?.recipes.dev?.includes("erase-me") : false,
      ).toBe(true);
      yield* recipe.release;
      yield* recipe.release;
      expect("value" in (yield* recipe.snapshot)).toBe(false);

      yield* broker.shutdown;
      yield* broker.shutdown;
      expect(yield* clone.snapshot).toEqual({ status: "released" });
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      expect(yield* broker.diagnostics).toMatchObject({
        entries: 0,
        leases: 0,
        loading: 0,
        success: 0,
        failure: 0,
        sensitiveEntries: 0,
      });
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
