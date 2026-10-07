import type { VaultView } from "@t3tools/client-runtime/data";
import type { ZeropsEnvChange, ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { describe, expect, it } from "vite-plus/test";

import { VAULT_FIXTURE, VAULT_FIXTURE_NOW } from "./vaultFixture";
import {
  type VaultAsk,
  vaultAskFace,
  vaultAskOf,
  vaultAskState,
  vaultAskWrite,
} from "./vaultRequest.logic";

const MINUTE = 60_000;
const ago = (ms: number) => new Date(VAULT_FIXTURE_NOW - ms).toISOString();

function envOperation(
  envChange: ZeropsEnvChange,
  over: Partial<ZeropsOperation> = {},
): ZeropsOperation {
  return {
    key: "op:c1",
    kind: "env",
    phase: "done",
    anchorAt: ago(60 * MINUTE),
    anchorActivityId: "a1",
    turnId: "t1",
    subject: "the project",
    kicker: "Env · the project",
    voice: "Asking for STRIPE_SECRET_KEY.",
    voiceSource: "mate",
    statusWord: "Done",
    steps: [],
    links: [],
    callIds: ["c1"],
    hasResult: true,
    envChange,
    ...over,
  };
}

const sharedAsk = (key: string, over: Partial<ZeropsOperation> = {}) =>
  envOperation(
    {
      action: "request",
      scope: "project",
      request: { key, sensitive: true, reason: "Stripe charges cards.", alreadySet: false },
    },
    over,
  );

describe("vaultAskOf — which env calls ask the person for a value", () => {
  it.each([
    {
      name: "a Shared request that returned",
      operation: sharedAsk("STRIPE_SECRET_KEY"),
      want: {
        key: "STRIPE_SECRET_KEY",
        scope: { kind: "shared" },
        sensitive: true,
        reason: "Stripe charges cards.",
        askedAt: ago(60 * MINUTE),
      },
    },
    {
      name: "a service's request, no reason",
      operation: envOperation({
        action: "request",
        scope: "service",
        service: "appdev",
        request: { key: "MAIL_FROM", sensitive: false, alreadySet: false },
      }),
      want: {
        key: "MAIL_FROM",
        scope: { kind: "service", hostname: "appdev" },
        sensitive: false,
        reason: null,
        askedAt: ago(60 * MINUTE),
      },
    },
    { name: "still on its way", operation: sharedAsk("X_KEY", { phase: "running" }), want: null },
    { name: "refused by zcp", operation: sharedAsk("X_KEY", { phase: "failed" }), want: null },
    {
      name: "the key was in the vault already",
      operation: envOperation({
        action: "request",
        scope: "project",
        request: { key: "X_KEY", sensitive: true, alreadySet: true },
      }),
      want: null,
    },
    {
      name: "a set is no request",
      operation: envOperation({ action: "set", scope: "project", count: 1 }),
      want: null,
    },
    {
      name: "a request naming no key",
      operation: envOperation({ action: "request", scope: "project" }),
      want: null,
    },
  ])("$name", ({ operation, want }) => {
    expect(vaultAskOf(operation)).toEqual(want);
  });
});

describe("vaultAskState — where the asked value stands, read off the vault", () => {
  const ask = (key: string, askedMinutesAgo: number, hostname: string | null = null): VaultAsk => ({
    key,
    scope: hostname === null ? { kind: "shared" } : { kind: "service", hostname },
    sensitive: true,
    reason: null,
    askedAt: ago(askedMinutesAgo * MINUTE),
  });
  const unread: VaultView = { status: "unread", complete: false, scopes: [], notLive: [] };

  it.each([
    { name: "the vault not read yet", view: unread, ask: ask("NEW_KEY", 5), want: "reading" },
    {
      name: "not in the vault: open, to add",
      view: VAULT_FIXTURE,
      ask: ask("NEW_KEY", 5),
      want: "open",
    },
    {
      name: "written after it was asked: filled",
      view: VAULT_FIXTURE,
      ask: ask("STRIPE_SECRET_KEY", 5),
      want: "filled",
    },
    {
      name: "written before it was asked: open, to update",
      view: VAULT_FIXTURE,
      ask: ask("LOG_LEVEL", 5),
      want: "open",
    },
    {
      name: "a service's own vault, by hostname",
      view: VAULT_FIXTURE,
      ask: ask("NEW_KEY", 5, "appdev"),
      want: "open",
    },
    {
      name: "a service the project no longer has",
      view: VAULT_FIXTURE,
      ask: ask("NEW_KEY", 5, "gone"),
      want: "unplaced",
    },
  ] as const)("$name", ({ view, ask: asked, want }) => {
    expect(vaultAskState(view, asked).kind).toBe(want);
  });

  it("an open ask names the scope it goes to and the value it replaces", () => {
    const state = vaultAskState(VAULT_FIXTURE, ask("LOG_LEVEL", 5));
    expect(state.kind === "open" ? [state.ref, state.held?.id] : null).toEqual([
      { kind: "shared" },
      "v-log",
    ]);
    const service = vaultAskState(VAULT_FIXTURE, ask("NEW_KEY", 5, "appdev"));
    expect(service.kind === "open" ? [service.ref, service.held] : null).toEqual([
      { kind: "service", serviceId: "svc-appdev" },
      null,
    ]);
  });
});

describe("vaultAskWrite — the one write a put makes", () => {
  const ask = {
    key: "LOG_LEVEL",
    scope: { kind: "shared" } as const,
    sensitive: true,
    reason: null,
    askedAt: ago(5 * MINUTE),
  };
  it("adds a key the vault does not hold, kept as asked", () => {
    expect(vaultAskWrite({ ...ask, key: "NEW_KEY" }, null, "v4lue")).toEqual({
      kind: "add",
      key: "NEW_KEY",
      value: "v4lue",
      sensitive: true,
    });
  });
  it("updates the value it holds, the flag always sent", () => {
    const held = VAULT_FIXTURE.scopes[0]!.values.find((value) => value.key === "LOG_LEVEL")!;
    expect(vaultAskWrite({ ...ask, sensitive: false }, held, "info")).toEqual({
      kind: "update",
      id: "v-log",
      key: "LOG_LEVEL",
      value: "info",
      sensitive: false,
    });
  });
});

describe("vaultAskFace — what the card draws", () => {
  it.each([
    { state: "open", said: null, want: "open" },
    { state: "open", said: "not-now", want: "not-now" },
    { state: "open", said: "put", want: "put" },
    { state: "filled", said: "put", want: "put" },
    { state: "filled", said: null, want: "filled" },
    { state: "filled", said: "not-now", want: "filled" },
    { state: "reading", said: null, want: "reading" },
    { state: "unplaced", said: null, want: "unplaced" },
  ] as const)("$state, said $said → $want", ({ state, said, want }) => {
    expect(vaultAskFace(state, said)).toBe(want);
  });
});
