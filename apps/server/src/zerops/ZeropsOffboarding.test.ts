import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import type { AccessRead } from "./ZeropsAccessRead.ts";
import type { AccessLiveEvent } from "./ZeropsAccessSocket.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import type { MateLogin } from "./ZeropsLogins.ts";
import {
  layer as offboardingLayer,
  make as makeOffboarding,
  ZeropsOffboarding,
} from "./ZeropsOffboarding.ts";
import { make as makeAccessList, ZeropsMateAccessList } from "./ZeropsMateAccessList.ts";
import { make as makeProjectSigners, ZeropsProjectSigners } from "./ZeropsProjectSigners.ts";
import {
  make as makeSignOut,
  type SignOutTarget,
  stopSessionsOnEngine,
  ZeropsSignOut,
} from "./ZeropsSignOut.ts";
import { sceneRead } from "./testing/accessScene.ts";
import {
  memorySignInStore,
  ZeropsSignIns,
  type SignInRecords,
  type SignInStore,
} from "./zeropsSignIns.ts";

const EVA = "eva-user-id";
const JAN = "jan-user-id";

const WORK: MateLogin = {
  id: "claudeAgent-work",
  agent: "claude-code",
  kind: "subscription",
  label: "work",
  home: "/home/zerops/.mate/logins/claudeAgent-work",
  keyStored: false,
};

/**
 * Offboarding over the real sign-out: Eva signed in Claude Code's own login and the `work` login,
 * Jan Codex; a live session runs on each of Eva's. `access` is what `hasProjectAccess` answers,
 * `owners` whose the project's own row says it is.
 */
const offboarding = (
  access: Readonly<Record<string, boolean | undefined>>,
  owners: Effect.Effect<ReadonlyArray<string> | undefined> = Effect.succeed(undefined),
) =>
  Effect.gen(function* () {
    const stopped = yield* Ref.make<ReadonlyArray<string>>([]);
    const steps = yield* Ref.make<ReadonlyArray<string>>([]);
    const step = (label: string) => Ref.update(steps, (all) => [...all, label]);
    const signOut = yield* makeSignOut({
      isZeropsEnvironment: true,
      zeropsAgentAuth: {
        latest: Effect.succeed({ available: true, agents: [] }),
        recheckNow: (agentId) => step(`recheck:${agentId}`),
        invalidatePendingMark: () => Effect.void,
      },
      zeropsAgentLogin: { cancel: (agentId, loginId) => step(`cancel:${loginId ?? agentId}`) },
      zeropsAgentFlag: { clearSignedIn: (agentId) => step(`flag:${agentId}`) },
      zeropsLogins: {
        resolve: (id) => Effect.succeed(id === WORK.id ? WORK : undefined),
        recheckNow: (id) => step(`recheck:${id}`),
        forget: () => Effect.void,
      },
      stopSessions: stopSessionsOnEngine({
        stopSessionsOn: (instanceIds) => Ref.update(stopped, (all) => [...all, ...instanceIds]),
      }),
      runLogout: (login) =>
        step(`logout:${login.home ?? login.agent}`).pipe(Effect.as({ success: true })),
      agentCredentialPath: (agentId) => `/home/zerops/${agentId}`,
      credentialExists: () => Effect.succeed(false),
      removeCredential: () => Effect.void,
    });
    const service = yield* makeOffboarding({
      signers: Effect.succeed({ "claude-code": EVA, [WORK.id]: EVA, codex: JAN }),
      hasProjectAccess: (userId) => Effect.succeed(access[userId]),
      owners,
      signOut: signOut.signOut,
    });
    return { service, stopped, steps };
  });

// X4: a person this project no longer opens for is signed out of every login they signed in — an
// agent's own and any beyond — by the same sign-out a person asks for: their live sessions
// stopped, their logins logged out.
describe("ZeropsOffboarding", () => {
  it.effect("signs every login of a person who lost access out, their sessions stopped", () =>
    Effect.gen(function* () {
      const { service, stopped, steps } = yield* offboarding({ [EVA]: false, [JAN]: true });
      assert.strictEqual(yield* service.checkNow, 2);
      assert.deepStrictEqual(yield* Ref.get(stopped), ["claudeAgent", "claude-code", WORK.id]);
      const done = yield* Ref.get(steps);
      for (const expected of [
        "cancel:claude-code",
        "logout:claude-code",
        "flag:claude-code",
        `cancel:${WORK.id}`,
        `logout:${WORK.home}`,
        `recheck:${WORK.id}`,
      ]) {
        assert.include([...done], expected);
      }
      assert.isFalse(
        done.some((label) => label.includes("codex")),
        "Jan's Codex was signed out",
      );
    }),
  );

  // Only a read that says so signs anybody out: one that cannot be read keeps everyone in.
  it.effect.each(
    Array.from(
      [
        ["still has access", { [EVA]: true, [JAN]: true }],
        ["cannot be read", {}],
      ] as const,
      ([name, access]) => ({ title: `signs nobody out while every signer ${name}`, access }),
    ),
  )("$title", ({ access }) =>
    Effect.gen(function* () {
      const { service, stopped, steps } = yield* offboarding(access);
      assert.strictEqual(yield* service.checkNow, 0);
      assert.deepStrictEqual(yield* Ref.get(stopped), []);
      assert.deepStrictEqual(yield* Ref.get(steps), []);
    }),
  );
});

// Decision: When the Mate's owner (the OWNER override on its own project row) changes, the Mate
// signs out every provider login whose signer is not the new owner and ends the running agent,
// through the existing offboarding path.
describe("ZeropsOffboarding, when the project changes hands", () => {
  it.effect(
    "an owner change on the project row signs out every login whose signer is not the new owner, the old owner's access kept",
    () =>
      Effect.gen(function* () {
        const owners = yield* Ref.make<ReadonlyArray<string> | undefined>(undefined);
        const { service, stopped, steps } = yield* offboarding(
          { [EVA]: true, [JAN]: true },
          Ref.get(owners),
        );
        // No own read yet, then the first owner read: what it starts from, nobody signed out.
        assert.strictEqual(yield* service.checkNow, 0);
        yield* Ref.set(owners, [EVA]);
        assert.strictEqual(yield* service.checkNow, 0);
        assert.strictEqual(yield* service.checkNow, 0);
        // Eva hands the Mate to Jan: Eva keeps her access (her organization role), not her logins.
        yield* Ref.set(owners, [JAN]);
        assert.strictEqual(yield* service.checkNow, 2);
        assert.deepStrictEqual(yield* Ref.get(stopped), ["claudeAgent", "claude-code", WORK.id]);
        const done = yield* Ref.get(steps);
        assert.include([...done], "logout:claude-code");
        assert.include([...done], `logout:${WORK.home}`);
        assert.isFalse(
          done.some((label) => label.includes("codex")),
          "the new owner's Codex was signed out",
        );
        // Handed over once: a later pass with the same owner signs nobody out again.
        yield* Ref.set(steps, []);
        assert.strictEqual(yield* service.checkNow, 0);
        assert.deepStrictEqual(yield* Ref.get(steps), []);
      }),
  );
});

// HQ sending a different access list signs a person who lost access out now, not at the next
// role recheck.
describe("ZeropsOffboarding's loop", () => {
  /** The layer's loop over Eva's Claude Code login: `access` answers for her, both feeds fire. */
  const loop = <A>(
    body: (feeds: {
      readonly access: Ref.Ref<boolean>;
      readonly signedOut: Ref.Ref<ReadonlyArray<unknown>>;
      readonly relays: PubSub.PubSub<void>;
      readonly signIns: PubSub.PubSub<void>;
    }) => Effect.Effect<A, never, ZeropsOffboarding>,
  ) =>
    Effect.gen(function* () {
      const access = yield* Ref.make(true);
      const signedOut = yield* Ref.make<ReadonlyArray<unknown>>([]);
      const relays = yield* PubSub.unbounded<void>();
      const signIns = yield* PubSub.unbounded<void>();
      const environment = resolveZeropsEnvironment({
        projectId: "P",
        apiHost: undefined,
        apiToken: "key",
      })!;
      return yield* body({ access, signedOut, relays, signIns }).pipe(
        Effect.provide(
          offboardingLayer.pipe(
            Layer.provide(
              Layer.mergeAll(
                ServerConfig.layer({ zerops: environment } as ServerConfig.ServerConfig["Service"]),
                Layer.succeed(
                  ZeropsProjectSigners,
                  ZeropsProjectSigners.of({
                    signers: Effect.succeed({ "claude-code": EVA }),
                    changes: Stream.fromPubSub(signIns),
                    hasProjectAccess: () => Ref.get(access),
                  } as unknown as ZeropsProjectSigners["Service"]),
                ),
                Layer.succeed(
                  ZeropsSignOut,
                  ZeropsSignOut.of({
                    signOut: (target: SignOutTarget) =>
                      Ref.update(signedOut, (all) => [...all, target]),
                  } as unknown as ZeropsSignOut["Service"]),
                ),
                Layer.succeed(
                  ZeropsMateAccessList,
                  ZeropsMateAccessList.of({
                    current: Effect.succeed(Option.none()),
                    reports: Stream.fromPubSub(relays).pipe(
                      Stream.map(() => ({
                        at: "2026-01-01T00:00:00.000Z",
                        openers: [],
                        listed: [],
                      })),
                    ),
                  } as unknown as ZeropsMateAccessList["Service"]),
                ),
              ),
            ),
          ),
        ),
      );
    }).pipe(Effect.scoped);

  it.effect("runs a pass at once when HQ relays a different answer", () =>
    loop(({ access, signedOut, relays }) =>
      Effect.gen(function* () {
        yield* ZeropsOffboarding;
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(yield* Ref.get(signedOut), []);
        yield* Ref.set(access, false);
        yield* PubSub.publish(relays, undefined);
        yield* TestClock.adjust(Duration.zero);
        assert.deepStrictEqual(yield* Ref.get(signedOut), [{ agentId: "claude-code" }]);
      }),
    ),
  );

  it.effect(
    "signs a signer who is no longer an opener out when a sign-in is recorded, and time alone signs nobody out",
    () =>
      loop(({ access, signedOut, signIns }) =>
        Effect.gen(function* () {
          yield* ZeropsOffboarding;
          yield* Ref.set(access, false);
          yield* TestClock.adjust(Duration.minutes(5));
          assert.deepStrictEqual(yield* Ref.get(signedOut), []);
          yield* PubSub.publish(signIns, undefined);
          yield* TestClock.adjust(Duration.zero);
          assert.deepStrictEqual(yield* Ref.get(signedOut), [{ agentId: "claude-code" }]);
        }),
      ),
  );
});

describe("ZeropsOffboarding after the access list goes stale", () => {
  const rig = <A>(
    initial: SignInRecords,
    body: (scene: {
      readonly answer: Ref.Ref<AccessRead>;
      readonly events: Queue.Queue<AccessLiveEvent>;
      readonly list: ZeropsMateAccessList["Service"];
      readonly signers: ZeropsProjectSigners["Service"];
      readonly signIns: SignInStore;
      readonly signedOut: Ref.Ref<ReadonlyArray<SignOutTarget>>;
    }) => Effect.Effect<A, never, ZeropsOffboarding>,
    beforeSignOut: (target: SignOutTarget) => Effect.Effect<void> = () => Effect.void,
  ) =>
    Effect.gen(function* () {
      const answer = yield* Ref.make<AccessRead>(
        sceneRead({ [EVA]: "BASIC_USER", [JAN]: "OWNER" }),
      );
      const events = yield* Queue.unbounded<AccessLiveEvent>();
      const list = yield* makeAccessList({
        projectId: "P",
        read: Ref.get(answer),
        live: () => Stream.fromQueue(events),
      });
      const signIns = yield* memorySignInStore(initial);
      const signedOut = yield* Ref.make<ReadonlyArray<SignOutTarget>>([]);
      const environment = resolveZeropsEnvironment({
        projectId: "P",
        apiHost: undefined,
        apiToken: "key",
      })!;
      const config = ServerConfig.layer({
        zerops: environment,
      } as ServerConfig.ServerConfig["Service"]);
      const signers = yield* makeProjectSigners.pipe(
        Effect.provide(
          Layer.mergeAll(
            config,
            Layer.succeed(ZeropsMateAccessList, list),
            Layer.succeed(ZeropsSignIns, signIns),
          ),
        ),
      );
      return yield* body({ answer, events, list, signers, signIns, signedOut }).pipe(
        Effect.provide(
          offboardingLayer.pipe(
            Layer.provide(
              Layer.mergeAll(
                config,
                Layer.succeed(ZeropsMateAccessList, list),
                Layer.succeed(ZeropsProjectSigners, signers),
                Layer.succeed(
                  ZeropsSignOut,
                  ZeropsSignOut.of({
                    signOut: (target: SignOutTarget) =>
                      Ref.update(signedOut, (all) => [...all, target]).pipe(
                        Effect.andThen(beforeSignOut(target)),
                        Effect.andThen(
                          signIns.clear("agentId" in target ? target.agentId : target.loginId),
                        ),
                      ),
                    remove: () => Effect.void,
                  }),
                ),
              ),
            ),
          ),
        ),
      );
    }).pipe(Effect.scoped);

  it.effect(
    "A person a Zerops frame removed is signed out even when the list's last read is older than its hold",
    () =>
      rig({ "claude-code": { by: EVA }, codex: { by: JAN } }, (scene) =>
        Effect.gen(function* () {
          yield* ZeropsOffboarding;
          yield* TestClock.adjust(Duration.zero);
          assert.isTrue(yield* scene.signers.hasProjectAccess(EVA));
          yield* Ref.set(scene.answer, { kind: "failed", reason: "unreachable" });
          yield* TestClock.adjust(Duration.minutes(16));
          assert.isUndefined(yield* scene.signers.hasProjectAccess(EVA));
          yield* scene.signIns.save("other-login", { by: "never-listed" });
          yield* TestClock.adjust(Duration.zero);
          assert.deepStrictEqual(yield* Ref.get(scene.signedOut), []);

          yield* Queue.offer(scene.events, {
            _tag: "frame",
            frame: { kind: "members", remove: [`cu-${EVA}`], upsert: [] },
          });
          yield* TestClock.adjust(Duration.zero);
          assert.deepStrictEqual(yield* Ref.get(scene.signedOut), [{ agentId: "claude-code" }]);
          assert.deepStrictEqual(yield* scene.signers.signers, {
            codex: JAN,
            "other-login": "never-listed",
          });
        }),
      ),
  );

  it.effect("The first successful read after a stale list runs an offboarding pass", () =>
    rig({}, (scene) =>
      Effect.gen(function* () {
        yield* ZeropsOffboarding;
        yield* TestClock.adjust(Duration.zero);
        yield* Ref.set(scene.answer, { kind: "failed", reason: "unreachable" });
        yield* TestClock.adjust(Duration.minutes(16));
        yield* Queue.offer(scene.events, {
          _tag: "frame",
          frame: { kind: "members", remove: [`cu-${EVA}`], upsert: [] },
        });
        yield* TestClock.adjust(Duration.zero);
        const before = Option.getOrThrow(yield* scene.list.current);
        yield* scene.signIns.save("claude-code", { by: EVA });
        yield* TestClock.adjust(Duration.zero);
        assert.isUndefined(yield* scene.signers.hasProjectAccess(EVA));
        assert.deepStrictEqual(yield* Ref.get(scene.signedOut), []);

        yield* Ref.set(scene.answer, sceneRead({ [JAN]: "OWNER" }));
        yield* scene.list.admits("nobody");
        yield* TestClock.adjust(Duration.zero);
        const after = Option.getOrThrow(yield* scene.list.current);
        assert.deepStrictEqual(after.members, before.members);
        assert.isAbove(after.readAtMs, before.readAtMs);
        assert.isFalse(yield* scene.signers.hasProjectAccess(EVA));
        assert.deepStrictEqual(yield* Ref.get(scene.signedOut), [{ agentId: "claude-code" }]);
      }),
    ),
  );

  it.effect(
    "A later grant is not undone by an earlier removal while another sign-out is in progress",
    () =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        yield* rig(
          { "claude-code": { by: EVA }, codex: { by: JAN } },
          (scene) =>
            Effect.gen(function* () {
              yield* ZeropsOffboarding;
              yield* TestClock.adjust(Duration.zero);
              yield* Ref.set(scene.answer, { kind: "failed", reason: "unreachable" });
              yield* TestClock.adjust(Duration.minutes(16));
              yield* Queue.offer(scene.events, {
                _tag: "frame",
                frame: { kind: "members", remove: [`cu-${EVA}`, `cu-${JAN}`], upsert: [] },
              });
              yield* Deferred.await(entered);
              const report = yield* Stream.runHead(scene.list.reports.pipe(Stream.drop(1))).pipe(
                Effect.forkChild,
              );
              yield* TestClock.adjust(Duration.zero);
              yield* Queue.offer(scene.events, {
                _tag: "frame",
                frame: {
                  kind: "members",
                  remove: [],
                  upsert: [
                    { clientUserId: `cu-${JAN}`, userId: JAN, orgRole: "OWNER", status: "ACTIVE" },
                  ],
                },
              });
              yield* Fiber.join(report);
              yield* Deferred.succeed(release, undefined);
              yield* TestClock.adjust(Duration.zero);
              assert.deepStrictEqual(yield* Ref.get(scene.signedOut), [{ agentId: "claude-code" }]);
              assert.deepStrictEqual(yield* scene.signers.signers, { codex: JAN });
            }),
          (target) =>
            "agentId" in target && target.agentId === "claude-code"
              ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
              : Effect.void,
        );
      }),
  );
});
