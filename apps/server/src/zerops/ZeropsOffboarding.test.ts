import { ZeropsUserId } from "@t3tools/contracts";
import { assert, describe, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerConfig from "../config.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import type { MateLogin } from "./ZeropsLogins.ts";
import {
  layer as offboardingLayer,
  make as makeOffboarding,
  ZeropsOffboarding,
} from "./ZeropsOffboarding.ts";
import * as ZeropsMateOwnerModule from "./ZeropsMateOwner.ts";
import type { MateOwner } from "./ZeropsMateOwner.ts";
import { ZeropsProjectSigners } from "./ZeropsProjectSigners.ts";
import { type SignerStandings, ZeropsSignerStanding } from "./ZeropsSignerStanding.ts";
import {
  make as makeSignOut,
  type SignOutTarget,
  stopSessionsOnEngine,
  ZeropsSignOut,
} from "./ZeropsSignOut.ts";

const EVA = ZeropsUserId.make("eva-user-id");
const JAN = ZeropsUserId.make("jan-user-id");

const WORK: MateLogin = {
  id: "claudeAgent-work",
  agent: "claude-code",
  kind: "subscription",
  label: "work",
  home: "/home/zerops/.mate/logins/claudeAgent-work",
  keyStored: false,
};

/** Each person's signer standing as HQ worded it: `true` is `may`, `false` is `no_access`. */
const standingsOf = (access: Readonly<Record<string, boolean | undefined>>): SignerStandings =>
  Object.fromEntries(
    Object.entries(access).flatMap(([userId, opens]) =>
      opens === undefined ? [] : [[userId, opens ? "may" : "no_access"] as const],
    ),
  );

/**
 * Offboarding over the real sign-out: Eva signed in Claude Code's own login and the `work` login,
 * Jan Codex; a live session runs on each of Eva's. `access` is the signer standing HQ was heard
 * answering (`true` is `may`, `false` is `no_access`, absent is no verdict), `owner` whom HQ names
 * the Mate's owner.
 */
const offboarding = (
  access: Readonly<Record<string, boolean | undefined>>,
  owner: Effect.Effect<MateOwner> = Effect.succeed(undefined),
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
      owner,
      signOut: signOut.signOut,
      takeHeard: Effect.succeed(standingsOf(access)),
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

// Decision: When the Mate's owner changes, the Mate signs out every provider login whose signer
// is not the new owner and ends the running agent, through the existing offboarding path. The
// owner is HQ's record (Karel, 2026-11-07: "musime drzet informaci o vlastnikovi v hq").
describe("ZeropsOffboarding, when the Mate changes hands", () => {
  it.effect(
    "an owner change HQ names signs out every login whose signer is not the new owner, the old owner's access kept",
    () =>
      Effect.gen(function* () {
        const owner = yield* Ref.make<MateOwner>(undefined);
        const { service, stopped, steps } = yield* offboarding(
          { [EVA]: true, [JAN]: true },
          Ref.get(owner),
        );
        // HQ has not said yet, then names an owner: what it starts from, nobody signed out.
        assert.strictEqual(yield* service.checkNow, 0);
        yield* Ref.set(owner, EVA);
        assert.strictEqual(yield* service.checkNow, 0);
        assert.strictEqual(yield* service.checkNow, 0);
        // Eva hands the Mate to Jan: Eva keeps her access (her organization role), not her logins.
        yield* Ref.set(owner, JAN);
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

// HQ answering a different signer standing signs a person who lost access out now, not at the
// next role recheck.
describe("ZeropsOffboarding's loop", () => {
  /**
   * The layer's loop over Eva's Claude Code login: `access` is her signer standing as HQ answers
   * it, heard when HQ relays it and when a sign-in has the loop ask; both feeds fire.
   */
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
      const heard = yield* PubSub.unbounded<SignerStandings>();
      const answer = Effect.map(Ref.get(access), (opens) => standingsOf({ [EVA]: opens }));
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
                ZeropsMateOwnerModule.layer,
                Layer.succeed(
                  ZeropsProjectSigners,
                  ZeropsProjectSigners.of({
                    signers: Effect.succeed({ "claude-code": EVA }),
                    changes: Stream.fromPubSub(signIns),
                  } as unknown as ZeropsProjectSigners["Service"]),
                ),
                Layer.succeed(
                  ZeropsSignerStanding,
                  ZeropsSignerStanding.of({
                    standing: (userId) =>
                      answer.pipe(
                        Effect.tap((standings) => PubSub.publish(heard, standings)),
                        Effect.map((standings) => standings[userId]),
                      ),
                    heard: Stream.merge(
                      Stream.fromPubSub(relays).pipe(Stream.mapEffect(() => answer)),
                      Stream.fromPubSub(heard),
                    ),
                  }),
                ),
                Layer.succeed(
                  ZeropsSignOut,
                  ZeropsSignOut.of({
                    signOut: (target: SignOutTarget) =>
                      Ref.update(signedOut, (all) => [...all, target]),
                  } as unknown as ZeropsSignOut["Service"]),
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
