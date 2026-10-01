import { EnvironmentId, type ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { closeAccountLifetime } from "./accountLifetime";
import {
  agentSignersToRecord,
  LOCAL_SIGNER_STANDS_MS,
  localAgentSignerWritten,
  retainLocalAgentSigners,
  localSignersSettledBy,
  readLocalAgentSigners,
  rememberLocalAgentSigner,
  forgetLocalAgentSigner,
  resolveAgentAuthorizer,
  subscribeLocalAgentSigners,
} from "./useZeropsAgentSigner";

const mock = vi.hoisted(() => ({
  updateProjectTags: vi.fn(),
}));
vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({ user: { id: "user-a" } }),
}));
// The account's runtime, whose one tag command the record goes through; a command here is the
// promise the mock answers.
vi.mock("./zeropsDataContext", async () => {
  const { createContext } = await import("react");
  return {
    ZeropsDataContext: createContext({
      runtime: { commands: { updateProjectTags: mock.updateProjectTags } },
      projectRef: (organizationId: string, projectId: string) => ({ organizationId, projectId }),
    }),
    runZeropsCommand: (command: Promise<unknown>) => command,
  };
});

const PROJECT = { projectId: "project-1", orgId: "org-1" };
/** The Mate the records are of: what this client wrote is its own, never another Mate's. */
const ENV = EnvironmentId.make("env-mate");

const snapshot = (
  logins: Readonly<
    Partial<
      Record<
        "claude-code" | "codex",
        {
          readonly phase: "succeeded" | "starting" | "failed" | "cancelled";
          readonly startedBy: string;
          readonly succeededBy?: string;
        }
      >
    >
  >,
  authorizedBy: Readonly<Partial<Record<"claude-code" | "codex", string>>> = {},
): ZeropsAgentAuthSnapshot => ({
  available: true,
  agents: (["claude-code", "codex"] as const).map((agentId) => {
    const login = logins[agentId];
    const signer = authorizedBy[agentId];
    return {
      agentId,
      credPresent: true,
      flagOAuth: true,
      flagToken: false,
      providerAuth: "authenticated" as const,
      state: "authorized" as const,
      ...(login === undefined
        ? {}
        : {
            login: {
              phase: login.phase,
              terminalId: "t",
              startedAt: DateTime.makeUnsafe("2026-09-16T10:00:00.000Z"),
              startedBy: login.startedBy,
              ...(login.succeededBy === undefined
                ? {}
                : {
                    lastSucceeded: {
                      startedAt: DateTime.makeUnsafe("2026-09-16T09:59:00.000Z"),
                      startedBy: login.succeededBy,
                    },
                  }),
            },
          }),
      ...(signer === undefined ? {} : { authorizedBy: { subject: signer } }),
    };
  }),
});

// State, not a transition: whichever door the sign-in went through, and after
// a reload, the person who started a login that succeeded writes its record
// until the project carries it.
describe("agentSignersToRecord", () => {
  it.each([
    {
      name: "a success this person started, not yet recorded",
      logins: { "claude-code": { phase: "succeeded", startedBy: "user-a" } },
      authorizedBy: {},
      expected: ["claude-code"],
    },
    {
      name: "a success somebody else started is theirs to record",
      logins: { "claude-code": { phase: "succeeded", startedBy: "user-b" } },
      authorizedBy: {},
      expected: [],
    },
    {
      name: "a record the project already carries",
      logins: { codex: { phase: "succeeded", startedBy: "user-a" } },
      authorizedBy: { codex: "user-a" },
      expected: [],
    },
    {
      name: "a sign-in merely in progress",
      logins: { codex: { phase: "starting", startedBy: "user-a" } },
      authorizedBy: {},
      expected: [],
    },
    {
      name: "a sign-in that failed",
      logins: { codex: { phase: "failed", startedBy: "user-a" } },
      authorizedBy: {},
      expected: [],
    },
    {
      name: "a success over another member's old record: the new login is this person's",
      logins: { codex: { phase: "succeeded", startedBy: "user-a" } },
      authorizedBy: { codex: "user-b" },
      expected: ["codex"],
    },
    {
      name: "a sign-in of this person's, then another person's attempt cancelled before the record landed",
      logins: { codex: { phase: "cancelled", startedBy: "user-b", succeededBy: "user-a" } },
      authorizedBy: {},
      expected: ["codex"],
    },
    {
      name: "another person's attempt under way over nobody's success",
      logins: { codex: { phase: "starting", startedBy: "user-b" } },
      authorizedBy: {},
      expected: [],
    },
    {
      name: "both agents at once",
      logins: {
        "claude-code": { phase: "succeeded", startedBy: "user-a" },
        codex: { phase: "succeeded", startedBy: "user-a" },
      },
      authorizedBy: {},
      expected: ["claude-code", "codex"],
    },
  ] as const)("$name", ({ logins, authorizedBy, expected }) => {
    expect(agentSignersToRecord(snapshot(logins, authorizedBy), "user-a", null)).toEqual(expected);
  });

  // A Mate from before `startedBy` (0.11.40 and older): the success this
  // client watched happen is this person's, as before.
  describe("on a server that names nobody", () => {
    const legacy = (phase: "succeeded" | "starting"): ZeropsAgentAuthSnapshot => {
      const base = snapshot({ codex: { phase, startedBy: "x" } });
      return {
        ...base,
        agents: base.agents.map((agent) => {
          if (agent.login === undefined) return agent;
          const { startedBy: _startedBy, ...login } = agent.login;
          return { ...agent, login };
        }),
      };
    };

    it.each([
      { name: "a success it watched land", previous: legacy("starting"), expected: ["codex"] },
      { name: "a success on the first snapshot it sees", previous: null, expected: ["codex"] },
      { name: "a success already there before", previous: legacy("succeeded"), expected: [] },
    ])("$name", ({ previous, expected }) => {
      expect(agentSignersToRecord(legacy("succeeded"), "user-a", previous)).toEqual(expected);
    });
  });

  it("names nobody without a signed-in viewer", () => {
    expect(
      agentSignersToRecord(
        snapshot({ codex: { phase: "succeeded", startedBy: "user-a" } }),
        undefined,
        null,
      ),
    ).toEqual([]);
  });
});

// D6 per login: a login beyond the defaults carries its own record, under its
// own id — never its agent's.
describe("agentSignersToRecord, logins beyond the defaults", () => {
  const withWork = (
    work: { readonly phase: "succeeded" | "menu"; readonly startedBy: string },
    signedInBy?: string,
  ): ZeropsAgentAuthSnapshot => ({
    ...snapshot({}, { "claude-code": "user-b" }),
    logins: [
      {
        id: "claudeAgent-work",
        agent: "claude-code",
        label: "work",
        kind: "subscription",
        default: false,
        state: "authorized",
        token: false,
        ...(signedInBy === undefined ? {} : { signedInBy }),
        login: {
          phase: work.phase,
          terminalId: "agent-login-claudeAgent-work",
          startedAt: DateTime.makeUnsafe("2026-09-27T10:00:00.000Z"),
          startedBy: work.startedBy,
        },
      },
    ],
  });

  it.each([
    {
      name: "records a success this person started",
      work: { phase: "succeeded", startedBy: "user-a" },
      expected: ["claudeAgent-work"],
    },
    {
      name: "leaves a teammate's success to them",
      work: { phase: "succeeded", startedBy: "user-b" },
      expected: [],
    },
    {
      name: "waits for a login still running",
      work: { phase: "menu", startedBy: "user-a" },
      expected: [],
    },
    {
      name: "stops once the project carries it",
      work: { phase: "succeeded", startedBy: "user-a" },
      signedInBy: "user-a",
      expected: [],
    },
  ] as const)("$name", ({ work, signedInBy, expected }) => {
    expect(agentSignersToRecord(withWork(work, signedInBy), "user-a", null)).toEqual(expected);
  });

  it("forgets a login's local record once the snapshot carries it", () => {
    rememberLocalAgentSigner(ENV, "claudeAgent-work", "user-a");
    localSignersSettledBy(ENV, withWork({ phase: "succeeded", startedBy: "user-a" }, "user-a"));
    expect(readLocalAgentSigners(ENV)).toEqual({});
  });
});

// The person who just wrote the record is the one person who already knows
// what it says. The store remembers it for them until the server's snapshot
// carries the same fact.
describe("local agent signers", () => {
  const authorized = (
    agents: Readonly<Partial<Record<"claude-code" | "codex", string>>>,
  ): ZeropsAgentAuthSnapshot => ({
    available: true,
    agents: (["claude-code", "codex"] as const).map((agentId) => ({
      agentId,
      credPresent: true,
      flagOAuth: true,
      flagToken: false,
      providerAuth: "authenticated" as const,
      state: "authorized" as const,
      ...(agents[agentId] === undefined ? {} : { authorizedBy: { subject: agents[agentId] } }),
    })),
  });

  it("remembers a record once written, and tells subscribers", () => {
    const seen: number[] = [];
    const unsubscribe = subscribeLocalAgentSigners(() => seen.push(seen.length));
    rememberLocalAgentSigner(ENV, "claude-code", "user-a");
    expect(readLocalAgentSigners(ENV)).toEqual({ "claude-code": "user-a" });
    expect(seen).toEqual([0]);
    // The same fact again is not a change.
    rememberLocalAgentSigner(ENV, "claude-code", "user-a");
    expect(seen).toEqual([0]);
    unsubscribe();
    localSignersSettledBy(ENV, authorized({ "claude-code": "user-a" }));
  });

  it("forgets an entry once the snapshot carries that agent's signer, and keeps the others", () => {
    rememberLocalAgentSigner(ENV, "claude-code", "user-a");
    rememberLocalAgentSigner(ENV, "codex", "user-a");
    localSignersSettledBy(ENV, authorized({ "claude-code": "user-a" }));
    expect(readLocalAgentSigners(ENV)).toEqual({ codex: "user-a" });
    localSignersSettledBy(ENV, authorized({ codex: "user-b" }));
    expect(readLocalAgentSigners(ENV)).toEqual({});
  });

  it("forgets a record whose write failed, and keeps the others", () => {
    rememberLocalAgentSigner(ENV, "claude-code", "user-a");
    rememberLocalAgentSigner(ENV, "codex", "user-a");
    forgetLocalAgentSigner(ENV, "claude-code");
    expect(readLocalAgentSigners(ENV)).toEqual({ codex: "user-a" });
    forgetLocalAgentSigner(ENV, "codex");
    expect(readLocalAgentSigners(ENV)).toEqual({});
  });

  it("keeps one Mate's record to that Mate", () => {
    const other = EnvironmentId.make("env-other-mate");
    rememberLocalAgentSigner(ENV, "claude-code", "user-a");
    expect(readLocalAgentSigners(other)).toEqual({});
    localSignersSettledBy(other, authorized({ "claude-code": "user-a" }));
    expect(readLocalAgentSigners(ENV)).toEqual({ "claude-code": "user-a" });
    localSignersSettledBy(ENV, authorized({ "claude-code": "user-a" }));
  });

  // Signing in over an earlier record: the server's read of the tags is cached, so its snapshot
  // names the record from before for a while after this client wrote the new one.
  const signedInOver = (
    earlier: string | undefined,
    latestBy: string,
  ): ZeropsAgentAuthSnapshot => ({
    available: true,
    agents: [
      {
        agentId: "claude-code",
        credPresent: true,
        flagOAuth: true,
        flagToken: false,
        providerAuth: "authenticated",
        state: "authorized",
        ...(earlier === undefined ? {} : { authorizedBy: { subject: earlier } }),
        login: {
          phase: "succeeded",
          terminalId: "t",
          startedAt: DateTime.makeUnsafe("2026-09-30T10:00:00.000Z"),
          startedBy: latestBy,
        },
      },
    ],
  });

  it("keeps the record it wrote while the snapshot still names the one from before", () => {
    rememberLocalAgentSigner(ENV, "claude-code", "user-a");
    localSignersSettledBy(ENV, signedInOver("user-b", "user-a"));
    expect(readLocalAgentSigners(ENV)).toEqual({ "claude-code": "user-a" });
    localSignersSettledBy(ENV, authorized({ "claude-code": "user-a" }));
    expect(readLocalAgentSigners(ENV)).toEqual({});
  });

  // Neither snapshot names this client's record: what forgets it is the later sign-in alone.
  it.each([
    { name: "before any record", earlier: undefined },
    { name: "while the record from before still stands", earlier: "user-c" },
  ])("forgets the record it wrote once somebody else has signed in since, $name", ({ earlier }) => {
    rememberLocalAgentSigner(ENV, "claude-code", "user-a");
    localSignersSettledBy(ENV, signedInOver(earlier, "user-a"));
    expect(readLocalAgentSigners(ENV)).toEqual({ "claude-code": "user-a" });
    localSignersSettledBy(ENV, signedInOver(earlier, "user-b"));
    expect(readLocalAgentSigners(ENV)).toEqual({});
  });

  // The server publishes a landed record within its wait (`SIGNER_RECORD_AWAIT`, 60 s): past it,
  // the snapshot speaks for the login again, whatever this client wrote.
  it("lets a written record speak for a minute after its write, then the snapshot", () => {
    vi.useFakeTimers();
    try {
      rememberLocalAgentSigner(ENV, "claude-code", "user-a");
      vi.advanceTimersByTime(5 * 60_000);
      expect(readLocalAgentSigners(ENV)).toEqual({ "claude-code": "user-a" });
      localAgentSignerWritten(ENV, "claude-code", "user-a");
      vi.advanceTimersByTime(LOCAL_SIGNER_STANDS_MS - 1);
      expect(readLocalAgentSigners(ENV)).toEqual({ "claude-code": "user-a" });
      vi.advanceTimersByTime(1);
      expect(readLocalAgentSigners(ENV)).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });

  it("a newer write of the same record starts its own minute", () => {
    vi.useFakeTimers();
    try {
      rememberLocalAgentSigner(ENV, "claude-code", "user-a");
      localAgentSignerWritten(ENV, "claude-code", "user-a");
      vi.advanceTimersByTime(LOCAL_SIGNER_STANDS_MS - 1_000);
      rememberLocalAgentSigner(ENV, "claude-code", "user-a");
      localAgentSignerWritten(ENV, "claude-code", "user-a");
      vi.advanceTimersByTime(2_000);
      expect(readLocalAgentSigners(ENV)).toEqual({ "claude-code": "user-a" });
      vi.advanceTimersByTime(LOCAL_SIGNER_STANDS_MS);
      expect(readLocalAgentSigners(ENV)).toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });

  it("forgets every record when the account's session ends", () => {
    rememberLocalAgentSigner(ENV, "claude-code", "user-a");
    closeAccountLifetime();
    expect(readLocalAgentSigners(ENV)).toEqual({});
  });

  it("forgets the records of a Mate that has left the account", () => {
    const other = EnvironmentId.make("env-other-mate");
    rememberLocalAgentSigner(ENV, "claude-code", "user-a");
    rememberLocalAgentSigner(other, "codex", "user-a");
    retainLocalAgentSigners(new Set([other]));
    expect(readLocalAgentSigners(ENV)).toEqual({});
    expect(readLocalAgentSigners(other)).toEqual({ codex: "user-a" });
    forgetLocalAgentSigner(other, "codex");
  });

  it("keeps the store's identity when a snapshot settles nothing", () => {
    rememberLocalAgentSigner(ENV, "codex", "user-a");
    const before = readLocalAgentSigners(ENV);
    localSignersSettledBy(ENV, authorized({}));
    expect(readLocalAgentSigners(ENV)).toBe(before);
    localSignersSettledBy(ENV, authorized({ codex: "user-a" }));
  });

  const login = (phase: "verifying-code" | "succeeded" | "failed" | "cancelled", by?: string) => ({
    phase,
    terminalId: "term-1",
    startedAt: DateTime.makeUnsafe("2026-09-30T10:00:00.000Z"),
    ...(by === undefined ? {} : { startedBy: by }),
  });

  it.each([
    {
      name: "the snapshot's authorizer wins",
      agent: { authorizedBy: { subject: "user-b" }, login: login("verifying-code", "user-a") },
      local: { "claude-code": "user-a" },
      expected: { subject: "user-b" },
    },
    {
      // The server's snapshot still names the record from before this person's sign-in.
      name: "the record being written wins over the one from before the sign-in it records",
      agent: { authorizedBy: { subject: "user-b" }, login: login("succeeded", "user-a") },
      local: { "claude-code": "user-a" },
      expected: { subject: "user-a" },
    },
    {
      name: "a sign-in by somebody else since leaves the record this client wrote behind",
      agent: { login: login("succeeded", "user-b") },
      local: { "claude-code": "user-a" },
      expected: undefined,
    },
    {
      // A record that names anybody but whoever signed in last runs nothing (the gate): the
      // latest sign-in is whose the agent is, and that is who the viewer is told about.
      name: "a record from before a later sign-in yields to that sign-in",
      agent: { authorizedBy: { subject: "user-a" }, login: login("succeeded", "user-b") },
      local: {},
      expected: { subject: "user-b" },
    },
    {
      name: "a sign-in by somebody else since, recorded, is theirs",
      agent: { authorizedBy: { subject: "user-b" }, login: login("succeeded", "user-b") },
      local: { "claude-code": "user-a" },
      expected: { subject: "user-b" },
    },
    {
      name: "the local record fills in while the server catches up",
      agent: {},
      local: { "claude-code": "user-a" },
      expected: { subject: "user-a" },
    },
    {
      name: "the viewer's own login being checked is theirs before any record",
      agent: { login: login("verifying-code", "user-a") },
      local: {},
      expected: { subject: "user-a" },
    },
    {
      // The server keeps a finished login's state until it restarts: after a failed record
      // write and a reload it vouches for nothing, and the composer must not say "you".
      name: "the viewer's own finished login vouches for nobody by itself",
      agent: { login: login("succeeded", "user-a") },
      local: {},
      expected: undefined,
    },
    {
      name: "the viewer's own finished login with its record being written is theirs",
      agent: { login: login("succeeded", "user-a") },
      local: { "claude-code": "user-a" },
      expected: { subject: "user-a" },
    },
    {
      name: "a colleague's login in flight is not the viewer's",
      agent: { login: login("verifying-code", "user-b") },
      local: {},
      expected: undefined,
    },
    {
      name: "a login that failed vouches for nobody",
      agent: { login: login("failed", "user-a") },
      local: {},
      expected: undefined,
    },
    {
      name: "a login that names no starter vouches for nobody",
      agent: { login: login("verifying-code") },
      local: {},
      expected: undefined,
    },
    {
      name: "neither means nobody",
      agent: {},
      local: {},
      expected: undefined,
    },
  ])("$name", ({ agent, local, expected }) => {
    expect(resolveAgentAuthorizer("claude-code", agent, local, "user-a")).toEqual(expected);
  });
});

class TestNode {
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];
  readonly nodeName: string;
  readonly tagName: string;
  readonly namespaceURI = "http://www.w3.org/1999/xhtml";
  readonly style = {};
  constructor(
    name: string,
    readonly ownerDocument: TestNode | null = null,
    readonly nodeType = 1,
  ) {
    this.nodeName = name.toUpperCase();
    this.tagName = this.nodeName;
  }
  set textContent(_value: string) {
    this.childNodes = [];
  }
  appendChild(child: TestNode) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  removeChild(child: TestNode) {
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    return child;
  }
  createElement(name: string) {
    return new TestNode(name, this);
  }
  get activeElement(): null {
    return null;
  }
  addEventListener() {}
  removeEventListener() {}
  setAttribute() {}
  removeAttribute() {}
  createTextNode(_text: string) {
    return new TestNode("#text", this, 3);
  }
}

function installTestDom(): void {
  const document = new TestNode("#document", null, 9);
  const window = {
    document,
    HTMLIFrameElement: TestNode,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    addEventListener() {},
    removeEventListener() {},
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", window);
  vi.stubGlobal("HTMLIFrameElement", window.HTMLIFrameElement);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
}

const succeeded = (agentId: "claude-code" | "codex"): ZeropsAgentAuthSnapshot => ({
  available: true,
  agents: [
    {
      agentId,
      credPresent: true,
      flagOAuth: true,
      flagToken: false,
      providerAuth: "authenticated",
      state: "authorized",
      login: {
        phase: "succeeded",
        terminalId: "t",
        startedAt: DateTime.makeUnsafe("2026-09-16T10:00:00.000Z"),
        startedBy: "user-a",
      },
    },
  ],
});

describe("useZeropsAgentSignerRecord (H13: a failed write is surfaced, not swallowed)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mock.updateProjectTags.mockReset();
  });

  async function render(
    project: { readonly projectId: string; readonly orgId: string },
    snapshot: ZeropsAgentAuthSnapshot,
  ) {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { useZeropsAgentSignerRecord } = await import("./useZeropsAgentSigner");
    let latest: ReturnType<typeof useZeropsAgentSignerRecord> | undefined;
    function Probe({ current }: { readonly current: ZeropsAgentAuthSnapshot }) {
      latest = useZeropsAgentSignerRecord({ environmentId: ENV, snapshot: current, project });
      return null;
    }
    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe, { current: snapshot }));
    });
    return {
      result: () => latest as ReturnType<typeof useZeropsAgentSignerRecord>,
      rerender: (next: ZeropsAgentAuthSnapshot) =>
        act(async () => {
          root.render(createElement(Probe, { current: next }));
        }),
      unmount: () => act(async () => root.unmount()),
    };
  }

  it("a sign-in whose record failed says so and can be retried", async () => {
    mock.updateProjectTags.mockRejectedValueOnce(new Error("network"));
    const { result, unmount } = await render(PROJECT, succeeded("claude-code"));

    expect(result().recordFailed.has("claude-code")).toBe(true);

    mock.updateProjectTags.mockResolvedValueOnce(undefined);
    await act(async () => {
      result().retry("claude-code");
      await Promise.resolve();
    });
    expect(result().recordFailed.has("claude-code")).toBe(false);
    expect(readLocalAgentSigners(ENV)).toMatchObject({ "claude-code": "user-a" });

    await unmount();
  });

  // user-a's write failed; user-b signs in since. Retrying would write user-a's tag over the
  // record of user-b's sign-in: the failure is no longer user-a's to fix, and nothing is written.
  it("a failed record is not offered again once somebody else has signed in since", async () => {
    vi.useFakeTimers();
    try {
      mock.updateProjectTags.mockRejectedValueOnce(new Error("network"));
      const { result, rerender, unmount } = await render(PROJECT, succeeded("claude-code"));
      expect(result().recordFailed.has("claude-code")).toBe(true);

      const bSignedIn = succeeded("claude-code");
      await rerender({
        ...bSignedIn,
        agents: bSignedIn.agents.map((agent) => ({
          ...agent,
          login: { ...agent.login!, startedBy: "user-b" },
        })),
      });
      expect(result().recordFailed.has("claude-code")).toBe(false);

      mock.updateProjectTags.mockResolvedValue(undefined);
      await act(async () => {
        result().retry("claude-code");
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(mock.updateProjectTags).toHaveBeenCalledTimes(1);
      expect(readLocalAgentSigners(ENV)).toEqual({});
      await unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("a failed write is tried again on its own, and clears when it lands", async () => {
    vi.useFakeTimers();
    try {
      mock.updateProjectTags
        .mockRejectedValueOnce(new Error("network"))
        .mockResolvedValueOnce(undefined);
      const { result, unmount } = await render(PROJECT, succeeded("codex"));
      expect(result().recordFailed.has("codex")).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });

      expect(mock.updateProjectTags).toHaveBeenCalledTimes(2);
      expect(result().recordFailed.has("codex")).toBe(false);
      await unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes once per login, not on every republish", async () => {
    mock.updateProjectTags.mockResolvedValue(undefined);
    const { rerender, unmount } = await render(PROJECT, succeeded("codex"));
    await rerender({ ...succeeded("codex") });
    await rerender({ ...succeeded("codex") });

    expect(mock.updateProjectTags).toHaveBeenCalledTimes(1);
    // A patch on the Mate's own project, applied by the TagWriter to what the project holds now.
    expect(mock.updateProjectTags).toHaveBeenCalledWith(
      { organizationId: "org-1", projectId: "project-1" },
      { kind: "agent-signer", agentId: "codex", userId: "user-a" },
    );
    await unmount();
  });

  // The panel's card and the empty conversation are elsewhere in the tree
  // than the one recorder: they read how it went by environment.
  it("publishes its state for the environment's rows, and withdraws it on unmount", async () => {
    installTestDom();
    mock.updateProjectTags.mockRejectedValueOnce(new Error("network"));
    const { createRoot } = await import("react-dom/client");
    const { useZeropsAgentSignerRecord, useZeropsAgentSignerRecordState } =
      await import("./useZeropsAgentSigner");
    const environmentId = EnvironmentId.make("env-rows");
    let seen: ReadonlySet<string> = new Set();
    function Recorder() {
      useZeropsAgentSignerRecord({ environmentId, snapshot: succeeded("codex"), project: PROJECT });
      return null;
    }
    function Row() {
      seen = useZeropsAgentSignerRecordState(environmentId).recordFailed;
      return null;
    }
    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement("div", null, createElement(Recorder), createElement(Row)));
    });
    expect(seen.has("codex")).toBe(true);

    await act(async () => {
      root.render(createElement(Row));
    });
    expect(seen.size).toBe(0);
    await act(async () => root.unmount());
  });

  it("a successful write never appears as failed", async () => {
    mock.updateProjectTags.mockResolvedValueOnce(undefined);
    const { result, unmount } = await render(PROJECT, succeeded("codex"));

    expect(result().recordFailed.size).toBe(0);

    await unmount();
  });
});
