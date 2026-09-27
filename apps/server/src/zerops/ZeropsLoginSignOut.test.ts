import { assert, describe, it } from "@effect/vitest";
import { ThreadId, type OrchestrationThreadShell } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import type { MateLogin } from "./ZeropsLogins.ts";
import { make, threadsToStopForLogin } from "./ZeropsLoginSignOut.ts";

const WORK: MateLogin = {
  id: "claudeAgent-work",
  agent: "claude-code",
  kind: "subscription",
  label: "work",
  home: "/home/zerops/.mate/logins/claudeAgent-work",
  keyStored: false,
};

const KEY: MateLogin = {
  id: "claudeAgent-api-key",
  agent: "claude-code",
  kind: "apiKey",
  label: "",
  home: "/home/zerops/.mate/logins/claudeAgent-api-key",
  keyStored: true,
};

const makeHarness = (input: { readonly logout?: boolean; readonly credentialLeft?: boolean }) =>
  Effect.gen(function* () {
    const order = yield* Ref.make<ReadonlyArray<string>>([]);
    const step = (label: string) => Ref.update(order, (all) => [...all, label]);
    const service = yield* make({
      isZeropsEnvironment: true,
      zeropsLogins: {
        resolve: (id) => Effect.succeed([WORK, KEY].find((login) => login.id === id)),
        recheckNow: (id) => step(`recheck:${id}`),
        forget: (id) => step(`forget:${id}`),
      },
      zeropsAgentLogin: {
        cancel: (agentId, loginId) => step(`cancel:${agentId}:${loginId}`),
      },
      runLogout: (login) =>
        step(`logout:${login.id}`).pipe(Effect.as({ success: input.logout ?? true })),
      credentialExists: (path) =>
        step(`exists:${path}`).pipe(Effect.as(input.credentialLeft ?? false)),
      removeCredential: (path) => step(`remove:${path}`),
    });
    return { order, service, stop: step("stop") };
  });

describe("ZeropsLoginSignOut", () => {
  it.effect("signs a login out: its walker, its sessions, its CLI, then its own check", () =>
    Effect.gen(function* () {
      const { order, service, stop } = yield* makeHarness({});
      yield* service.signOut(WORK.id, () => stop);
      assert.deepStrictEqual(yield* Ref.get(order), [
        `cancel:claude-code:${WORK.id}`,
        "stop",
        `logout:${WORK.id}`,
        `exists:${WORK.home}/.credentials.json`,
        `recheck:${WORK.id}`,
      ]);
    }),
  );

  it.effect("removes the credential itself when the CLI's logout leaves it or fails", () =>
    Effect.gen(function* () {
      for (const input of [{ credentialLeft: true }, { logout: false }]) {
        const { order, service, stop } = yield* makeHarness(input);
        yield* service.signOut(WORK.id, () => stop);
        assert.include([...(yield* Ref.get(order))], `remove:${WORK.home}/.credentials.json`);
      }
    }),
  );

  it.effect("refuses to sign out an API key — it is removed, not signed out", () =>
    Effect.gen(function* () {
      const { order, service, stop } = yield* makeHarness({});
      const refused = yield* Effect.flip(service.signOut(KEY.id, () => stop));
      assert.strictEqual(refused.reason, "invalid-login");
      assert.deepStrictEqual(yield* Ref.get(order), []);
    }),
  );

  it.effect("removes a login: signed out first, then forgotten", () =>
    Effect.gen(function* () {
      const { order, service, stop } = yield* makeHarness({});
      yield* service.remove(WORK.id, () => stop);
      assert.deepStrictEqual((yield* Ref.get(order)).at(-1), `forget:${WORK.id}`);
      assert.include([...(yield* Ref.get(order))], `logout:${WORK.id}`);
    }),
  );

  it.effect("removes an API key without a CLI to ask", () =>
    Effect.gen(function* () {
      const { order, service, stop } = yield* makeHarness({});
      yield* service.remove(KEY.id, () => stop);
      assert.deepStrictEqual(yield* Ref.get(order), ["stop", `forget:${KEY.id}`]);
    }),
  );

  it.effect("refuses a login it does not know, and a default one", () =>
    Effect.gen(function* () {
      const { service, stop } = yield* makeHarness({});
      assert.strictEqual(
        (yield* Effect.flip(service.signOut("codex-gone", () => stop))).reason,
        "unknown-login",
      );
      assert.strictEqual(
        (yield* Effect.flip(service.remove("claudeAgent", () => stop))).reason,
        "default-login",
      );
    }),
  );
});

describe("threadsToStopForLogin", () => {
  const thread = (
    id: string,
    instanceId: string,
    session: { readonly providerInstanceId?: string; readonly status: string } | null,
  ) =>
    ({
      id: ThreadId.make(id),
      modelSelection: { instanceId, model: "m" },
      session,
    }) as unknown as OrchestrationThreadShell;

  it("stops the live sessions running on that login, and no other", () => {
    assert.deepStrictEqual(
      threadsToStopForLogin(
        [
          thread("a", "claudeAgent-work", {
            providerInstanceId: "claudeAgent-work",
            status: "running",
          }),
          thread("b", "claudeAgent", { providerInstanceId: "claudeAgent", status: "running" }),
          thread("c", "claudeAgent-work", {
            providerInstanceId: "claudeAgent-work",
            status: "stopped",
          }),
          thread("d", "claudeAgent-work", null),
          // Repointed at the default while its session still runs on the login.
          thread("e", "claudeAgent", { providerInstanceId: "claudeAgent-work", status: "ready" }),
        ],
        "claudeAgent-work",
      ),
      ["a", "e"].map((id) => ThreadId.make(id)),
    );
  });
});
