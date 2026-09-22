import type { ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { act, createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  agentSignInsJustSucceeded,
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
  logins: Readonly<Partial<Record<"claude-code" | "codex", string>>>,
): ZeropsAgentAuthSnapshot => ({
  available: true,
  agents: (["claude-code", "codex"] as const).map((agentId) => ({
    agentId,
    credPresent: true,
    flagOAuth: true,
    flagToken: false,
    providerAuth: "authenticated" as const,
    state: "authorized" as const,
    ...(logins[agentId] === undefined
      ? {}
      : {
          login: {
            phase: logins[agentId] as "succeeded" | "starting" | "failed",
            terminalId: "t",
            startedAt: DateTime.makeUnsafe("2026-09-16T10:00:00.000Z"),
          },
        }),
  })),
});

describe("agentSignInsJustSucceeded", () => {
  it("names the agent whose sign-in has just landed", () => {
    expect(
      agentSignInsJustSucceeded(
        snapshot({ "claude-code": "starting" }),
        snapshot({ "claude-code": "succeeded" }),
      ),
    ).toEqual(["claude-code"]);
  });

  // The snapshot republishes for reasons of its own; a record written on every
  // republish would be a project write on every repaint.
  it("names nobody when the success was already there", () => {
    const already = snapshot({ "claude-code": "succeeded" });
    expect(agentSignInsJustSucceeded(already, already)).toEqual([]);
  });

  it("names nobody while a sign-in is merely in progress", () => {
    expect(agentSignInsJustSucceeded(null, snapshot({ "claude-code": "starting" }))).toEqual([]);
  });

  it("names nobody when a sign-in failed", () => {
    expect(agentSignInsJustSucceeded(null, snapshot({ codex: "failed" }))).toEqual([]);
  });

  // The first snapshot this client ever sees may already carry a success — a
  // login another tab drove, or one this page missed. Recording it is right:
  // the write is idempotent and the alternative is a Mate nobody can run.
  it("records a success already present on the first snapshot", () => {
    expect(agentSignInsJustSucceeded(null, snapshot({ codex: "succeeded" }))).toEqual(["codex"]);
  });

  it("names both when two sign-ins land together", () => {
    expect(
      agentSignInsJustSucceeded(null, snapshot({ "claude-code": "succeeded", codex: "succeeded" })),
    ).toEqual(["claude-code", "codex"]);
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
    function Probe() {
      latest = useZeropsAgentSignerRecord({ snapshot, projectId });
      return null;
    }
    const root = createRoot(document.createElement("div") as unknown as Element);
    await act(async () => {
      root.render(createElement(Probe));
    });
    return {
      result: () => latest as ReturnType<typeof useZeropsAgentSignerRecord>,
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

  it("a successful write never appears as failed", async () => {
    mock.recordProjectAgentSigner.mockResolvedValueOnce(undefined);
    const { result, unmount } = await render("project-1", succeeded("codex"));

    expect(result().recordFailed.size).toBe(0);

    await unmount();
  });
});
