import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import type { ZeropsLocation } from "../api.ts";
import type { ZeropsIntegrationToken, ZeropsProjectGrant } from "../groupReach.ts";
import type { ZeropsAgentType } from "../newProject.ts";
import type { ExportedRecipe } from "../recipeExport.ts";
import type { ZeropsGroupRecord } from "../recipeStore.ts";
import { DEFAULT_ZEROPS_DATA_POLICY } from "./policy.ts";
import type {
  AccessState,
  AccountRef,
  AccountScope,
  OrganizationRef,
  ProjectRef,
  ServiceRef,
  VerifiedAccessGrant,
} from "./types.ts";
import { organizationKeyOf, projectRoleGrantsAccess } from "./types.ts";

/** A group recipe is read only while a creation surface explicitly demands it. */
export interface RecipeGroupResourceRequest {
  readonly kind: "recipe-group";
  readonly account: AccountScope;
  readonly organization: OrganizationRef;
  readonly groupId: string;
}

/**
 * The adapter must strip project exports before returning from this request.
 * Raw export YAML is deliberately absent from every broker type.
 */
export interface ProjectCloneSourceRecipeResourceRequest {
  readonly kind: "project-clone-source-recipe";
  readonly account: AccountScope;
  readonly project: ProjectRef;
}

export interface OrganizationLocationsResourceRequest {
  readonly kind: "organization-locations";
  readonly account: AccountScope;
  readonly organization: OrganizationRef;
}

/** The adapter projects service env rows to agent identifiers before returning. */
export interface ServiceAuthorizedAgentsResourceRequest {
  readonly kind: "service-authorized-agents";
  readonly account: AccountScope;
  readonly service: ServiceRef;
}

export interface OrganizationIntegrationTokenGrantsResourceRequest {
  readonly kind: "organization-integration-token-grants";
  readonly account: AccountScope;
  readonly organization: OrganizationRef;
}

export type ZeropsResourceRequest =
  | RecipeGroupResourceRequest
  | ProjectCloneSourceRecipeResourceRequest
  | OrganizationLocationsResourceRequest
  | ServiceAuthorizedAgentsResourceRequest
  | OrganizationIntegrationTokenGrantsResourceRequest;

export type ZeropsResourceKind = ZeropsResourceRequest["kind"];

/** Grant metadata contains no integration-token credential. */
export interface ZeropsIntegrationTokenGrantMetadata {
  readonly tokenId: ZeropsIntegrationToken["id"];
  readonly name: ZeropsIntegrationToken["name"];
  readonly grants: ReadonlyArray<ZeropsProjectGrant>;
}

export interface ZeropsResourceValues {
  readonly "recipe-group": ZeropsGroupRecord | undefined;
  readonly "project-clone-source-recipe": ExportedRecipe | undefined;
  readonly "organization-locations": ReadonlyArray<ZeropsLocation>;
  readonly "service-authorized-agents": ReadonlyArray<ZeropsAgentType>;
  readonly "organization-integration-token-grants": ReadonlyArray<ZeropsIntegrationTokenGrantMetadata>;
}

export type ZeropsResourceValue<Request extends ZeropsResourceRequest> =
  ZeropsResourceValues[Request["kind"]];

export type ZeropsResourceKey = string & { readonly ZeropsResourceKey: unique symbol };

export interface ZeropsResourceSourceError {
  readonly _tag: "ZeropsResourceSourceError";
  readonly kind: "transport" | "unavailable" | "permission" | "decode";
  readonly retryable: boolean;
}

export interface ZeropsResourceReadFailure {
  readonly _tag: "ZeropsResourceReadFailure";
  readonly kind: ZeropsResourceSourceError["kind"] | "unexpected";
  readonly retryable: boolean;
}

export type ZeropsResourceSnapshot<Value> =
  | { readonly status: "loading"; readonly attempt: number }
  | { readonly status: "success"; readonly attempt: number; readonly value: Value }
  | {
      readonly status: "failure";
      readonly attempt: number;
      readonly failure: ZeropsResourceReadFailure;
    }
  | { readonly status: "released" };

export type ZeropsResourceSettledSnapshot<Value> = Exclude<
  ZeropsResourceSnapshot<Value>,
  { readonly status: "loading" }
>;

export interface ZeropsResourceRequestContext {
  /** Effect interruption and final release both abort this signal. */
  readonly abortSignal: AbortSignal;
}

/**
 * These callbacks are the complete protocol seam. Implementations may wrap
 * ZeropsApiClient calls, but must perform secret stripping and env projection
 * before their Effects succeed.
 */
export interface ZeropsResourceAdapter {
  readonly readRecipeGroup: (
    request: RecipeGroupResourceRequest,
    context: ZeropsResourceRequestContext,
  ) => Effect.Effect<ZeropsResourceValues["recipe-group"], ZeropsResourceSourceError>;
  readonly readProjectCloneSourceRecipe: (
    request: ProjectCloneSourceRecipeResourceRequest,
    context: ZeropsResourceRequestContext,
  ) => Effect.Effect<
    ZeropsResourceValues["project-clone-source-recipe"],
    ZeropsResourceSourceError
  >;
  readonly readOrganizationLocations: (
    request: OrganizationLocationsResourceRequest,
    context: ZeropsResourceRequestContext,
  ) => Effect.Effect<ZeropsResourceValues["organization-locations"], ZeropsResourceSourceError>;
  readonly readServiceAuthorizedAgents: (
    request: ServiceAuthorizedAgentsResourceRequest,
    context: ZeropsResourceRequestContext,
  ) => Effect.Effect<ZeropsResourceValues["service-authorized-agents"], ZeropsResourceSourceError>;
  readonly readOrganizationIntegrationTokenGrants: (
    request: OrganizationIntegrationTokenGrantsResourceRequest,
    context: ZeropsResourceRequestContext,
  ) => Effect.Effect<
    ZeropsResourceValues["organization-integration-token-grants"],
    ZeropsResourceSourceError
  >;
}

export interface ZeropsResourceAdmissionError {
  readonly _tag: "ZeropsResourceAdmissionError";
  readonly reason:
    | "runtime-closed"
    | "account-mismatch"
    | "account-capacity"
    | "lease-released"
    | "access-unverified"
    | "access-expired"
    | "access-denied";
}

export interface ZeropsResourceLease<Request extends ZeropsResourceRequest> {
  readonly key: ZeropsResourceKey;
  readonly request: Request;
  readonly snapshot: Effect.Effect<ZeropsResourceSnapshot<ZeropsResourceValue<Request>>>;
  readonly changes: Stream.Stream<ZeropsResourceSnapshot<ZeropsResourceValue<Request>>>;
  readonly awaitSettled: Effect.Effect<ZeropsResourceSettledSnapshot<ZeropsResourceValue<Request>>>;
  /** Starts one shared new attempt only when the current attempt failed. */
  readonly retry: Effect.Effect<boolean, ZeropsResourceAdmissionError>;
  /** Idempotent; the acquiring Scope invokes the same release path. */
  readonly release: Effect.Effect<void>;
}

export interface ZeropsResourceDiagnostics {
  readonly entries: number;
  readonly leases: number;
  readonly loading: number;
  readonly success: number;
  readonly failure: number;
  readonly sensitiveEntries: number;
  readonly byKind: Readonly<Record<ZeropsResourceKind, number>>;
}

export interface ZeropsResourceBroker {
  readonly scope: AccountScope;
  readonly acquire: <Request extends ZeropsResourceRequest>(
    request: Request,
  ) => Effect.Effect<ZeropsResourceLease<Request>, ZeropsResourceAdmissionError, Scope.Scope>;
  /** Counts and states only; resource values and adapter errors never enter diagnostics. */
  readonly diagnostics: Effect.Effect<ZeropsResourceDiagnostics>;
  /** Rechecks every retained resource and erases entries no longer covered by access. */
  readonly reconcileAccess: Effect.Effect<void>;
  /** Idempotent. Fences completion, aborts work and erases all retained values. */
  readonly shutdown: Effect.Effect<void>;
}

export interface ZeropsResourceBrokerOptions {
  readonly scope: AccountScope;
  readonly adapter: ZeropsResourceAdapter;
  /** Dynamic account access owned by the parent runtime. */
  readonly access: Effect.Effect<AccessState>;
  readonly maxEntries?: number;
}

type AnyResourceValue = ZeropsResourceValues[ZeropsResourceKind];
type AnyResourceSnapshot = ZeropsResourceSnapshot<AnyResourceValue>;

interface LeaseState {
  readonly key: ZeropsResourceKey;
  readonly state: SubscriptionRef.SubscriptionRef<AnyResourceSnapshot>;
}

interface ResourceEntry {
  readonly key: ZeropsResourceKey;
  readonly request: ZeropsResourceRequest;
  readonly subscribers: Map<string, SubscriptionRef.SubscriptionRef<AnyResourceSnapshot>>;
  snapshot: AnyResourceSnapshot;
  attempt: number;
  generation: number;
  controller: AbortController;
  fiber: Fiber.Fiber<void> | null;
}

const accountRefsEqual = (left: AccountRef, right: AccountRef): boolean =>
  left.apiOrigin === right.apiOrigin && left.accountId === right.accountId;

const accountScopesEqual = (left: AccountScope, right: AccountScope): boolean =>
  left.epoch === right.epoch && accountRefsEqual(left.account, right.account);

const usableGrant = (access: AccessState): VerifiedAccessGrant | null => {
  if (access.status === "verified") return access;
  if (access.status === "verifying" || access.status === "failed") return access.previous;
  return null;
};

const organizationOf = (request: ZeropsResourceRequest): OrganizationRef => {
  switch (request.kind) {
    case "recipe-group":
    case "organization-locations":
    case "organization-integration-token-grants":
      return request.organization;
    case "project-clone-source-recipe":
      return request.project.organization;
    case "service-authorized-agents":
      return request.service.project.organization;
  }
};

export function zeropsResourceKeyOf(request: ZeropsResourceRequest): ZeropsResourceKey {
  const organization = organizationOf(request);
  const prefix = [
    request.kind,
    request.account.account.apiOrigin,
    request.account.account.accountId,
    request.account.epoch,
    organization.organizationId,
  ];
  switch (request.kind) {
    case "recipe-group":
      return JSON.stringify([...prefix, request.groupId]) as ZeropsResourceKey;
    case "project-clone-source-recipe":
      return JSON.stringify([...prefix, request.project.projectId]) as ZeropsResourceKey;
    case "organization-locations":
    case "organization-integration-token-grants":
      return JSON.stringify(prefix) as ZeropsResourceKey;
    case "service-authorized-agents":
      return JSON.stringify([
        ...prefix,
        request.service.project.projectId,
        request.service.serviceId,
      ]) as ZeropsResourceKey;
  }
}

const sourceError = (cause: Cause.Cause<ZeropsResourceSourceError>): ZeropsResourceReadFailure => {
  const found = Cause.findError(cause);
  return Result.isSuccess(found)
    ? {
        _tag: "ZeropsResourceReadFailure",
        kind: found.success.kind,
        retryable: found.success.retryable,
      }
    : { _tag: "ZeropsResourceReadFailure", kind: "unexpected", retryable: false };
};

const admissionError = (
  reason: ZeropsResourceAdmissionError["reason"],
): ZeropsResourceAdmissionError => ({ _tag: "ZeropsResourceAdmissionError", reason });

function resourceAdmission(
  scope: AccountScope,
  access: AccessState,
  request: ZeropsResourceRequest,
  nowMs: number,
): { readonly deadlineMs: number } | ZeropsResourceAdmissionError {
  if (
    !accountScopesEqual(request.account, scope) ||
    !accountRefsEqual(organizationOf(request).account, scope.account)
  ) {
    return admissionError("account-mismatch");
  }
  if (access.status === "denied") return admissionError("access-denied");
  if (access.status === "expired") return admissionError("access-expired");
  const grant = usableGrant(access);
  if (grant === null) return admissionError("access-unverified");
  if (
    grant.accountEpoch !== scope.epoch ||
    !accountRefsEqual(grant.account, scope.account) ||
    grant.deadlineMs <= nowMs
  ) {
    return admissionError("access-expired");
  }
  const organization = organizationOf(request);
  if (
    !grant.organizations.some(
      (entry) => organizationKeyOf(entry.organization) === organizationKeyOf(organization),
    )
  ) {
    return admissionError("access-denied");
  }
  if (
    (request.kind === "project-clone-source-recipe" ||
      request.kind === "service-authorized-agents") &&
    !projectRoleGrantsAccess(
      grant,
      request.kind === "project-clone-source-recipe" ? request.project : request.service.project,
      "any-role",
    )
  ) {
    return admissionError("access-denied");
  }
  return { deadlineMs: grant.deadlineMs };
}

function readResource(
  adapter: ZeropsResourceAdapter,
  request: ZeropsResourceRequest,
  context: ZeropsResourceRequestContext,
): Effect.Effect<AnyResourceValue, ZeropsResourceSourceError> {
  switch (request.kind) {
    case "recipe-group":
      return adapter.readRecipeGroup(request, context);
    case "project-clone-source-recipe":
      return adapter.readProjectCloneSourceRecipe(request, context);
    case "organization-locations":
      return adapter.readOrganizationLocations(request, context);
    case "service-authorized-agents":
      return adapter.readServiceAuthorizedAgents(request, context);
    case "organization-integration-token-grants":
      return adapter.readOrganizationIntegrationTokenGrants(request, context);
  }
}

const settled = <Value>(
  state: SubscriptionRef.SubscriptionRef<ZeropsResourceSnapshot<Value>>,
): Effect.Effect<ZeropsResourceSettledSnapshot<Value>> =>
  SubscriptionRef.get(state).pipe(
    Effect.flatMap((current) => {
      if (current.status !== "loading") return Effect.succeed(current);
      return SubscriptionRef.changes(state).pipe(
        Stream.filter(
          (snapshot): snapshot is ZeropsResourceSettledSnapshot<Value> =>
            snapshot.status !== "loading",
        ),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
      );
    }),
  );

export const makeZeropsResourceBroker = Effect.fn("ZeropsResourceBroker.make")(function* (
  options: ZeropsResourceBrokerOptions,
): Effect.fn.Return<ZeropsResourceBroker> {
  const maxEntries = options.maxEntries ?? DEFAULT_ZEROPS_DATA_POLICY.activeSharedReadsPerAccount;
  if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
    return yield* Effect.die(new RangeError("maxEntries must be a positive safe integer."));
  }

  const lock = yield* Semaphore.make(1);
  const runtimeScope = yield* Scope.make();
  const entries = new Map<ZeropsResourceKey, ResourceEntry>();
  const leases = new Map<string, LeaseState>();
  let nextLeaseId = 0;
  let closed = false;
  let accessDeadlineMs = 0;
  let accessGeneration = 0;

  const publish = (entry: ResourceEntry, snapshot: AnyResourceSnapshot): Effect.Effect<void> =>
    Effect.gen(function* () {
      entry.snapshot = snapshot;
      yield* Effect.forEach(
        entry.subscribers.values(),
        (subscriber) => SubscriptionRef.set(subscriber, snapshot),
        { discard: true },
      );
    });

  const commit = (
    entry: ResourceEntry,
    generation: number,
    snapshot: AnyResourceSnapshot,
  ): Effect.Effect<void> =>
    lock.withPermit(
      Effect.gen(function* () {
        if (closed || entries.get(entry.key) !== entry || entry.generation !== generation) return;
        yield* publish(entry, snapshot);
      }),
    );

  const eraseEntry = (entry: ResourceEntry): Effect.Effect<Fiber.Fiber<void> | null> =>
    Effect.gen(function* () {
      if (entries.get(entry.key) !== entry) return null;
      entries.delete(entry.key);
      entry.generation += 1;
      entry.snapshot = { status: "released" };
      entry.controller.abort();
      for (const [leaseId, subscriber] of entry.subscribers) {
        leases.delete(leaseId);
        yield* SubscriptionRef.set(subscriber, { status: "released" });
      }
      entry.subscribers.clear();
      return entry.fiber;
    });

  const scheduleAccessDeadline = (deadlineMs: number): Effect.Effect<void> =>
    Effect.gen(function* () {
      if (deadlineMs === accessDeadlineMs) return;
      accessDeadlineMs = deadlineMs;
      const generation = ++accessGeneration;
      const now = yield* Clock.currentTimeMillis;
      yield* Effect.gen(function* () {
        yield* Effect.sleep(Duration.millis(Math.max(0, deadlineMs - now)));
        const interrupted = yield* lock.withPermit(
          Effect.gen(function* () {
            if (closed || generation !== accessGeneration) return [];
            accessDeadlineMs = 0;
            const fibers: Array<Fiber.Fiber<void>> = [];
            for (const entry of [...entries.values()]) {
              const fiber = yield* eraseEntry(entry);
              if (fiber !== null) fibers.push(fiber);
            }
            return fibers;
          }),
        );
        yield* Effect.forEach(interrupted, Fiber.interrupt, { discard: true });
      }).pipe(Effect.forkIn(runtimeScope));
    });

  const startAttempt = (entry: ResourceEntry): Effect.Effect<void> =>
    Effect.gen(function* () {
      entry.attempt += 1;
      entry.generation += 1;
      entry.controller = new AbortController();
      const attempt = entry.attempt;
      const generation = entry.generation;
      yield* publish(entry, { status: "loading", attempt });
      const work = Effect.matchCauseEffect(
        readResource(options.adapter, entry.request, { abortSignal: entry.controller.signal }),
        {
          onFailure: (cause) =>
            Cause.hasInterrupts(cause)
              ? Effect.void
              : commit(entry, generation, {
                  status: "failure",
                  attempt,
                  failure: sourceError(cause),
                }),
          onSuccess: (value) => commit(entry, generation, { status: "success", attempt, value }),
        },
      );
      entry.fiber = yield* work.pipe(Effect.forkIn(runtimeScope));
    });

  const releaseLease = (leaseId: string): Effect.Effect<void> =>
    Effect.gen(function* () {
      const interrupted = yield* lock.withPermit(
        Effect.gen(function* () {
          const lease = leases.get(leaseId);
          if (lease === undefined) return null;
          leases.delete(leaseId);
          const entry = entries.get(lease.key);
          yield* SubscriptionRef.set(lease.state, { status: "released" });
          if (entry === undefined) return null;
          entry.subscribers.delete(leaseId);
          if (entry.subscribers.size > 0) return null;
          entries.delete(entry.key);
          entry.generation += 1;
          entry.snapshot = { status: "released" };
          entry.controller.abort();
          return entry.fiber;
        }),
      );
      if (interrupted !== null) yield* Fiber.interrupt(interrupted);
    });

  const retryLease = (leaseId: string): Effect.Effect<boolean, ZeropsResourceAdmissionError> =>
    lock.withPermit(
      Effect.gen(function* () {
        if (closed) return yield* Effect.fail(admissionError("runtime-closed"));
        const lease = leases.get(leaseId);
        if (lease === undefined) return yield* Effect.fail(admissionError("lease-released"));
        const entry = entries.get(lease.key);
        if (entry === undefined) return yield* Effect.fail(admissionError("lease-released"));
        if (entry.snapshot.status !== "failure") return false;
        const access = yield* options.access;
        const now = yield* Clock.currentTimeMillis;
        const admission = resourceAdmission(options.scope, access, entry.request, now);
        if ("_tag" in admission) return yield* Effect.fail(admission);
        yield* scheduleAccessDeadline(admission.deadlineMs);
        yield* startAttempt(entry);
        return true;
      }),
    );

  const acquire: ZeropsResourceBroker["acquire"] = (request) =>
    Effect.gen(function* () {
      const leaseScope = yield* Scope.Scope;
      return yield* lock.withPermit(
        Effect.gen(function* () {
          if (closed) return yield* Effect.fail(admissionError("runtime-closed"));
          const access = yield* options.access;
          const now = yield* Clock.currentTimeMillis;
          const admission = resourceAdmission(options.scope, access, request, now);
          if ("_tag" in admission) return yield* Effect.fail(admission);
          yield* scheduleAccessDeadline(admission.deadlineMs);
          const key = zeropsResourceKeyOf(request);
          let entry = entries.get(key);
          if (entry === undefined) {
            if (entries.size >= maxEntries) {
              return yield* Effect.fail(admissionError("account-capacity"));
            }
            entry = {
              key,
              request,
              subscribers: new Map(),
              snapshot: { status: "loading", attempt: 1 },
              attempt: 0,
              generation: 0,
              controller: new AbortController(),
              fiber: null,
            };
            entries.set(key, entry);
          }
          const leaseId = `resource-lease-${++nextLeaseId}`;
          const state = yield* SubscriptionRef.make<AnyResourceSnapshot>(entry.snapshot);
          entry.subscribers.set(leaseId, state);
          leases.set(leaseId, { key, state });
          if (entry.fiber === null) yield* startAttempt(entry);
          const release = releaseLease(leaseId);
          yield* Scope.addFinalizer(leaseScope, release);
          const typedState = state as unknown as SubscriptionRef.SubscriptionRef<
            ZeropsResourceSnapshot<ZeropsResourceValue<typeof request>>
          >;
          return {
            key,
            request,
            snapshot: SubscriptionRef.get(typedState),
            changes: SubscriptionRef.changes(typedState),
            awaitSettled: settled(typedState),
            retry: retryLease(leaseId),
            release,
          } satisfies ZeropsResourceLease<typeof request>;
        }),
      );
    });

  const reconcileAccess: Effect.Effect<void> = Effect.gen(function* () {
    const access = yield* options.access;
    const now = yield* Clock.currentTimeMillis;
    const interrupted = yield* lock.withPermit(
      Effect.gen(function* () {
        if (closed) return [];
        const fibers: Array<Fiber.Fiber<void>> = [];
        let deadlineMs = 0;
        for (const entry of [...entries.values()]) {
          const admission = resourceAdmission(options.scope, access, entry.request, now);
          if ("_tag" in admission) {
            const fiber = yield* eraseEntry(entry);
            if (fiber !== null) fibers.push(fiber);
          } else {
            deadlineMs = admission.deadlineMs;
          }
        }
        if (deadlineMs > 0) yield* scheduleAccessDeadline(deadlineMs);
        return fibers;
      }),
    );
    yield* Effect.forEach(interrupted, Fiber.interrupt, { discard: true });
  });

  const diagnostics: Effect.Effect<ZeropsResourceDiagnostics> = lock.withPermit(
    Effect.sync(() => {
      const byKind: Record<ZeropsResourceKind, number> = {
        "recipe-group": 0,
        "project-clone-source-recipe": 0,
        "organization-locations": 0,
        "service-authorized-agents": 0,
        "organization-integration-token-grants": 0,
      };
      let loading = 0;
      let success = 0;
      let failure = 0;
      let sensitiveEntries = 0;
      for (const entry of entries.values()) {
        byKind[entry.request.kind] += 1;
        if (entry.snapshot.status === "loading") loading += 1;
        if (entry.snapshot.status === "success") success += 1;
        if (entry.snapshot.status === "failure") failure += 1;
        if (
          entry.request.kind === "recipe-group" ||
          entry.request.kind === "project-clone-source-recipe"
        ) {
          sensitiveEntries += 1;
        }
      }
      return {
        entries: entries.size,
        leases: leases.size,
        loading,
        success,
        failure,
        sensitiveEntries,
        byKind,
      };
    }),
  );

  const shutdown = Effect.gen(function* () {
    const closeScope = yield* lock.withPermit(
      Effect.gen(function* () {
        if (closed) return false;
        closed = true;
        accessGeneration += 1;
        accessDeadlineMs = 0;
        const current = [...entries.values()];
        entries.clear();
        leases.clear();
        for (const entry of current) {
          entry.generation += 1;
          entry.snapshot = { status: "released" };
          entry.controller.abort();
          yield* Effect.forEach(
            entry.subscribers.values(),
            (subscriber) => SubscriptionRef.set(subscriber, { status: "released" }),
            { discard: true },
          );
          entry.subscribers.clear();
        }
        return true;
      }),
    );
    if (closeScope) yield* Scope.close(runtimeScope, Exit.void);
  });

  return {
    scope: options.scope,
    acquire,
    diagnostics,
    reconcileAccess,
    shutdown,
  } satisfies ZeropsResourceBroker;
});
