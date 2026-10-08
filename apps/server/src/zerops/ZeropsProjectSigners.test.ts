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
import { HttpClient, HttpClientResponse } from "effect/http";

import type {
  TerminalAttachStreamEvent,
  TerminalSessionSnapshot,
  ZeropsAgentLoginState,
} from "@t3tools/contracts";

import * as ServerConfig from "../config.ts";
import { make as makeAgentLogin } from "./ZeropsAgentLogin.ts";
import { ZEROPS_SUBJECT_PREFIX } from "./ZeropsMembershipWatch.ts";
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
import * as ZeropsMateKeyModule from "./ZeropsMateKey.ts";
import * as ZeropsOrgReadModule from "./ZeropsOrgRead.ts";
import * as ZeropsProjectAccessModule from "./ZeropsProjectAccess.ts";
import { isMemberListComplete } from "./ZeropsProjectAccess.ts";
import {
  loginTurnRefusal,
  isTurnStartingCommand,
  make as makeProjectSigners,
  SIGN_IN_CHECK_WAIT,
  turnRefusal,
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
  for (const [name, input, refusal] of [
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
  ] as const) {
    it(`${refusal === undefined ? "allows" : "refuses"} a turn on ${name}`, () => {
      assert.deepStrictEqual(turnRefusal(input), refusal);
    });
  }
});

// A login other than the defaults has no platform flag: its state is its own
// check's answer, and its signer is its own.
describe("loginTurnRefusal", () => {
  for (const [name, input, refusal] of [
    ["my own login", { state: "authorized", token: false, signer: JAN, subject: JAN }, undefined],
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
  ] as const) {
    it(`${refusal === undefined ? "allows" : "refuses"} a turn on ${name}`, () => {
      assert.deepStrictEqual(loginTurnRefusal(input), refusal);
    });
  }
});

describe("isTurnStartingCommand", () => {
  it("gates the command that starts a turn", () => {
    assert.isTrue(isTurnStartingCommand({ type: "thread.turn.start" }));
  });

  // The decider turns an answer to a message-mode question into a turn of its
  // own; an answer to a native callback question continues the running turn.
  const respond = { type: "thread.user-input.respond" };
  for (const [name, request, expected] of [
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
  ] as const) {
    it(name, () => {
      assert.strictEqual(isTurnStartingCommand(respond, request), expected);
    });
  }

  // Everything else stays open to every member who can open the Mate: a
  // colleague must be able to stop an agent they are not allowed to start.
  for (const type of [
    "thread.turn.interrupt",
    "thread.session.stop",
    "thread.archive",
    "thread.settle",
    "thread.create",
    "thread.meta.update",
    "project.create",
  ]) {
    it(`leaves ${type} to every member`, () => {
      assert.isFalse(isTurnStartingCommand({ type }));
    });
  }
});

describe("isMemberListComplete", () => {
  for (const [name, body, entriesLength, expected] of [
    ["no totalCount at all", {}, 3, true],
    ["body is not an object", null, 0, true],
    ["totalCount matches the rows read", { totalCount: 2 }, 2, true],
    ["totalCount is fewer than the rows read", { totalCount: 1 }, 2, true],
    ["totalCount exceeds the rows read", { totalCount: 5 }, 2, false],
    ["totalCount is not a finite number", { totalCount: "5" }, 2, true],
  ] as const) {
    it(name, () => {
      assert.strictEqual(isMemberListComplete(body, entriesLength), expected);
    });
  }
});

const PROJECT_ID = "nTV3oMB2SS634ImDJnQckg";
const CLIENT_ID = "BkC8AGjFQMyFrLbzjHoE9g";
const MATE_KEY = "the-mates-own-zerops-key";

const environment = resolveZeropsEnvironment({
  projectId: PROJECT_ID,
  apiHost: undefined,
  apiToken: MATE_KEY,
})!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const httpLayer = (
  route: (url: string) => Response,
  mateKey: ZeropsMateKeyModule.ZeropsMateKeyReader = ZeropsMateKeyModule.snapshotOnlyReader(
    MATE_KEY,
  ),
) => {
  const seen: Array<string | undefined> = [];
  const layer = ZeropsOrgReadModule.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            seen.push(request.headers.authorization);
            return Effect.succeed(HttpClientResponse.fromWeb(request, route(request.url)));
          }),
        ),
        Layer.succeed(ZeropsMateKeyModule.ZeropsMateKey, mateKey),
      ),
    ),
  );
  return { layer, seen } as const;
};

describe("the turn gate", () => {
  const signedIn = {
    state: "authorized",
    providerAuth: "authenticated",
    credPresent: true,
    flagToken: false,
  } as const;

  /**
   * The service over the sign-ins this server saw. The member list is unreadable, so the leave
   * check never signs anybody out.
   */
  const gateOver = (signIns: SignInStore) =>
    Effect.gen(function* () {
      const signers = yield* makeProjectSigners.pipe(
        Effect.provide(
          ZeropsProjectAccessModule.layer.pipe(
            Layer.provideMerge(
              Layer.mergeAll(
                httpLayer(() => json({ message: "down" }, 500)).layer,
                ServerConfig.layer({ zerops: environment } as ServerConfig.ServerConfig["Service"]),
                NodeServices.layer,
                Layer.succeed(ZeropsSignIns, signIns),
              ),
            ),
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
  for (const [name, succeeds, expected] of [
    ["his sign-in succeeds: refused", true, { kind: "someone-else" }],
    ["his sign-in fails: hers again", false, undefined],
  ] as const) {
    it.effect(`the signer's turn waits while somebody else's code is checked — ${name}`, () =>
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
  }

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
  for (const [name, kept, subject, agent, expected] of [
    ["the signer's own re-sign-in", JAN, JAN, signedIn, undefined],
    ["a third person's turn", EVA, "ida-user-id", signedIn, { kind: "someone-else" }],
    ["a turn nobody could be named for", undefined, undefined, signedIn, { kind: "unrecorded" }],
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
  ] as const) {
    it.effect(`a code being checked holds no turn it cannot decide — ${name}`, () =>
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
  }

  // A login left at its menu, its page or its code prompt has written nothing: no turn waits on
  // an abandoned sign-in.
  for (const phase of ["menu", "awaiting-browser", "awaiting-code", "failed"] as const) {
    it.effect(`a sign-in at ${phase} makes no turn wait`, () =>
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
  }

  // A check that never settles leaves the credential's owner unknown: once the wait is over,
  // nobody's turn runs on it.
  for (const [name, subject] of [
    ["the signer's", EVA],
    ["the checked person's", JAN],
  ] as const) {
    it.effect(`a check that never settles refuses ${name} turn once the wait is over`, () =>
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
  }

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
// same answer that keeps a session open: this project's door, by the person's role here.
describe("hasProjectAccess", () => {
  /** The service over this project and the org's member list, both of which the test changes. */
  const access = (initial: { readonly project: unknown; readonly members: unknown }) =>
    Effect.gen(function* () {
      let project = initial.project;
      let members = initial.members;
      let status = 200;
      const signIns = yield* memorySignInStore();
      const zerops = httpLayer((url) =>
        url.endsWith("/user/list") ? json(members, status) : json(project, status),
      );
      const { signers, projectAccess } = yield* Effect.all({
        signers: makeProjectSigners,
        projectAccess: ZeropsProjectAccessModule.ZeropsProjectAccess,
      }).pipe(
        Effect.provide(
          ZeropsProjectAccessModule.layer.pipe(
            Layer.provideMerge(
              Layer.mergeAll(
                zerops.layer,
                ServerConfig.layer({ zerops: environment } as ServerConfig.ServerConfig["Service"]),
                NodeServices.layer,
                Layer.succeed(ZeropsSignIns, signIns),
              ),
            ),
          ),
        ),
      );
      yield* TestClock.adjust(Duration.zero);
      return {
        signers,
        relayed: projectAccess.relayed,
        seen: zerops.seen,
        set: (next: {
          readonly project?: unknown;
          readonly members?: unknown;
          status?: number;
        }) => {
          project = next.project ?? project;
          members = next.members ?? members;
          status = next.status ?? status;
        },
      };
    });

  const member = (userId: string, roleCode: string, status = "ACTIVE") => ({
    id: `cu-${userId}`,
    userId,
    roleCode,
    status,
  });
  const projectWith = (userRoles: ReadonlyArray<{ clientUserId: string; roleCode: string }>) => ({
    id: PROJECT_ID,
    clientId: CLIENT_ID,
    userRoles,
  });

  for (const [name, roleCode, override, status, expected] of [
    ["an org member who builds", "BASIC_USER", undefined, "ACTIVE", true],
    // Kept in the org, taken out of this project: their crew stops with their session (X3).
    ["an org member this project shuts out", "BASIC_USER", "NO_ACCESS", "ACTIVE", false],
    ["a member let in here alone", "NO_ACCESS", "BASIC_USER", "ACTIVE", true],
    ["a read-only member", "READ_ONLY", undefined, "ACTIVE", false],
    ["an admin who is not active", "ADMIN", undefined, "WAITING_AUTHORIZATION", false],
  ] as const) {
    it.effect(`answers by this project's door: ${name}, ${String(expected)}`, () =>
      Effect.gen(function* () {
        const { signers } = yield* access({
          project: projectWith(
            override === undefined ? [] : [{ clientUserId: `cu-${JAN}`, roleCode: override }],
          ),
          members: { clientUserList: [member(JAN, roleCode, status), member(EVA, "OWNER")] },
        });
        assert.strictEqual(yield* signers.hasProjectAccess(JAN), expected);
      }).pipe(Effect.scoped),
    );
  }

  // R6: HQ's relay answers while it holds, and Zerops is not read for it.
  it.effect("answers from HQ's relay while it holds, reading nothing of Zerops", () =>
    Effect.gen(function* () {
      const { signers, relayed, seen } = yield* access({
        project: projectWith([]),
        members: { clientUserList: [member(EVA, "OWNER")] },
      });
      yield* relayed({
        members: [{ userId: JAN, role: "BASIC_USER", visibility: "open" }],
        ageMs: 0,
      });
      assert.isTrue(yield* signers.hasProjectAccess(JAN));
      assert.isFalse(yield* signers.hasProjectAccess(EVA));
      assert.deepStrictEqual(seen, []);
    }).pipe(Effect.scoped),
  );

  // HQ's answer holds five minutes from HQ's read of Zerops, never from when it arrived.
  it.effect(
    "holds HQ's answer five minutes from HQ's read while nothing answers, then nothing",
    () =>
      Effect.gen(function* () {
        const { signers, relayed, set } = yield* access({ project: projectWith([]), members: {} });
        set({ status: 500 });
        yield* relayed({
          members: [{ userId: JAN, role: "BASIC_USER", visibility: "open" }],
          ageMs: 4 * 60_000,
        });
        assert.isTrue(yield* signers.hasProjectAccess(JAN));
        yield* TestClock.adjust(Duration.minutes(1));
        assert.isTrue(yield* signers.hasProjectAccess(JAN));
        yield* TestClock.adjust(Duration.millis(1));
        assert.isUndefined(yield* signers.hasProjectAccess(JAN));
      }).pipe(Effect.scoped),
  );

  it.effect("answers no for somebody the org does not list", () =>
    Effect.gen(function* () {
      const { signers } = yield* access({
        project: projectWith([]),
        members: { clientUserList: [member(EVA, "OWNER")] },
      });
      assert.isFalse(yield* signers.hasProjectAccess(JAN));
    }).pipe(Effect.scoped),
  );

  // D7: while reads fail, the last answer holds five minutes from its read, then nothing does.
  it.effect("answers from the last read for five minutes while reads fail, then nothing", () =>
    Effect.gen(function* () {
      const { signers, set } = yield* access({
        project: projectWith([]),
        members: { clientUserList: [member(JAN, "BASIC_USER")] },
      });
      assert.isTrue(yield* signers.hasProjectAccess(JAN));
      set({ status: 500 });
      yield* TestClock.adjust(Duration.minutes(5));
      assert.isTrue(yield* signers.hasProjectAccess(JAN));
      yield* TestClock.adjust(Duration.seconds(1));
      assert.isUndefined(yield* signers.hasProjectAccess(JAN));
    }).pipe(Effect.scoped),
  );

  // An empty list is an outage dressed as an answer, and a page is not the whole org (S6): acting
  // on either would take somebody's access, and with it their logins (`ZeropsOffboarding`).
  for (const [name, members] of [
    ["comes back empty", { clientUserList: [] }],
    ["is not a list", { members: [] }],
    ["is a partial page", { clientUserList: [member(JAN, "BASIC_USER")], totalCount: 2 }],
  ] as const) {
    it.effect(`answers nothing when the member list ${name}`, () =>
      Effect.gen(function* () {
        const { signers } = yield* access({ project: projectWith([]), members });
        assert.isUndefined(yield* signers.hasProjectAccess(JAN));
      }).pipe(Effect.scoped),
    );
  }

  it.effect("answers nothing when nothing could be read", () =>
    Effect.gen(function* () {
      const { signers, set } = yield* access({ project: projectWith([]), members: {} });
      set({ status: 500 });
      assert.isUndefined(yield* signers.hasProjectAccess(JAN));
    }).pipe(Effect.scoped),
  );
});
