import type { ZeropsAgentAuthSnapshot } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  agentSignInsJustSucceeded,
  localSignersSettledBy,
  readLocalAgentSigners,
  rememberLocalAgentSigner,
  resolveAgentAuthorizer,
  subscribeLocalAgentSigners,
} from "./useZeropsAgentSigner";

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
