/**
 * Capabilities (DESIGN §4.3): what a command may do now, read from the access grant at the moment
 * it is asked. The grant runs inside a data runtime here, its verification reads on a fake verifier
 * and its timers on the harness clock, so a capability is compared with what the runtime's own
 * command admission and resource broker decide over the same grant.
 */
import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { AtomRegistry } from "effect/unstable/reactivity";

import { makeDeadlineClock, type DeadlineClock } from "../../testing/deadlineClock.ts";
import { ZeropsApiError, type ZeropsProject } from "../../api.ts";
import { account, organization, project, scope, service } from "../__fixtures__/index.ts";
import { commandAdmissionError } from "../commands.ts";
import type {
  ServiceAuthorizedAgentsResourceRequest,
  ZeropsResourceAdapter,
} from "../resources.ts";
import { makeZeropsDataRuntime } from "../runtime.ts";
import type { ProjectEffectiveAccess, ProjectRef, ZeropsDataAdapter } from "../types.ts";
import {
  forge,
  grantCapabilities,
  mate,
  throwawayCleanup,
  type CapabilityAsk,
} from "./capabilities.ts";
import type { GrantCapability, GrantFailure, ProjectOutcome } from "./grant.ts";
import {
  IDLE_GUARDS,
  initialEnvironment,
  transitionEnvironment,
  type EnvironmentEvent,
} from "../../environments/environmentMachine.ts";
import { makeRestAccessVerifier, type AccessVerifier } from "./verifier.ts";

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const START_WALL_MS = Date.UTC(2026, 8, 23, 10, 0, 0);
const A = project("project-a");
const B = project("project-b");

const admin = (target: ProjectRef): ProjectEffectiveAccess => ({
  project: target,
  role: "ADMIN",
  mutationsAllowed: true,
});
const readOnly = (target: ProjectRef): ProjectEffectiveAccess => ({
  project: target,
  role: "READ_ONLY",
  mutationsAllowed: false,
});
const verified = (access: ProjectEffectiveAccess): ProjectOutcome => ({ kind: "verified", access });
const serverDown: GrantFailure = { kind: "server", status: 503 };
const failed: ProjectOutcome = { kind: "failed", failure: serverDown };
const forbidden: ProjectOutcome = { kind: "denied", evidence: "direct-forbidden" };

/** Nothing leases an interest here: the runtime never reaches its push half. */
const unused = Effect.die("the capability tests lease no interest");
const inertAdapter: ZeropsDataAdapter = {
  openReceiver: () => unused,
  register: () => unused,
  read: () => unused,
  execute: () => unused,
  closeReceiver: () => Effect.void,
};

/** Every service resource reads as one agent; nothing else is asked for. */
const resourceAdapter: ZeropsResourceAdapter = {
  readOrganizationLocations: () => Effect.succeed([]),
  readServiceAuthorizedAgents: () => Effect.succeed(["codex"]),
  readServiceDeployedVersion: () => Effect.sync(() => undefined),
  readServiceMateFlag: () => Effect.succeed({ enabled: "unknown" }),
  readOrganizationIntegrationTokenGrants: () => Effect.succeed([]),
};

/** What the platform answers the grant's reads, changeable between steps. */
interface Platform {
  /** The projects the account part lists. */
  listed: ReadonlyArray<ProjectRef>;
  /** Each project's answer to a round (`round`) or to a read between rounds (`read`). */
  outcome: (target: ProjectRef, read: "round" | "read") => ProjectOutcome;
  /** `fetchUser` answers this failure instead; null answers. */
  roundFailure: GrantFailure | null;
}

/** Each read answers after this long on the monotonic clock. */
const READ_MS = SECOND;

/** Lets every fiber the last step woke run to its next wait. */
const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 20; turn++) {
    yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
    yield* Effect.yieldNow;
  }
});

/** Requests in flight, each answering at its own monotonic time, never a tab's timer. */
const makeNetwork = (clock: DeadlineClock) => {
  const pending: Array<{ readonly at: number; readonly answer: Deferred.Deferred<void> }> = [];
  return {
    wait: (ms: number) =>
      Effect.gen(function* () {
        const answer = yield* Deferred.make<void>();
        pending.push({ at: clock.monoMs() + ms, answer });
        yield* Deferred.await(answer);
      }),
    deliver: Effect.suspend(() => {
      const due = pending.filter(({ at }) => at <= clock.monoMs());
      for (const request of due) pending.splice(pending.indexOf(request), 1);
      return Effect.forEach(due, ({ answer }) => Deferred.succeed(answer, undefined), {
        discard: true,
      });
    }),
    next: () => Math.min(...pending.map(({ at }) => at)),
  };
};

/**
 * One tab's data runtime with its grant started now, on the harness clock: verified against
 * `platform`, or through `rest` when given.
 */
const tab = Effect.fnUntraced(function* (platform: Platform, rest?: AccessVerifier) {
  const clock = yield* makeDeadlineClock({ startWallMs: START_WALL_MS });
  const registry = AtomRegistry.make();
  let opaque = 0;
  const runtime = yield* makeZeropsDataRuntime({
    scope: scope(),
    adapter: inertAdapter,
    resourceAdapter,
    atomRegistry: registry,
    makeOpaqueId: () => `opaque-${++opaque}`,
  }).pipe(Effect.provideService(Clock.Clock, clock));
  yield* Effect.addFinalizer(() => runtime.shutdown("application-close"));
  const network = makeNetwork(clock);
  const verifier: AccessVerifier = {
    verifyRound: ({ round, report }) =>
      Effect.gen(function* () {
        yield* network.wait(READ_MS);
        const failure = platform.roundFailure;
        if (failure !== null) return yield* Effect.fail({ failure, message: "Zerops is down." });
        yield* report({
          type: "ROUND_ACCOUNT",
          round,
          organizations: [{ organization, mutationsAllowed: true }],
          projects: platform.listed,
        });
        yield* network.wait(READ_MS);
        for (const target of platform.listed) {
          const outcome = platform.outcome(target, "round");
          yield* report({ type: "ROUND_PROJECT", round, project: target, outcome });
        }
      }),
    verifyProject: (target) =>
      network.wait(READ_MS).pipe(Effect.as(platform.outcome(target, "read"))),
  };
  const answer = Effect.andThen(settle, Effect.andThen(network.deliver, settle));
  /** When the grant's timer fires, on the monotonic clock. */
  const nextTimer = () => {
    const at = registry.get(runtime.access.view).machine.timer;
    if (at === null) return Number.POSITIVE_INFINITY;
    return (
      clock.monoMs() + Math.max(0, Math.min(at.wall - clock.wallMs(), at.mono - clock.monoMs()))
    );
  };
  /** Time passes in a running tab, stopping at each timer and each answer. */
  const pass = Effect.fnUntraced(function* (ms: number) {
    const until = clock.monoMs() + ms;
    for (;;) {
      const next = Math.min(network.next(), nextTimer());
      if (next > until) break;
      yield* clock.advance(Math.max(1, next - clock.monoMs()));
      yield* answer;
    }
    yield* clock.advance(Math.max(0, until - clock.monoMs()));
    yield* answer;
  });
  yield* runtime.access.start({ verifier: rest ?? verifier, hidden: false, online: true });
  yield* settle;
  const resources = new Map(
    [A, B].map((target): [ProjectRef, ServiceAuthorizedAgentsResourceRequest] => [
      target,
      {
        kind: "service-authorized-agents",
        account: runtime.scope,
        service: service(`service-of-${target.projectId}`, target),
      },
    ]),
  );
  for (const request of resources.values()) registry.mount(runtime.resources.known(request));
  const capabilities = grantCapabilities(runtime.access);
  return {
    clock,
    runtime,
    pass,
    freeze: (ms: number) => Effect.andThen(clock.freeze(ms), answer),
    phase: () => registry.get(runtime.access.view).machine.phase.phase,
    /** The capability asked now: whoever asks, it is read on the grant's clock. */
    check: capabilities.check,
    /** A project write's admission, in the background. */
    admitProjectWrite: () => Effect.forkChild(capabilities.admitProjectWrite),
    /** Waits for the capability, in the background. */
    await: (ask: CapabilityAsk, withinMs: number) =>
      Effect.forkChild(capabilities.await(ask, { withinMs })),
    /**
     * Whether the broker admits a read of the project's resource now: it is neither withheld
     * nor, once the account closed, waiting for a Zerops session.
     */
    readable: (target: ProjectRef) =>
      Effect.gen(function* () {
        yield* runtime.resources.reconcileAccess;
        yield* settle;
        const shown = registry.get(runtime.resources.known(resources.get(target)!));
        return (
          shown.state !== "withheld" &&
          !(shown.state === "unread" && shown.waitingFor === "zerops-session")
        );
      }),
    /** Whether the runtime's command admission lets a write on the project run now. */
    commandable: (target: ProjectRef) =>
      Effect.gen(function* () {
        const { access } = yield* runtime.state;
        const account = yield* capabilities.check({ kind: "account" });
        return (
          commandAdmissionError(runtime.scope, access, target, clock.wallMs(), account) === null
        );
      }),
  };
});

type Tab = Effect.Success<ReturnType<typeof tab>>;

/** A platform that lists both projects and verifies each as an admin. */
const answering = (): Platform => ({
  listed: [A, B],
  outcome: (target) => verified(admin(target)),
  roundFailure: null,
});

/** Brings a tab into one access state and one evidence state for project A. */
type Arrange = (opened: Tab, platform: Platform) => Effect.Effect<void>;

const firstRound = (opened: Tab) => opened.pass(2 * READ_MS);

const ALLOWED: GrantCapability = { allowed: true };
const refused = (reason: RefusalReason, waitable: boolean): GrantCapability => ({
  allowed: false,
  reason,
  waitable,
});
type RefusalReason = Extract<GrantCapability, { readonly allowed: false }>["reason"];

/** A state, how a tab gets there, and project A's write and read capability in it. */
type Row = readonly [
  state: string,
  arrange: Arrange,
  write: GrantCapability,
  read: GrantCapability,
];

/** Account states: the grant's phase and its renewal, with A's evidence fresh and writable. */
const ACCOUNT_STATES: ReadonlyArray<Row> = [
  [
    "verifying: the first round is in flight",
    (opened) => opened.pass(READ_MS / 2),
    refused("access-unverified", true),
    refused("access-unverified", true),
  ],
  [
    "unverified-failed: the first round failed",
    (opened, platform) =>
      Effect.suspend(() => {
        platform.roundFailure = serverDown;
        return opened.pass(READ_MS);
      }),
    refused("access-unverified", true),
    refused("access-unverified", true),
  ],
  ["granted", firstRound, ALLOWED, ALLOWED],
  [
    "granted, its renewal in flight",
    (opened) => Effect.andThen(firstRound(opened), opened.pass(12 * MINUTE)),
    ALLOWED,
    ALLOWED,
  ],
  [
    "granted, its renewal failing before the deadline",
    (opened, platform) =>
      Effect.gen(function* () {
        yield* firstRound(opened);
        platform.roundFailure = serverDown;
        yield* opened.pass(13 * MINUTE);
      }),
    ALLOWED,
    ALLOWED,
  ],
  [
    "lapsed: renewals failed past the deadline",
    (opened, platform) =>
      Effect.gen(function* () {
        yield* firstRound(opened);
        platform.roundFailure = serverDown;
        yield* opened.pass(16 * MINUTE);
      }),
    refused("access-lapsed", true),
    refused("access-lapsed", true),
  ],
  [
    "lapsed: frozen past the deadline, its round in flight",
    (opened) => Effect.andThen(firstRound(opened), opened.freeze(30 * MINUTE)),
    refused("access-lapsed", true),
    refused("access-lapsed", true),
  ],
  [
    "closed: the epoch ended",
    (opened) =>
      Effect.andThen(firstRound(opened), opened.runtime.shutdown("logout")).pipe(
        Effect.andThen(settle),
      ),
    refused("epoch-closed", false),
    refused("epoch-closed", false),
  ],
];

/** Project A's evidence states, each in a granted account. */
const PROJECT_STATES: ReadonlyArray<Row> = [
  ["verified, its role writes", firstRound, ALLOWED, ALLOWED],
  [
    "verified, its role only reads",
    (opened, platform) =>
      Effect.suspend(() => {
        platform.outcome = (target) => verified(target === A ? readOnly(A) : admin(target));
        return firstRound(opened);
      }),
    refused("role-denies", false),
    ALLOWED,
  ],
  [
    "unverified, carrying fresh evidence from an earlier round",
    (opened, platform) =>
      Effect.gen(function* () {
        yield* firstRound(opened);
        platform.outcome = (target) => (target === A ? failed : verified(admin(target)));
        yield* opened.pass(12 * MINUTE + 2 * READ_MS);
      }),
    ALLOWED,
    ALLOWED,
  ],
  [
    "unverified, with no evidence",
    (opened, platform) =>
      Effect.suspend(() => {
        platform.outcome = (target) => (target === A ? failed : verified(admin(target)));
        return firstRound(opened);
      }),
    refused("project-unverified", true),
    refused("project-unverified", true),
  ],
  [
    "unverified, its evidence expired while the account renewed (T-L19)",
    (opened, platform) =>
      Effect.gen(function* () {
        yield* firstRound(opened);
        platform.outcome = (target) => (target === A ? failed : verified(admin(target)));
        yield* opened.pass(16 * MINUTE);
      }),
    refused("project-unverified", true),
    refused("project-unverified", true),
  ],
  [
    "closed, its denial awaiting confirmation (G6)",
    (opened, platform) =>
      Effect.suspend(() => {
        platform.outcome = (target, read) =>
          target === A ? (read === "round" ? forbidden : failed) : verified(admin(target));
        return firstRound(opened);
      }),
    refused("project-closed", false),
    refused("project-closed", false),
  ],
  [
    "closed, its denial confirmed",
    (opened, platform) =>
      Effect.gen(function* () {
        platform.outcome = (target) => (target === A ? forbidden : verified(admin(target)));
        yield* firstRound(opened);
        yield* opened.pass(10 * SECOND);
      }),
    refused("project-closed", false),
    refused("project-closed", false),
  ],
  [
    "absent from the account's projects",
    (opened, platform) =>
      Effect.suspend(() => {
        platform.listed = [B];
        return firstRound(opened);
      }),
    refused("project-unverified", true),
    refused("project-unverified", true),
  ],
];

describe("capabilities over the access grant", () => {
  it.effect.each([
    ...ACCOUNT_STATES.map(([state, ...rest]) => [`account ${state}`, ...rest] as const),
    ...PROJECT_STATES.map(([state, ...rest]) => [`project ${state}`, ...rest] as const),
  ])(
    "commands and resources agree for every access state and every project evidence state: %s",
    ([, arrange, write, read]) =>
      Effect.scoped(
        Effect.gen(function* () {
          const platform = answering();
          const opened = yield* tab(platform);
          yield* arrange(opened, platform);

          expect([
            yield* opened.check({ kind: "platformWrite", project: A.projectId }),
            yield* opened.check({ kind: "platformRead", project: A.projectId }),
          ]).toEqual([write, read]);
          for (const target of [A, B]) {
            const canWrite = yield* opened.check({
              kind: "platformWrite",
              project: target.projectId,
            });
            const canRead = yield* opened.check({
              kind: "platformRead",
              project: target.projectId,
            });
            expect({
              project: target.projectId,
              write: canWrite.allowed,
              read: canRead.allowed,
            }).toEqual({
              project: target.projectId,
              write: yield* opened.commandable(target),
              read: yield* opened.readable(target),
            });
          }
        }),
      ),
  );

  // Between the grant's timer ticks, the runtime's access still holds the evidence as last
  // published; only the grant's own clocks see that the wall clock went back (G5).
  it.effect("a wall clock set back an hour refuses commands as it refuses the capability", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const opened = yield* tab(answering());
        yield* firstRound(opened);
        opened.clock.skewWall(-60 * MINUTE);

        expect({
          write: yield* opened.check({ kind: "platformWrite", project: A.projectId }),
          commandable: yield* opened.commandable(A),
        }).toEqual({ write: refused("access-lapsed", true), commandable: false });
      }),
    ),
  );

  it.effect("a waitable refusal resolves within 30 s when the grant arrives", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const platform = answering();
        platform.roundFailure = serverDown;
        const opened = yield* tab(platform);
        const write = { kind: "platformWrite", project: A.projectId } as const;

        // Nothing is admitted for 30 s: the wait ends with the refusal, still worth retrying.
        const unanswered = yield* opened.await(write, 30 * SECOND);
        yield* opened.pass(30 * SECOND - 1);
        expect(unanswered.pollUnsafe()).toBeUndefined();
        yield* opened.pass(1);
        expect(yield* Fiber.join(unanswered).pipe(Effect.flip)).toMatchObject({
          _tag: "CapabilityRefusal",
          reason: "access-unverified",
          waitable: true,
        });

        // The platform answers again: the next round admits the grant, and the wait ends with it.
        const answered = yield* opened.await(write, 30 * SECOND);
        platform.roundFailure = null;
        const startedAt = opened.clock.monoMs();
        while (answered.pollUnsafe() === undefined) yield* opened.pass(SECOND);
        yield* Fiber.join(answered);
        expect(opened.clock.monoMs() - startedAt).toBeLessThan(30 * SECOND);
        expect(yield* opened.check(write)).toEqual(ALLOWED);
      }),
    ),
  );

  it.effect(
    "a non-waitable identityMint refusal moves the environment machine to refused(reason)",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const opened = yield* tab(answering());
          yield* firstRound(opened);
          yield* opened.runtime.shutdown("logout");
          yield* settle;

          const identityMint = yield* opened.check({ kind: "identityMint" });
          expect(identityMint).toEqual(refused("epoch-closed", false));
          const origin = "https://zcp-1-abc.prg1.zerops.app";
          let machine = initialEnvironment({ record: null });
          for (const event of [
            {
              type: "GUARDS",
              guards: {
                ...IDLE_GUARDS,
                want: true,
                routeTarget: true,
                visible: true,
                postGrant: true,
                budget: true,
                identityMint,
              },
            },
            { type: "CONTAINER", container: { level: "ready" } },
            { type: "PRESENCE", presence: { kind: "present", origin } },
          ] satisfies ReadonlyArray<EnvironmentEvent>) {
            machine = transitionEnvironment(machine, event, {
              now: { wall: opened.clock.wallMs(), mono: opened.clock.monoMs() },
              random: () => 0.5,
            }).state;
          }
          expect(machine.credential).toEqual({
            kind: "refused",
            reason: { kind: "access", reason: "epoch-closed" },
          });
        }),
      ),
  );

  const ORGANIZATION_ROLES = ["OWNER", "ADMIN", "BASIC_USER", "READ_ONLY"] as const;
  const PROJECT_OVERRIDES = [
    null,
    "OWNER",
    "ADMIN",
    "BASIC_USER",
    "READ_ONLY",
    "NO_ACCESS",
  ] as const;

  it.effect.each(
    ORGANIZATION_ROLES.flatMap((role) =>
      PROJECT_OVERRIDES.map((override) => [role, override ?? "no"] as const),
    ),
  )(
    "T-VEC: a %s member with %s project override can mint once the first grant is admitted",
    ([role, override]) =>
      Effect.scoped(
        Effect.gen(function* () {
          let zeropsDown = false;
          const read: ZeropsProject = {
            id: A.projectId,
            clientId: organization.organizationId,
            name: "a",
            status: "ACTIVE",
            ...(override === "no"
              ? {}
              : { userRoles: [{ clientUserId: "membership", roleCode: override }] }),
          };
          const rest = makeRestAccessVerifier({
            client: {
              fetchUser: async () => {
                if (zeropsDown) throw new ZeropsApiError("Unavailable", "server", 503);
                return {
                  id: account.accountId,
                  email: "person@example.test",
                  clientUserList: [
                    { id: "membership", clientId: organization.organizationId, roleCode: role },
                  ],
                };
              },
              listAccessibleClientProjects: async () => [read],
              fetchProject: async () => read,
            },
            account,
            concurrency: 4,
            onUser: () => undefined,
          });
          const opened = yield* tab(answering(), rest);
          const mint = { kind: "identityMint" } as const;
          yield* opened.pass(SECOND);
          const granted = yield* opened.check(mint);
          zeropsDown = true;
          yield* opened.pass(16 * MINUTE);
          const lapsed = yield* opened.check(mint);

          expect({ phase: opened.phase(), granted, lapsed }).toEqual({
            phase: "lapsed",
            granted: ALLOWED,
            lapsed: ALLOWED,
          });
        }),
      ),
  );

  it.each([
    ["before the first grant", { postGrant: false }, refused("access-unverified", true)],
    [
      "its project unreadable",
      { project: refused("project-closed", false) },
      refused("project-closed", false),
    ],
    [
      "no credential held",
      { credential: "none" },
      { allowed: false, reason: "mate-not-connected", waitable: false },
    ],
    [
      "no credential held, its link reconnecting",
      { credential: "none", link: "reconnecting" },
      { allowed: false, reason: "mate-not-connected", waitable: true },
    ],
    [
      "its link reconnecting",
      { link: "reconnecting" },
      { allowed: false, reason: "mate-not-connected", waitable: true },
    ],
    [
      "its link blocked",
      { link: "blocked" },
      { allowed: false, reason: "mate-not-connected", waitable: false },
    ],
    ["connected with its project readable", {}, ALLOWED],
  ] as const)("mate(env) with %s", (_state, input, expected) => {
    expect(
      mate({ postGrant: true, credential: "held", link: "connected", project: ALLOWED, ...input }),
    ).toEqual(expected);
  });

  it.each([
    ["signed-in", ALLOWED],
    ["idle", { allowed: false, reason: "gitea-session", waitable: false }],
    ["acquiring", { allowed: false, reason: "gitea-session", waitable: true }],
    ["reacquiring", { allowed: false, reason: "gitea-session", waitable: true }],
    ["pending", { allowed: false, reason: "gitea-session", waitable: true }],
    ["unavailable", { allowed: false, reason: "gitea-session", waitable: false }],
    ["waiting", { allowed: false, reason: "gitea-session", waitable: false }],
    ["refused", { allowed: false, reason: "gitea-session", waitable: false }],
    ["closed", refused("epoch-closed", false)],
  ] as const)("forge(origin) with its Gitea session %s", (session, expected) => {
    expect(forge(session)).toEqual(expected);
  });

  it.each([
    ["in the epoch that minted it", { sameEpoch: true, samePrincipal: true }, ALLOWED],
    ["by a sweep under the same principal", { sameEpoch: false, samePrincipal: true }, ALLOWED],
    [
      "under another principal",
      { sameEpoch: false, samePrincipal: false },
      refused("epoch-closed", false),
    ],
  ] as const)("throwawayCleanup %s never waits", (_when, minted, expected) => {
    expect(throwawayCleanup(minted)).toEqual(expected);
  });

  it.effect(
    "a project write waits up to 30 s on the account's own evidence and is refused as an admission",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const platform = answering();
          platform.roundFailure = serverDown;
          const opened = yield* tab(platform);

          const unverified = yield* opened.admitProjectWrite();
          yield* opened.pass(30 * SECOND - 1);
          expect(unverified.pollUnsafe()).toBeUndefined();
          yield* opened.pass(1);
          expect(yield* Fiber.join(unverified).pipe(Effect.flip)).toEqual({
            _tag: "ZeropsCommandAdmissionError",
            reason: "access-unverified",
            // The wait was the command's last chance: for it, the evidence was never verified.
            message: "Project access could not be verified.",
          });

          // Project writes need the account's evidence alone: a project the grant never read is the
          // caller's to check.
          platform.roundFailure = null;
          platform.listed = [];
          const granted = yield* opened.admitProjectWrite();
          while (granted.pollUnsafe() === undefined) yield* opened.pass(SECOND);
          yield* Fiber.join(granted);

          yield* opened.runtime.shutdown("logout");
          yield* settle;
          const closed = yield* opened.admitProjectWrite();
          yield* settle;
          expect(yield* Fiber.join(closed).pipe(Effect.flip)).toEqual({
            _tag: "ZeropsCommandAdmissionError",
            reason: "runtime-closed",
            message: "This Zerops sign-in has ended.",
          });
        }),
      ),
  );
});
