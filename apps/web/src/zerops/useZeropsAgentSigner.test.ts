import { EnvironmentId, type ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  agentSignersToRecord,
  localSignersSettledBy,
  readLocalAgentSigners,
  rememberLocalAgentSigner,
  resolveAgentAuthorizer,
  subscribeLocalAgentSigners,
} from "./useZeropsAgentSigner";

const mock = vi.hoisted(() => ({
  recordProjectAgentSigner: vi.fn(),
}));
vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    client: { recordProjectAgentSigner: mock.recordProjectAgentSigner },
    user: { id: "user-a" },
  }),
}));

const snapshot = (
  logins: Readonly<
    Partial<
      Record<
        "claude-code" | "codex",
        { readonly phase: "succeeded" | "starting" | "failed"; readonly startedBy: string }
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
      name: "both agents at once",
      logins: {
        "claude-code": { phase: "succeeded", startedBy: "user-a" },
        codex: { phase: "succeeded", startedBy: "user-a" },
      },
      authorizedBy: {},
      expected: ["claude-code", "codex"],
    },
  ] as const)("$name", ({ logins, authorizedBy, expected }) => {
    expect(agentSignersToRecord(snapshot(logins, authorizedBy), "user-a")).toEqual(expected);
  });

  it("names nobody without a signed-in viewer", () => {
    expect(
      agentSignersToRecord(
        snapshot({ codex: { phase: "succeeded", startedBy: "user-a" } }),
        undefined,
      ),
    ).toEqual([]);
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
    rememberLocalAgentSigner("claude-code", "user-a");
    expect(readLocalAgentSigners()).toEqual({ "claude-code": "user-a" });
    expect(seen).toEqual([0]);
    // The same fact again is not a change.
    rememberLocalAgentSigner("claude-code", "user-a");
    expect(seen).toEqual([0]);
    unsubscribe();
    localSignersSettledBy(authorized({ "claude-code": "user-a" }));
  });

  it("forgets an entry once the snapshot carries that agent's signer, and keeps the others", () => {
    rememberLocalAgentSigner("claude-code", "user-a");
    rememberLocalAgentSigner("codex", "user-a");
    localSignersSettledBy(authorized({ "claude-code": "user-a" }));
    expect(readLocalAgentSigners()).toEqual({ codex: "user-a" });
    localSignersSettledBy(authorized({ codex: "user-b" }));
    expect(readLocalAgentSigners()).toEqual({});
  });

  it("keeps the store's identity when a snapshot settles nothing", () => {
    rememberLocalAgentSigner("codex", "user-a");
    const before = readLocalAgentSigners();
    localSignersSettledBy(authorized({}));
    expect(readLocalAgentSigners()).toBe(before);
    localSignersSettledBy(authorized({ codex: "user-a" }));
  });

  it.each([
    {
      name: "the snapshot's authorizer wins",
      authorizedBy: { subject: "user-b" },
      local: { "claude-code": "user-a" },
      expected: { subject: "user-b" },
    },
    {
      name: "the local record fills in while the server catches up",
      authorizedBy: undefined,
      local: { "claude-code": "user-a" },
      expected: { subject: "user-a" },
    },
    {
      name: "neither means nobody",
      authorizedBy: undefined,
      local: {},
      expected: undefined,
    },
  ])("$name", ({ authorizedBy, local, expected }) => {
    expect(resolveAgentAuthorizer("claude-code", authorizedBy, local)).toEqual(expected);
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
    mock.recordProjectAgentSigner.mockReset();
  });

  async function render(projectId: string, snapshot: ZeropsAgentAuthSnapshot) {
    installTestDom();
    const { createRoot } = await import("react-dom/client");
    const { useZeropsAgentSignerRecord } = await import("./useZeropsAgentSigner");
    let latest: ReturnType<typeof useZeropsAgentSignerRecord> | undefined;
    function Probe({ current }: { readonly current: ZeropsAgentAuthSnapshot }) {
      latest = useZeropsAgentSignerRecord({ environmentId: null, snapshot: current, projectId });
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
    mock.recordProjectAgentSigner.mockRejectedValueOnce(new Error("network"));
    const { result, unmount } = await render("project-1", succeeded("claude-code"));

    expect(result().recordFailed.has("claude-code")).toBe(true);

    mock.recordProjectAgentSigner.mockResolvedValueOnce(undefined);
    await act(async () => {
      result().retry("claude-code");
      await Promise.resolve();
    });
    expect(result().recordFailed.has("claude-code")).toBe(false);
    expect(readLocalAgentSigners()).toMatchObject({ "claude-code": "user-a" });

    await unmount();
  });

  it("a failed write is tried again on its own, and clears when it lands", async () => {
    vi.useFakeTimers();
    try {
      mock.recordProjectAgentSigner
        .mockRejectedValueOnce(new Error("network"))
        .mockResolvedValueOnce(undefined);
      const { result, unmount } = await render("project-1", succeeded("codex"));
      expect(result().recordFailed.has("codex")).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });

      expect(mock.recordProjectAgentSigner).toHaveBeenCalledTimes(2);
      expect(result().recordFailed.has("codex")).toBe(false);
      await unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("writes once per login, not on every republish", async () => {
    mock.recordProjectAgentSigner.mockResolvedValue(undefined);
    const { rerender, unmount } = await render("project-1", succeeded("codex"));
    await rerender({ ...succeeded("codex") });
    await rerender({ ...succeeded("codex") });

    expect(mock.recordProjectAgentSigner).toHaveBeenCalledTimes(1);
    await unmount();
  });

  // The panel's card and the empty conversation are elsewhere in the tree
  // than the one recorder: they read how it went by environment.
  it("publishes its state for the environment's rows, and withdraws it on unmount", async () => {
    installTestDom();
    mock.recordProjectAgentSigner.mockRejectedValueOnce(new Error("network"));
    const { createRoot } = await import("react-dom/client");
    const { useZeropsAgentSignerRecord, useZeropsAgentSignerRecordState } =
      await import("./useZeropsAgentSigner");
    const environmentId = EnvironmentId.make("env-rows");
    let seen: ReadonlySet<string> = new Set();
    function Recorder() {
      useZeropsAgentSignerRecord({ environmentId, snapshot: succeeded("codex"), projectId: "p" });
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
    mock.recordProjectAgentSigner.mockResolvedValueOnce(undefined);
    const { result, unmount } = await render("project-1", succeeded("codex"));

    expect(result().recordFailed.size).toBe(0);

    await unmount();
  });
});
