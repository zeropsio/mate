import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

import {
  agentIdForDriverKind,
  isZeropsLeaseHeld,
  KNOWN_ZEROPS_LEASE_STATES,
  ZEROPS_AGENT_LOGIN_COMMANDS,
  ZeropsAgentAuth,
  ZeropsAgentAuthSnapshot,
  ZeropsAgentAuthState,
  ZeropsAgentId,
  ZeropsAgentLoginCancelInput,
  ZeropsAgentLoginError,
  ZeropsAgentLoginPhase,
  ZeropsAgentLoginStartInput,
  ZeropsAgentLoginStartResult,
  ZeropsAgentLoginState,
  ZeropsAgentLoginSubmitCodeInput,
  ZeropsAgentSignOutInput,
  ZeropsLogin,
  ZeropsLoginAddInput,
  ZeropsLoginRemoveInput,
  ZeropsStateEnvelope,
} from "./zerops.ts";

const decodeLoginError = Schema.decodeUnknownSync(ZeropsAgentLoginError);
const decodeAgentId = Schema.decodeUnknownSync(ZeropsAgentId);
const decodeAgentAuthState = Schema.decodeUnknownSync(ZeropsAgentAuthState);
const decodeAgentAuth = Schema.decodeUnknownSync(ZeropsAgentAuth);
const decodeSnapshot = Schema.decodeUnknownSync(ZeropsAgentAuthSnapshot);
const decodeLoginPhase = Schema.decodeUnknownSync(ZeropsAgentLoginPhase);
const decodeLoginState = Schema.decodeUnknownSync(ZeropsAgentLoginState);
const decodeLoginStartInput = Schema.decodeUnknownSync(ZeropsAgentLoginStartInput);
const decodeLoginStartResult = Schema.decodeUnknownSync(ZeropsAgentLoginStartResult);
const decodeLoginCancelInput = Schema.decodeUnknownSync(ZeropsAgentLoginCancelInput);
const decodeLogin = Schema.decodeUnknownSync(ZeropsLogin);
const decodeSubmitCodeInput = Schema.decodeUnknownSync(ZeropsAgentLoginSubmitCodeInput);
const decodeSignOutInput = Schema.decodeUnknownSync(ZeropsAgentSignOutInput);
const decodeLoginAddInput = Schema.decodeUnknownSync(ZeropsLoginAddInput);
const decodeLoginRemoveInput = Schema.decodeUnknownSync(ZeropsLoginRemoveInput);

describe("ZeropsAgentId", () => {
  it("accepts the two agents with a live-verified credential probe", () => {
    expect(decodeAgentId("claude-code")).toBe("claude-code");
    expect(decodeAgentId("codex")).toBe("codex");
  });

  it("rejects an agent with no verified probe", () => {
    expect(() => decodeAgentId("cursor")).toThrow();
  });
});

describe("agentIdForDriverKind", () => {
  it.each([
    { driver: "claudeAgent", expected: "claude-code" },
    { driver: "codex", expected: "codex" },
    { driver: "opencode", expected: undefined },
    { driver: "claude-code", expected: undefined },
    { driver: undefined, expected: undefined },
  ] as const)("maps driver $driver to $expected", ({ driver, expected }) => {
    expect(agentIdForDriverKind(driver)).toBe(expected);
  });
});

describe("ZeropsAgentAuthState", () => {
  it("accepts every value of the §3 W-STATE matrix", () => {
    for (const state of [
      "authorized-token",
      "authorized",
      "reconnect",
      "local-only",
      "not-authorized",
    ]) {
      expect(decodeAgentAuthState(state)).toBe(state);
    }
  });

  it("rejects a value outside the matrix", () => {
    expect(() => decodeAgentAuthState("pending")).toThrow();
  });
});

describe("ZeropsAgentAuth", () => {
  it("decodes one agent's row", () => {
    const decoded = decodeAgentAuth({
      agentId: "claude-code",
      credPresent: true,
      flagOAuth: true,
      flagToken: false,
      providerAuth: "authenticated",
      state: "authorized",
    });
    expect(decoded.agentId).toBe("claude-code");
    expect(decoded.state).toBe("authorized");
    expect(decoded.providerAuth).toBe("authenticated");
  });

  it("accepts every ServerProviderAuthStatus value for providerAuth", () => {
    for (const providerAuth of ["authenticated", "unauthenticated", "unknown"]) {
      const decoded = decodeAgentAuth({
        agentId: "codex",
        credPresent: false,
        flagOAuth: false,
        flagToken: false,
        providerAuth,
        state: "not-authorized",
      });
      expect(decoded.providerAuth).toBe(providerAuth);
    }
  });

  it("rejects a missing providerAuth field", () => {
    expect(() =>
      decodeAgentAuth({
        agentId: "codex",
        credPresent: false,
        flagOAuth: false,
        flagToken: false,
        state: "not-authorized",
      }),
    ).toThrow();
  });
});

describe("ZeropsAgentAuthSnapshot", () => {
  it("decodes an available snapshot with both agents", () => {
    const decoded = decodeSnapshot({
      available: true,
      agents: [
        {
          agentId: "claude-code",
          credPresent: false,
          flagOAuth: false,
          flagToken: false,
          providerAuth: "unknown",
          state: "not-authorized",
        },
        {
          agentId: "codex",
          credPresent: true,
          flagOAuth: false,
          flagToken: false,
          providerAuth: "unauthenticated",
          state: "local-only",
        },
      ],
    });
    expect(decoded.agents).toHaveLength(2);
    expect(decoded.reason).toBeUndefined();
  });

  it("decodes an unavailable snapshot (not a Zerops environment)", () => {
    const decoded = decodeSnapshot({
      available: false,
      reason: "Not a Zerops environment",
      agents: [],
    });
    expect(decoded.available).toBe(false);
    expect(decoded.agents).toEqual([]);
  });
});

describe("ZEROPS_AGENT_LOGIN_COMMANDS", () => {
  it("has exactly one command per known agent", () => {
    expect(ZEROPS_AGENT_LOGIN_COMMANDS["claude-code"]).toBe("claude /login");
    expect(ZEROPS_AGENT_LOGIN_COMMANDS.codex).toBe("codex login --device-auth");
  });
});

describe("ZeropsAgentLoginPhase", () => {
  it("accepts every phase of the login walker", () => {
    for (const phase of [
      "starting",
      "menu",
      "awaiting-browser",
      "awaiting-code",
      "verifying-code",
      "succeeded",
      "failed",
      "cancelled",
    ]) {
      expect(decodeLoginPhase(phase)).toBe(phase);
    }
  });

  it("rejects a phase outside the walker's vocabulary", () => {
    expect(() => decodeLoginPhase("waiting_for_code")).toThrow();
  });
});

describe("ZeropsAgentLoginState", () => {
  it("decodes the minimal starting state", () => {
    const decoded = decodeLoginState({
      phase: "starting",
      terminalId: "agent-login-claude-code",
      startedAt: DateTime.makeUnsafe("2026-08-29T12:00:00.000Z"),
    });
    expect(decoded.phase).toBe("starting");
    expect(decoded.url).toBeUndefined();
    expect(decoded.code).toBeUndefined();
  });

  it("decodes an awaiting-browser state carrying a url and a device code", () => {
    const decoded = decodeLoginState({
      phase: "awaiting-browser",
      url: "https://auth.openai.com/codex/device",
      code: "ABCD-12345",
      terminalId: "agent-login-codex",
      startedAt: DateTime.makeUnsafe("2026-08-29T12:00:00.000Z"),
    });
    expect(decoded.url).toBe("https://auth.openai.com/codex/device");
    expect(decoded.code).toBe("ABCD-12345");
  });

  it("decodes a failed state carrying a message", () => {
    const decoded = decodeLoginState({
      phase: "failed",
      message: "Authentication failed.",
      terminalId: "agent-login-claude-code",
      startedAt: DateTime.makeUnsafe("2026-08-29T12:00:00.000Z"),
    });
    expect(decoded.message).toBe("Authentication failed.");
  });

  // A Mate keeps the version it was installed with while the hosted client
  // moves on: a state from before `startedBy` must still decode, or the whole
  // agent-auth snapshot fails and the card disappears (seen on localhost
  // against a 0.11.40 container, 2026-09-22).
  it("decodes a state from a server that names no starter, and carries one when named", () => {
    const base = {
      phase: "awaiting-browser",
      terminalId: "agent-login-codex",
      startedAt: DateTime.makeUnsafe("2026-08-29T12:00:00.000Z"),
    } as const;
    expect(decodeLoginState(base).startedBy).toBeUndefined();
    expect(decodeLoginState({ ...base, startedBy: "user-a" }).startedBy).toBe("user-a");
  });

  it("rejects a document missing terminalId", () => {
    expect(() =>
      decodeLoginState({
        phase: "starting",
        startedAt: DateTime.makeUnsafe("2026-08-29T12:00:00.000Z"),
      }),
    ).toThrow();
  });
});

describe("ZeropsAgentAuth with login", () => {
  it("decodes a row carrying an active login session", () => {
    const decoded = decodeAgentAuth({
      agentId: "claude-code",
      credPresent: false,
      flagOAuth: false,
      flagToken: false,
      providerAuth: "unknown",
      state: "not-authorized",
      login: {
        phase: "menu",
        terminalId: "agent-login-claude-code",
        startedAt: DateTime.makeUnsafe("2026-08-29T12:00:00.000Z"),
      },
    });
    expect(decoded.login?.phase).toBe("menu");
  });

  it("decodes a row with no login field the same as before (still optional)", () => {
    const decoded = decodeAgentAuth({
      agentId: "codex",
      credPresent: false,
      flagOAuth: false,
      flagToken: false,
      providerAuth: "unknown",
      state: "not-authorized",
    });
    expect(decoded.login).toBeUndefined();
  });
});

describe("ZeropsAgentLoginStartInput / ZeropsAgentLoginStartResult / ZeropsAgentLoginCancelInput", () => {
  it("decodes a start input", () => {
    const decoded = decodeLoginStartInput({ agentId: "codex", threadId: "thread-1" });
    expect(decoded.agentId).toBe("codex");
    expect(decoded.threadId).toBe("thread-1");
  });

  it("rejects a start input naming an unknown agent", () => {
    expect(() => decodeLoginStartInput({ agentId: "cursor", threadId: "thread-1" })).toThrow();
  });

  it("decodes a start result", () => {
    const decoded = decodeLoginStartResult({ terminalId: "agent-login-claude-code" });
    expect(decoded.terminalId).toBe("agent-login-claude-code");
  });

  it("decodes a cancel input", () => {
    const decoded = decodeLoginCancelInput({ agentId: "claude-code" });
    expect(decoded.agentId).toBe("claude-code");
  });
});

describe("ZeropsLogin", () => {
  it.each([
    {
      name: "a default login",
      row: {
        id: "claudeAgent",
        agent: "claude-code",
        label: "",
        kind: "subscription",
        default: true,
        state: "authorized",
        token: false,
        signedInBy: "u-eva",
      },
    },
    {
      name: "a second Claude account nobody signed in yet",
      row: {
        id: "claudeAgent-work",
        agent: "claude-code",
        label: "work",
        kind: "subscription",
        default: false,
        state: "not-authorized",
        token: false,
      },
    },
    {
      name: "a Claude API key",
      row: {
        id: "claudeAgent-team-key",
        agent: "claude-code",
        label: "team key",
        kind: "apiKey",
        default: false,
        state: "authorized",
        token: false,
        signedInBy: "u-eva",
      },
    },
  ])("decodes $name", ({ row }) => {
    expect(decodeLogin(row)).toEqual(row);
  });

  it.each([
    { name: "an unknown kind", patch: { kind: "oauth" } },
    { name: "a state outside the classification", patch: { state: "local-only" } },
    { name: "an id outside the instance-id slug rules", patch: { id: "claude:work" } },
  ])("rejects $name", ({ patch }) => {
    expect(() =>
      decodeLogin({
        id: "codex-work",
        agent: "codex",
        label: "work",
        kind: "subscription",
        default: false,
        state: "not-authorized",
        token: false,
        ...patch,
      }),
    ).toThrow();
  });
});

describe("ZeropsAgentAuthSnapshot logins", () => {
  const agents = [
    {
      agentId: "codex",
      credPresent: false,
      flagOAuth: false,
      flagToken: false,
      providerAuth: "unknown",
      state: "not-authorized",
    },
  ];

  it("decodes an older server's snapshot, which lists no logins", () => {
    expect(decodeSnapshot({ available: true, agents }).logins).toBeUndefined();
  });

  it("decodes the logins a newer server lists beside the agents", () => {
    const decoded = decodeSnapshot({
      available: true,
      agents,
      logins: [
        {
          id: "codex",
          agent: "codex",
          label: "",
          kind: "subscription",
          default: true,
          state: "not-authorized",
          token: false,
        },
      ],
    });
    expect(decoded.logins?.map((login) => login.id)).toEqual(["codex"]);
  });
});

describe("login-targeted agent login inputs", () => {
  it.each([
    {
      name: "start",
      decode: () =>
        decodeLoginStartInput({ agentId: "codex", threadId: "t", loginId: "codex-work" }),
    },
    {
      name: "cancel",
      decode: () => decodeLoginCancelInput({ agentId: "codex", loginId: "codex-work" }),
    },
    {
      name: "submitCode",
      decode: () =>
        decodeSubmitCodeInput({ agentId: "claude-code", code: "abc", loginId: "codex-work" }),
    },
    {
      name: "signOut",
      decode: () => decodeSignOutInput({ agentId: "codex", loginId: "codex-work" }),
    },
  ])("$name names a login beside its agent", ({ decode }) => {
    expect(decode().loginId).toBe("codex-work");
  });

  it("rejects a login id outside the instance-id slug rules", () => {
    expect(() => decodeLoginCancelInput({ agentId: "codex", loginId: "codex:work" })).toThrow();
  });
});

describe("ZeropsLoginAddInput / ZeropsLoginRemoveInput", () => {
  it("decodes another account", () => {
    expect(decodeLoginAddInput({ agent: "codex", kind: "subscription", label: "work" })).toEqual({
      agent: "codex",
      kind: "subscription",
      label: "work",
    });
  });

  it("decodes an API key, which rides only in this input", () => {
    const decoded = decodeLoginAddInput({
      agent: "claude-code",
      kind: "apiKey",
      label: "",
      apiKey: "sk-ant-xyz",
    });
    expect(decoded.apiKey).toBe("sk-ant-xyz");
  });

  it("rejects a label longer than a row can show", () => {
    expect(() =>
      decodeLoginAddInput({ agent: "codex", kind: "subscription", label: "x".repeat(33) }),
    ).toThrow();
  });

  it("decodes a removal", () => {
    expect(decodeLoginRemoveInput({ id: "codex-work" })).toEqual({ id: "codex-work" });
  });
});

it("decodes a signer persistence failure from adding a login", () => {
  const decoded = decodeLoginError({
    _tag: "ZeropsAgentLoginError",
    reason: "signer-write-failed",
    detail: "Sign-in could not be recorded.",
  });
  expect(decoded.reason).toBe("signer-write-failed");
});

const decodeEnvelope = Schema.decodeUnknownSync(ZeropsStateEnvelope);
const envelope = (extra: Record<string, unknown> = {}) => ({
  phase: "develop-active",
  environment: "container",
  project: { id: "proj-1", name: "z3-eval" },
  services: [],
  generated: "2026-10-23T12:00:00Z",
  ...extra,
});

describe("ZeropsStateEnvelope services", () => {
  const service = (hostname: string, extra: Record<string, unknown> = {}) => ({
    hostname,
    typeVersion: "nodejs@22",
    runtimeClass: "dynamic",
    status: "ACTIVE",
    bootstrapped: true,
    ...extra,
  });
  const web = {
    name: "web",
    port: 3000,
    url: "https://appdev-1df2-3000.prg1.zerops.app",
    status: "running",
    readAt: "2026-10-23T12:00:00Z",
  };
  const worker = { name: "worker", status: "crashed", readAt: "2026-10-23T12:00:00Z" };

  it("a service's dev server this build cannot read is left out, never the service", () => {
    const decoded = decodeEnvelope(
      envelope({
        services: [
          service("appdev", { devServers: [web, { name: "api", port: "x" }, worker] }),
          service("appstage"),
        ],
      }),
    );
    expect(decoded.services.map((entry) => entry.hostname)).toEqual(["appdev", "appstage"]);
    expect(decoded.services[0]?.devServers).toEqual([web, worker]);
  });
});

describe("ZeropsStateEnvelope leases", () => {
  const held = {
    alias: "webpool-3",
    pool: "webpool",
    branch: "feat-x",
    containerHostname: "node-id-3.runtime.webpool.zerops",
    state: "held",
    unverified: false,
  };

  it("an envelope from a zcp that reads no leases says nothing of them", () => {
    expect(decodeEnvelope(envelope()).leases).toBeUndefined();
  });

  it("an envelope says which pool containers zcp holds, and none as none", () => {
    expect(decodeEnvelope(envelope({ leases: [held] })).leases).toEqual([held]);
    expect(decodeEnvelope(envelope({ leases: [] })).leases).toEqual([]);
  });

  it("a lease in a state or with a field this build does not know still reads", () => {
    const decoded = decodeEnvelope(
      envelope({ leases: [{ ...held, state: "draining", region: "prg1" }] }),
    );
    expect(decoded.leases).toEqual([{ ...held, state: "draining" }]);
  });

  it("a lease this build cannot read is left out, never the envelope", () => {
    const decoded = decodeEnvelope(
      envelope({
        leases: [{ pool: "webpool", state: "held" }, held, { ...held, alias: "../etc" }],
      }),
    );
    expect(decoded.leases).toEqual([held]);
    expect(decoded.phase).toBe("develop-active");
  });

  it("a lease names the dev servers zcp read on it, one this build cannot read left out", () => {
    const preview = {
      name: "webpool-3",
      port: 3000,
      url: "https://webpool-3003.prg1.zerops.app",
      status: "running",
      readAt: "2026-10-23T12:00:00Z",
    };
    const decoded = decodeEnvelope(
      envelope({ leases: [{ ...held, devServers: [preview, { port: "x" }] }, held] }),
    );
    expect(decoded.leases?.[0]?.devServers).toEqual([preview]);
    expect(decoded.leases?.[1]).not.toHaveProperty("devServers");
  });

  it("a lease acquired for no branch reads without one", () => {
    const { branch: _branch, ...noBranch } = held;
    expect(decodeEnvelope(envelope({ leases: [noBranch] })).leases).toEqual([noBranch]);
  });

  /** What a `zerops_lease action=status` read of the lease's checkout found (spec-mate §2.8a.3). */
  const activity = {
    lastChangeAt: "2026-10-23T19:12:40Z",
    previewLastConnAt: "2026-10-23T19:40:00Z",
    previewOpenConns: 0,
    acquiredAt: "2026-10-23T18:00:00Z",
    readAt: "2026-10-23T20:04:00Z",
  };
  const unsaved = {
    files: [" M src/App.tsx", "?? notes.txt"],
    fileCount: 2,
    unpushedCommits: 2,
  };

  it("a lease says what zcp read of its checkout: when it was last active, and what a release would lose", () => {
    const decoded = decodeEnvelope(envelope({ leases: [{ ...held, activity, unsaved }, held] }));
    expect(decoded.leases?.[0]).toEqual({ ...held, activity, unsaved });
    expect(decoded.leases?.[1], "a lease no call read carries neither").toEqual(held);
  });

  it("a fact zcp did not read stays absent, never a zero", () => {
    const unread = {
      acquiredAt: "2026-10-23T18:00:00Z",
      note: "not read: the pool's orchestrator did not confirm this lease",
    };
    const clean = { fileCount: 0, unpushedCommits: 0 };
    const [lease] =
      decodeEnvelope(envelope({ leases: [{ ...held, activity: unread, unsaved: clean }] }))
        .leases ?? [];
    expect(lease?.activity).toEqual(unread);
    expect(lease?.unsaved, "a clean checkout lists no files").toEqual(clean);
  });

  it("what zcp read of a checkout that this build cannot read costs only itself, never the lease", () => {
    const decoded = decodeEnvelope(
      envelope({
        leases: [
          { ...held, activity: { ...activity, previewOpenConns: "two" }, unsaved },
          { ...held, alias: "webpool-4", activity, unsaved: { fileCount: "many" } },
          {
            ...held,
            alias: "webpool-5",
            unsaved: { ...unsaved, files: [" M src/App.tsx", 7, "?? notes.txt"] },
          },
        ],
      }),
    );
    expect(decoded.leases?.map((lease) => lease.alias)).toEqual([
      "webpool-3",
      "webpool-4",
      "webpool-5",
    ]);
    expect(decoded.leases?.[0]?.activity).toBeUndefined();
    expect(decoded.leases?.[0]?.unsaved).toEqual(unsaved);
    expect(decoded.leases?.[1]?.activity).toEqual(activity);
    expect(decoded.leases?.[1]?.unsaved).toBeUndefined();
    expect(decoded.leases?.[2]?.unsaved?.files).toEqual(unsaved.files);
  });

  it("a parked lease is a state this build knows, and zcp still holds it", () => {
    expect(KNOWN_ZEROPS_LEASE_STATES).toContain("parked");
    expect(isZeropsLeaseHeld("parked")).toBe(true);
  });
});
