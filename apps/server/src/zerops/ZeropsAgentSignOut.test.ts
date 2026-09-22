import { assert, describe, it } from "@effect/vitest";
import type { ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import { ZeropsAgentFlagError } from "./ZeropsAgentFlag.ts";
import { make, type ZeropsAgentSignOutOptions } from "./ZeropsAgentSignOut.ts";

const TOKEN_AUTHORIZED_SNAPSHOT: ZeropsAgentAuthSnapshot = {
  available: true,
  agents: [
    {
      agentId: "claude-code",
      credPresent: true,
      flagOAuth: false,
      flagToken: true,
      providerAuth: "authenticated",
      state: "authorized-token",
    },
    {
      agentId: "codex",
      credPresent: false,
      flagOAuth: false,
      flagToken: false,
      providerAuth: "unknown",
      state: "not-authorized",
    },
  ],
};

const OAUTH_SNAPSHOT: ZeropsAgentAuthSnapshot = {
  available: true,
  agents: [
    {
      agentId: "claude-code",
      credPresent: true,
      flagOAuth: true,
      flagToken: false,
      providerAuth: "authenticated",
      state: "authorized",
    },
    {
      agentId: "codex",
      credPresent: false,
      flagOAuth: false,
      flagToken: false,
      providerAuth: "unknown",
      state: "not-authorized",
    },
  ],
};

interface Calls {
  readonly cancel: Ref.Ref<ReadonlyArray<string>>;
  readonly runLogout: Ref.Ref<ReadonlyArray<string>>;
  readonly credentialExists: Ref.Ref<ReadonlyArray<string>>;
  readonly removeCredential: Ref.Ref<ReadonlyArray<string>>;
  readonly clearSignedIn: Ref.Ref<ReadonlyArray<string>>;
  readonly recheckNow: Ref.Ref<ReadonlyArray<string>>;
  readonly invalidatePendingMark: Ref.Ref<ReadonlyArray<string>>;
}

const makeHarness = (input: {
  readonly snapshot?: ZeropsAgentAuthSnapshot;
  readonly cancelFails?: boolean;
  readonly logoutSucceeds?: boolean;
  readonly credentialStillExists?: boolean;
  readonly clearSignedInFails?: boolean;
}) =>
  Effect.gen(function* () {
    const calls: Calls = {
      cancel: yield* Ref.make<ReadonlyArray<string>>([]),
      runLogout: yield* Ref.make<ReadonlyArray<string>>([]),
      credentialExists: yield* Ref.make<ReadonlyArray<string>>([]),
      removeCredential: yield* Ref.make<ReadonlyArray<string>>([]),
      clearSignedIn: yield* Ref.make<ReadonlyArray<string>>([]),
      recheckNow: yield* Ref.make<ReadonlyArray<string>>([]),
      invalidatePendingMark: yield* Ref.make<ReadonlyArray<string>>([]),
    };
    const record = (ref: Ref.Ref<ReadonlyArray<string>>, agentId: string) =>
      Ref.update(ref, (all) => [...all, agentId]);

    const options: ZeropsAgentSignOutOptions = {
      zeropsAgentAuth: {
        latest: Effect.succeed(input.snapshot ?? OAUTH_SNAPSHOT),
        recheckNow: (agentId) => record(calls.recheckNow, agentId),
        invalidatePendingMark: (agentId) => record(calls.invalidatePendingMark, agentId),
      },
      zeropsAgentLogin: {
        cancel: (agentId) =>
          record(calls.cancel, agentId).pipe(
            Effect.andThen(
              input.cancelFails
                ? Effect.fail({ _tag: "TerminalError", message: "boom" } as never)
                : Effect.void,
            ),
          ),
      },
      zeropsAgentFlag: {
        clearSignedIn: (agentId) =>
          record(calls.clearSignedIn, agentId).pipe(
            Effect.andThen(
              input.clearSignedInFails
                ? Effect.fail(new ZeropsAgentFlagError({ reason: "down" }))
                : Effect.void,
            ),
          ),
      },
      runLogout: (agentId) =>
        record(calls.runLogout, agentId).pipe(Effect.as({ success: input.logoutSucceeds ?? true })),
      credentialExists: (agentId) =>
        record(calls.credentialExists, agentId).pipe(
          Effect.as(input.credentialStillExists ?? false),
        ),
      removeCredential: (agentId) => record(calls.removeCredential, agentId).pipe(Effect.asVoid),
      isZeropsEnvironment: true,
    };
    const service = yield* make(options);
    return { service, calls };
  });

describe("ZeropsAgentSignOut", () => {
  it.effect("fails with unavailable outside a Zerops environment, calling nothing", () =>
    Effect.gen(function* () {
      const called = yield* Ref.make(false);
      const service = yield* make({
        zeropsAgentAuth: {
          latest: Ref.set(called, true).pipe(Effect.as(OAUTH_SNAPSHOT)),
          recheckNow: () => Effect.void,
          invalidatePendingMark: () => Effect.void,
        },
        zeropsAgentLogin: { cancel: () => Effect.void },
        zeropsAgentFlag: { clearSignedIn: () => Effect.void },
        runLogout: () => Effect.succeed({ success: true }),
        credentialExists: () => Effect.succeed(false),
        removeCredential: () => Effect.void,
        isZeropsEnvironment: false,
      });
      const error = yield* Effect.flip(service.signOut("claude-code"));
      assert.strictEqual(error.reason, "unavailable");
      assert.isFalse(yield* Ref.get(called));
    }),
  );

  it.effect("refuses a token-authorized agent and calls nothing else", () =>
    Effect.gen(function* () {
      const { service, calls } = yield* makeHarness({ snapshot: TOKEN_AUTHORIZED_SNAPSHOT });
      const error = yield* Effect.flip(service.signOut("claude-code"));
      assert.strictEqual(error.reason, "token-authorized");
      assert.deepStrictEqual(yield* Ref.get(calls.cancel), []);
      assert.deepStrictEqual(yield* Ref.get(calls.runLogout), []);
      assert.deepStrictEqual(yield* Ref.get(calls.clearSignedIn), []);
      assert.deepStrictEqual(yield* Ref.get(calls.recheckNow), []);
      assert.deepStrictEqual(yield* Ref.get(calls.invalidatePendingMark), []);
    }),
  );

  it.effect("runs the full sequence for an oauth-authorized agent", () =>
    Effect.gen(function* () {
      const { service, calls } = yield* makeHarness({});
      yield* service.signOut("claude-code");
      assert.deepStrictEqual(yield* Ref.get(calls.cancel), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.runLogout), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.clearSignedIn), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.recheckNow), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.invalidatePendingMark), ["claude-code"]);
    }),
  );

  it.effect("skips removeCredential when logout succeeded and the credential is already gone", () =>
    Effect.gen(function* () {
      const { service, calls } = yield* makeHarness({
        logoutSucceeds: true,
        credentialStillExists: false,
      });
      yield* service.signOut("claude-code");
      assert.deepStrictEqual(yield* Ref.get(calls.credentialExists), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.removeCredential), []);
    }),
  );

  it.effect("removes the credential file when logout succeeded but it is still there", () =>
    Effect.gen(function* () {
      const { service, calls } = yield* makeHarness({
        logoutSucceeds: true,
        credentialStillExists: true,
      });
      yield* service.signOut("claude-code");
      assert.deepStrictEqual(yield* Ref.get(calls.removeCredential), ["claude-code"]);
    }),
  );

  it.effect(
    "removes the credential file when logout failed, without checking existence first",
    () =>
      Effect.gen(function* () {
        const { service, calls } = yield* makeHarness({ logoutSucceeds: false });
        yield* service.signOut("claude-code");
        assert.deepStrictEqual(yield* Ref.get(calls.credentialExists), []);
        assert.deepStrictEqual(yield* Ref.get(calls.removeCredential), ["claude-code"]);
      }),
  );

  it.effect("is best-effort: a failing cancel does not stop the rest of the sequence", () =>
    Effect.gen(function* () {
      const { service, calls } = yield* makeHarness({ cancelFails: true });
      yield* service.signOut("claude-code");
      assert.deepStrictEqual(yield* Ref.get(calls.cancel), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.clearSignedIn), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.recheckNow), ["claude-code"]);
    }),
  );

  it.effect("is best-effort: a failing clearSignedIn still reaches recheckNow", () =>
    Effect.gen(function* () {
      const { service, calls } = yield* makeHarness({ clearSignedInFails: true });
      yield* service.signOut("claude-code");
      assert.deepStrictEqual(yield* Ref.get(calls.clearSignedIn), ["claude-code"]);
      assert.deepStrictEqual(yield* Ref.get(calls.recheckNow), ["claude-code"]);
    }),
  );
});
