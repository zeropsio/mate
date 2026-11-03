import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import type {
  TerminalAttachStreamEvent,
  TerminalSessionSnapshot,
  ZeropsAgentLoginState,
} from "@t3tools/contracts";
import type { KeyLinkAccess, LinkAccessMember } from "@t3tools/shared/mateLink";
import { loginTurnRefusal, turnRefusal } from "@t3tools/shared/zeropsAgentAuth";

import * as ServerConfig from "../config.ts";
import { make as makeAgentLogin } from "./ZeropsAgentLogin.ts";
import { ZEROPS_SUBJECT_PREFIX } from "./zeropsSubject.ts";
import { makeLoginHomes } from "./zeropsLoginHomes.ts";
import {
  fileSignInStore,
  memorySignInStore,
  signInsPath,
  ZeropsSignIns,
  type SignInRecords,
  type SignInStore,
} from "./zeropsSignIns.ts";
import { resolveZeropsEnvironment } from "./ZeropsEnvironment.ts";
import * as ZeropsMateAccessListModule from "./ZeropsMateAccessList.ts";
import {
  isTurnStartingCommand,
  make as makeProjectSigners,
  SIGN_IN_CHECK_WAIT,
} from "./ZeropsProjectSigners.ts";

const JAN = "jan-user-id";
const EVA = "eva-user-id";

describe("turnRefusal", () => {
  const signedIn = {
    state: "authorized",
    providerAuth: "authenticated",
    credPresent: true,
    flagToken: false,
  } as const;
  const tokenAgent = {
    state: "authorized-token",
    providerAuth: "unknown",
    credPresent: false,
    flagToken: true,
  } as const;
  // Is the agent signed in at all, then whose is it: mine / someone else's /
  // unrecorded / a token agent.
  it.each(
    Array.from(
      [
        ["my own agent", { agent: signedIn, signer: JAN, subject: JAN }, undefined],
        [
          "an agent somebody else signed in",
          { agent: signedIn, signer: EVA, subject: JAN },
          { kind: "someone-else" },
        ],
        // D6 keeps no backward compatibility: an older login, a terminal login or
        // a copied credential file runs for nobody until someone signs in here.
        [
          "an agent nobody's sign-in was recorded for",
          { agent: signedIn, signer: undefined, subject: JAN },
          { kind: "unrecorded" },
        ],
        [
          "an agent whose recorded signer is blank",
          { agent: signedIn, signer: "", subject: JAN },
          { kind: "unrecorded" },
        ],
        [
          "a caller the session could not name",
          { agent: signedIn, signer: JAN, subject: undefined },
          { kind: "someone-else" },
        ],
        // An API key belongs to the project, not to a person.
        [
          "a token-authorized agent somebody else signed in",
          { agent: tokenAgent, signer: EVA, subject: JAN },
          undefined,
        ],
        [
          "a token-authorized agent with no record at all",
          { agent: tokenAgent, signer: undefined, subject: JAN },
          undefined,
        ],
        // Signed in inside the container, the project flag seconds away: the CLI
        // works, so only whose it is decides.
        [
          "my agent still being registered",
          {
            agent: { ...signedIn, state: "local-only" },
            signer: JAN,
            subject: JAN,
          },
          undefined,
        ],
        // Not signed in is refused before anything else: the turn would only fail
        // inside the agent CLI.
        [
          "an agent nobody signed in",
          {
            agent: {
              state: "not-authorized",
              providerAuth: "unauthenticated",
              credPresent: false,
              flagToken: false,
            },
            signer: undefined,
            subject: JAN,
          },
          { kind: "not-signed-in", auth: "not-authorized" },
        ],
        [
          "an agent the project signed in but this container has no login for",
          {
            agent: { ...signedIn, credPresent: false, state: "reconnect" },
            signer: JAN,
            subject: JAN,
          },
          { kind: "not-signed-in", auth: "reconnect" },
        ],
        [
          "an agent whose own check says its login no longer works",
          {
            agent: { ...signedIn, providerAuth: "unauthenticated" },
            signer: JAN,
            subject: JAN,
          },
          { kind: "not-signed-in", auth: "needs-reauth" },
        ],
      ] as const,
      ([name, input, refusal]) => ({
        title: `${refusal === undefined ? "allows" : "refuses"} a turn on ${name}`,
        input,
        refusal,
      }),
    ),
  )("$title", ({ input, refusal }) => {
    assert.deepStrictEqual(turnRefusal(input), refusal);
  });
});

// A login other than the defaults has no platform flag: its state is its own
// check's answer, and its signer is its own.
describe("loginTurnRefusal", () => {
  it.each(
    Array.from(
      [
        [
          "my own login",
          { state: "authorized", token: false, signer: JAN, subject: JAN },
          undefined,
        ],
        [
          "a login a teammate signed in",
          { state: "authorized", token: false, signer: EVA, subject: JAN },
          { kind: "someone-else" },
        ],
        [
          "a login nobody's sign-in was recorded for",
          { state: "authorized", token: false, signer: undefined, subject: JAN },
          { kind: "unrecorded" },
        ],
        [
          "my login its own check has not answered for yet",
          { state: "registering", token: false, signer: JAN, subject: JAN },
          undefined,
        ],
        [
          "a login nobody signed in",
          { state: "not-authorized", token: false, signer: JAN, subject: JAN },
          { kind: "not-signed-in", auth: "not-authorized" },
        ],
        [
          "a project token somebody else set",
          { state: "authorized", token: true, signer: EVA, subject: JAN },
          undefined,
        ],
      ] as const,
      ([name, input, refusal]) => ({
        title: `${refusal === undefined ? "allows" : "refuses"} a turn on ${name}`,
        input,
        refusal,
      }),
    ),
  )("$title", ({ input, refusal }) => {
    assert.deepStrictEqual(loginTurnRefusal(input), refusal);
  });
});

describe("isTurnStartingCommand", () => {
  it("gates the command that starts a turn", () => {
    assert.isTrue(isTurnStartingCommand({ type: "thread.turn.start" }));
  });

  // The decider turns an answer to a message-mode question into a turn of its
  // own; an answer to a native callback question continues the running turn.
  const respond = { type: "thread.user-input.respond" };
  it.each(
    Array.from(
      [
        [
          "gates an answer to a pending message-mode question",
          { kind: "user-input.requested", payload: { responseMode: "message", questions: [] } },
          true,
        ],
        [
          "leaves an answer to a native callback question to every member",
          { kind: "user-input.requested", payload: { questions: [] } },
          false,
        ],
        [
          "leaves an answer to a message-mode question already resolved",
          { kind: "user-input.resolved", payload: { responseMode: "message" } },
          false,
        ],
        ["leaves an answer to a question it cannot find", undefined, false],
      ] as const,
      ([name, request, expected]) => ({ title: name, request, expected }),
    ),
  )("$title", ({ request, expected }) => {
    assert.strictEqual(isTurnStartingCommand(respond, request), expected);
  });

  // Everything else stays open to every member who can open the Mate: a
  // colleague must be able to stop an agent they are not allowed to start.
  it.each(
    Array.from(
      [
        "thread.turn.interrupt",
        "thread.session.stop",
        "thread.archive",
        "thread.settle",
        "thread.create",
        "thread.meta.update",
        "project.create",
      ],
      (type) => ({ title: `leaves ${type} to every member`, type }),
    ),
  )("$title", ({ type }) => {
    assert.isFalse(isTurnStartingCommand({ type }));
  });
});

const environment = resolveZeropsEnvironment({
  projectId: "TEST000000000000000023",
  apiHost: undefined,
  apiToken: "the-mates-own-zerops-key",
})!;

describe("the turn gate", () => {
  const signedIn = {
    state: "authorized",
    providerAuth: "authenticated",
    credPresent: true,
    flagToken: false,
  } as const;

  /**
   * The service over the sign-ins this server saw. HQ has sent no access list, so the leave check
   * never signs anybody out.
   */
  const gateOver = (signIns: SignInStore) =>
    Effect.gen(function* () {
      const signers = yield* makeProjectSigners.pipe(
        Effect.provide(
          Layer.mergeAll(
            ZeropsMateAccessListModule.layer,
            ServerConfig.layer({ zerops: environment } as ServerConfig.ServerConfig["Service"]),
            NodeServices.layer,
            Layer.succeed(ZeropsSignIns, signIns),
          ),
        ),
      );
      yield* TestClock.adjust(Duration.zero);
      return { signers, signIns };
    });
  const gate = (kept: SignInRecords = {}) => memorySignInStore(kept).pipe(Effect.flatMap(gateOver));
  const by = (userId: string) => ({ by: userId, at: 1 });
  /** A login whose code is being checked, started by `startedBy`. */
  const checking = (startedBy: string) =>
    Effect.gen(function* () {
      const now = yield* DateTime.now;
      return yield* Ref.make<ZeropsAgentLoginState>({
        phase: "verifying-code",
        terminalId: "t",
        startedAt: now,
        startedBy,
      });
    });

  it.effect("goes by who this server saw sign the login in, and nobody else", () =>
    Effect.gen(function* () {
      const { signers } = yield* gate({ "claude-code": by(JAN) });
      const on = (agentId: "claude-code" | "codex", subject: string) =>
        signers.turnRefusal({ agentId, agent: signedIn, subject });

      assert.isUndefined(yield* on("claude-code", JAN));
      assert.deepStrictEqual(yield* on("claude-code", EVA), { kind: "someone-else" });
      // D6 keeps no backward compatibility: a login with nothing kept — signed in before this
      // record existed, from a terminal, or copied in — runs for nobody until signed in here.
      assert.deepStrictEqual(yield* on("codex", JAN), { kind: "unrecorded" });
    }).pipe(Effect.scoped),
  );

  it.effect("another login is gated on its own signer, never its agent's", () =>
    Effect.gen(function* () {
      const { signers } = yield* gate({ "claude-code": by(JAN), "claudeAgent-work": by(EVA) });
      const onWork = (subject: string) =>
        signers.loginRefusal({
          key: "claudeAgent-work",
          state: "authorized",
          token: false,
          subject,
        });

      assert.deepStrictEqual(yield* onWork(JAN), { kind: "someone-else" });
      assert.isUndefined(yield* onWork(EVA));
    }).pipe(Effect.scoped),
  );

  // Eva signed in last; Jan's code is being checked, his credential already written over hers.
  // Her turn would run on his credential: it waits for his sign-in to settle, then goes by it.
  it.effect.each(
    Array.from(
      [
        ["his sign-in succeeds: refused", true, { kind: "someone-else" }],
        ["his sign-in fails: hers again", false, undefined],
      ] as const,
      ([name, succeeds, expected]) => ({
        title: `the signer's turn waits while somebody else's code is checked — ${name}`,
        succeeds,
        expected,
      }),
    ),
  )("$title", ({ succeeds, expected }) =>
    Effect.gen(function* () {
      const { signers, signIns } = yield* gate({ "claude-code": by(EVA) });
      const login = yield* checking(JAN);
      const fiber = yield* signers
        .turnRefusal({
          agentId: "claude-code",
          agent: signedIn,
          subject: EVA,
          login: yield* Ref.get(login),
          currentLogin: Ref.get(login),
        })
        .pipe(Effect.forkChild);
      yield* TestClock.adjust(Duration.seconds(2));
      assert.isUndefined(fiber.pollUnsafe(), "held while the code is checked");
      // As the walker settles it: a success is kept before anything else hears of it.
      if (succeeds) yield* signIns.save("claude-code", by(JAN));
      yield* Ref.update(login, (current) => ({
        ...current,
        phase: succeeds ? ("succeeded" as const) : ("failed" as const),
      }));
      yield* TestClock.adjust(Duration.seconds(2));

      assert.deepStrictEqual(yield* Fiber.join(fiber), expected);
    }).pipe(Effect.scoped),
  );

  // A live run (2026-10-01): Claude writes its credential before it prints its success line, so
  // the agent reads signed in while its login still checks the code — and the stand-up left
  // then. A turn of the very person whose sign-in is under way waits for it to settle.
  it.effect("a turn sent while its own person's code is still checked waits for the sign-in", () =>
    Effect.gen(function* () {
      const { signers, signIns } = yield* gate({ "claude-code": by(EVA) });
      const login = yield* checking(JAN);
      const fiber = yield* signers
        .turnRefusal({
          agentId: "claude-code",
          agent: { ...signedIn, state: "local-only", providerAuth: "unknown" },
          subject: JAN,
          login: yield* Ref.get(login),
          currentLogin: Ref.get(login),
        })
        .pipe(Effect.forkChild);
      yield* TestClock.adjust(Duration.seconds(2));
      assert.isUndefined(fiber.pollUnsafe(), "held while the code is checked");
      yield* signIns.save("claude-code", by(JAN));
      yield* Ref.update(login, (current) => ({ ...current, phase: "succeeded" as const }));
      yield* TestClock.adjust(Duration.seconds(2));

      assert.isUndefined(yield* Fiber.join(fiber));
    }).pipe(Effect.scoped),
  );

  // A check whose outcome cannot change the answer holds nobody.
  it.effect.each(
    Array.from(
      [
        ["the signer's own re-sign-in", JAN, JAN, signedIn, undefined],
        ["a third person's turn", EVA, "ida-user-id", signedIn, { kind: "someone-else" }],
        [
          "a turn nobody could be named for",
          undefined,
          undefined,
          signedIn,
          { kind: "unrecorded" },
        ],
        [
          "a turn on a project token, nobody's login",
          EVA,
          EVA,
          { ...signedIn, state: "authorized-token", flagToken: true },
          undefined,
        ],
        [
          "a turn on an agent that is not signed in",
          EVA,
          EVA,
          { ...signedIn, state: "not-authorized", credPresent: false },
          { kind: "not-signed-in", auth: "not-authorized" },
        ],
      ] as const,
      ([name, kept, subject, agent, expected]) => ({
        title: `a code being checked holds no turn it cannot decide — ${name}`,
        kept,
        subject,
        agent,
        expected,
      }),
    ),
  )("$title", ({ kept, subject, agent, expected }) =>
    Effect.gen(function* () {
      const { signers } = yield* gate(kept === undefined ? {} : { "claude-code": by(kept) });
      const login = yield* Ref.get(yield* checking(JAN));
      const fiber = yield* signers
        .turnRefusal({
          agentId: "claude-code",
          agent,
          subject,
          login,
          currentLogin: Effect.succeed(login),
        })
        .pipe(Effect.forkChild);
      yield* TestClock.adjust(Duration.zero);

      assert.strictEqual(fiber.pollUnsafe()?._tag, "Success", "answered at once");
      assert.deepStrictEqual(yield* Fiber.join(fiber), expected);
    }).pipe(Effect.scoped),
  );

  // A login left at its menu, its page or its code prompt has written nothing: no turn waits on
  // an abandoned sign-in.
  it.effect.each(
    Array.from(["menu", "awaiting-browser", "awaiting-code", "failed"] as const, (phase) => ({
      title: `a sign-in at ${phase} makes no turn wait`,
      phase,
    })),
  )("$title", ({ phase }) =>
    Effect.gen(function* () {
      const { signers } = yield* gate({ "claude-code": by(EVA) });
      const login = { ...(yield* Ref.get(yield* checking(JAN))), phase };
      const fiber = yield* signers
        .turnRefusal({
          agentId: "claude-code",
          agent: signedIn,
          subject: JAN,
          login,
          currentLogin: Effect.succeed(login),
        })
        .pipe(Effect.forkChild);
      yield* TestClock.adjust(Duration.zero);

      assert.strictEqual(fiber.pollUnsafe()?._tag, "Success", "answered at once");
      assert.deepStrictEqual(yield* Fiber.join(fiber), { kind: "someone-else" });
    }).pipe(Effect.scoped),
  );

  // A check that never settles leaves the credential's owner unknown: once the wait is over,
  // nobody's turn runs on it.
  it.effect.each(
    Array.from(
      [
        ["the signer's", EVA],
        ["the checked person's", JAN],
      ] as const,
      ([name, subject]) => ({
        title: `a check that never settles refuses ${name} turn once the wait is over`,
        subject,
      }),
    ),
  )("$title", ({ subject }) =>
    Effect.gen(function* () {
      const { signers } = yield* gate({ "claude-code": by(EVA) });
      const login = yield* Ref.get(yield* checking(JAN));
      const fiber = yield* signers
        .turnRefusal({
          agentId: "claude-code",
          agent: signedIn,
          subject,
          login,
          currentLogin: Effect.succeed(login),
        })
        .pipe(Effect.forkChild);
      yield* TestClock.adjust(SIGN_IN_CHECK_WAIT);
      yield* TestClock.adjust(Duration.seconds(1));

      assert.deepStrictEqual(yield* Fiber.join(fiber), { kind: "someone-else" });
    }).pipe(Effect.scoped),
  );

  // Eva signs in; the server restarts. The credential is still Eva's — it lives on under the
  // home — and so does who signed it in.
  describe("across a restart", () => {
    const terminal = () => {
      const listeners = new Map<
        string,
        (event: TerminalAttachStreamEvent) => Effect.Effect<void>
      >();
      const manager = {
        open: () => Effect.succeed({} as TerminalSessionSnapshot),
        write: () => Effect.void,
        close: () => Effect.void,
        attachStream: (
          input: { readonly terminalId: string },
          listener: (event: TerminalAttachStreamEvent) => Effect.Effect<void>,
        ) =>
          Effect.sync(() => {
            listeners.set(input.terminalId, listener);
            return () => listeners.delete(input.terminalId);
          }),
      } as unknown as Parameters<typeof makeAgentLogin>[0]["terminalManager"];
      const succeed = (terminalId: string) =>
        listeners.get(terminalId)?.({
          type: "output",
          threadId: "thread-1",
          terminalId,
          data: "Login successful. Press Enter to continue…\n",
        }) ?? Effect.void;
      return { manager, succeed };
    };

    it.effect("who signed a login in here outlives a restart", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const home = yield* fs.makeTempDirectoryScoped({ prefix: "mate-sign-ins-" });
        const file = signInsPath(path, home);

        yield* Effect.scoped(
          Effect.gen(function* () {
            const { manager, succeed } = terminal();
            const logins = yield* makeAgentLogin({
              terminalManager: manager,
              zeropsAgentAuth: { recheckNow: () => Effect.void },
              isZeropsEnvironment: true,
              homes: yield* makeLoginHomes(home),
              signIns: yield* fileSignInStore(file),
            });
            yield* logins.start("claude-code", "thread-1", `${ZEROPS_SUBJECT_PREFIX}${EVA}`);
            // The CLI signs in in its scratch home.
            yield* fs.writeFileString(`${home}/.mate/pending/claude-code/.credentials.json`, "{}");
            yield* succeed("agent-login-claude-code");
          }),
        );

        const { signers } = yield* gateOver(yield* fileSignInStore(file));
        const on = (subject: string) =>
          signers.turnRefusal({ agentId: "claude-code", agent: signedIn, subject });

        assert.isUndefined(yield* on(EVA));
        assert.deepStrictEqual(yield* on(JAN), { kind: "someone-else" });
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
    );
  });
});

// X3, D7: a turn no live session stands behind — the crew's, the stand-up's — is admitted by the
// same answer that keeps a session open: HQ's access list, by the person's entry in it.
describe("hasProjectAccess", () => {
  /** The service over HQ's access list, whose frames the test sends. */
  const access = Effect.gen(function* () {
    const signIns = yield* memorySignInStore();
    const { signers, list } = yield* Effect.all({
      signers: makeProjectSigners,
      list: ZeropsMateAccessListModule.ZeropsMateAccessList,
    }).pipe(
      Effect.provide(
        ZeropsMateAccessListModule.layer.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              ServerConfig.layer({ zerops: environment } as ServerConfig.ServerConfig["Service"]),
              NodeServices.layer,
              Layer.succeed(ZeropsSignIns, signIns),
            ),
          ),
        ),
      ),
    );
    let version = 0;
    /** HQ's full list, naming `members`. */
    const listed = (members: KeyLinkAccess["members"]) =>
      list.heard({ type: "access", version: ++version, viewAt: AT, full: true, members });
    return { signers, list, listed };
  });
  const AT = "2026-10-24T10:00:00.000Z";
  const entry = (userId: string, role: LinkAccessMember["role"], visibility: "open" | "listed") =>
    ({ userId, role, visibility }) as const;

  it.effect.each(
    Array.from(
      [
        ["an org member who builds", [entry(JAN, "BASIC_USER", "open")], true],
        // Kept in the org, taken out of this project: their crew stops with their session (X3).
        ["an org member this project shuts out", [], false],
        ["a member let in here alone", [entry(JAN, "BASIC_USER", "open")], true],
        ["a read-only member", [entry(JAN, "READ_ONLY", "listed")], false],
        ["an admin who is not active", [], false],
      ] as const,
      ([name, entries, expected]) => ({
        title: `answers by this project's door: ${name}, ${String(expected)}`,
        entries,
        expected,
      }),
    ),
  )("$title", ({ entries, expected }) =>
    Effect.gen(function* () {
      const { signers, listed } = yield* access;
      yield* listed([...entries, entry(EVA, "OWNER", "open")]);
      assert.strictEqual(yield* signers.hasProjectAccess(JAN), expected);
    }),
  );

  it.effect("answers from HQ's relay while it holds, reading nothing of Zerops", () =>
    Effect.gen(function* () {
      // Nothing of Zerops is provided: the list is the only answer.
      const { signers, listed } = yield* access;
      yield* listed([entry(JAN, "BASIC_USER", "open"), entry(EVA, "READ_ONLY", "listed")]);
      assert.isTrue(yield* signers.hasProjectAccess(JAN));
      assert.isFalse(yield* signers.hasProjectAccess(EVA));
    }),
  );

  it.effect("answers no for somebody the org does not list", () =>
    Effect.gen(function* () {
      const { signers, listed } = yield* access;
      yield* listed([entry(EVA, "OWNER", "open")]);
      assert.isFalse(yield* signers.hasProjectAccess(JAN));
    }),
  );

  // Answering no would sign every signer's logins out (`ZeropsOffboarding`); running work goes on.
  it.effect(
    "vouches for nobody while HQ says the organisation's key was refused, and takes nobody's access",
    () =>
      Effect.gen(function* () {
        const { signers, list, listed } = yield* access;
        yield* listed([entry(JAN, "BASIC_USER", "open")]);
        yield* list.heard({ type: "access", version: 9, full: true, refused: true, members: [] });
        assert.isUndefined(yield* signers.hasProjectAccess(JAN));
        yield* listed([entry(JAN, "BASIC_USER", "open")]);
        assert.isTrue(yield* signers.hasProjectAccess(JAN));
      }),
  );

  it.effect("answers nothing when nothing could be read", () =>
    Effect.gen(function* () {
      const { signers } = yield* access;
      assert.isUndefined(yield* signers.hasProjectAccess(JAN));
    }),
  );
});
