import type { VaultAskActivityPayload, VaultView } from "@t3tools/client-runtime/data";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import type { ZeropsEnvChange, ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { describe, expect, it } from "vite-plus/test";

import { VAULT_FIXTURE, VAULT_FIXTURE_NOW } from "./vaultFixture";
import {
  type VaultAsk,
  engineVaultAskFor,
  vaultAskEngineFace,
  vaultAskFace,
  vaultAskOf,
  vaultAskPickUp,
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

const stripeAsk: VaultAsk = {
  key: "STRIPE_SECRET_KEY",
  scope: { kind: "shared" },
  sensitive: true,
  reason: "Stripe charges cards.",
  askedAt: ago(10 * MINUTE),
};

function askActivity(
  at: number,
  over: Partial<VaultAskActivityPayload> = {},
): OrchestrationThreadActivity {
  const payload: VaultAskActivityPayload = {
    requestId: `mate/r/1/q/${at}`,
    key: "STRIPE_SECRET_KEY",
    scope: { kind: "shared" },
    sensitive: true,
    reason: "Stripe charges cards.",
    state: "open",
    answer: null,
    ...over,
  };
  return {
    id: `${payload.requestId}#vault`,
    kind: "vault.requested",
    tone: "info",
    summary: "Secret requested",
    payload,
    turnId: null,
    createdAt: ago(at * MINUTE),
  } as unknown as OrchestrationThreadActivity;
}

describe("engineVaultAskFor — the engine's record of the ask a call made", () => {
  it.each([
    {
      name: "the record made as the call closed",
      activities: [askActivity(9)],
      want: "mate/r/1/q/9",
    },
    {
      name: "the first made since the call, when one key was asked twice",
      activities: [askActivity(20), askActivity(9), askActivity(2)],
      want: "mate/r/1/q/9",
    },
    { name: "none made since the call", activities: [askActivity(20)], want: null },
    {
      name: "none for another key",
      activities: [askActivity(9, { key: "OPENAI_API_KEY" })],
      want: null,
    },
    {
      name: "none for another vault",
      activities: [askActivity(9, { scope: { kind: "service", hostname: "appdev" } })],
      want: null,
    },
    { name: "none on a conversation the engine does not keep", activities: undefined, want: null },
  ])("$name", ({ activities, want }) => {
    expect(engineVaultAskFor(activities, stripeAsk)?.requestId ?? null).toBe(want);
  });
});

describe("vaultAskEngineFace — the card of an ask the engine keeps", () => {
  it.each([
    { engine: "open", vault: "open", said: null, want: "open" },
    { engine: "open", vault: "reading", said: null, want: "reading" },
    { engine: "open", vault: "unplaced", said: null, want: "unplaced" },
    // In the vault some other way (the panel): still the person's to answer.
    { engine: "open", vault: "filled", said: null, want: "open" },
    // Answered here, before the engine's record says so: no flash of the open card.
    { engine: "open", vault: "filled", said: "put", want: "saved" },
    { engine: "open", vault: "open", said: "not-now", want: "declined" },
    { engine: "saved", vault: "filled", said: null, want: "saved" },
    { engine: "declined", vault: "open", said: null, want: "declined" },
    { engine: "closed", vault: "open", said: null, want: "closed" },
  ] as const)("$engine, vault $vault, said $said → $want", ({ engine, vault, said, want }) => {
    expect(vaultAskEngineFace(engine, vault, said)).toBe(want);
  });
});

describe("vaultAskPickUp — what the person does for the value to take effect", () => {
  it.each([
    {
      name: "nothing reads it yet: a deploy that references it",
      ask: stripeAsk,
      want: "It takes effect once a service's zerops.yaml references it and that service is deployed.",
    },
    {
      name: "nothing reads a service's own yet",
      ask: { ...stripeAsk, key: "MAIL_FROM", scope: { kind: "service", hostname: "appdev" } },
      want: "It takes effect once appdev's zerops.yaml references it and appdev is deployed.",
    },
    {
      name: "a reader runs the value it started with: restart it",
      ask: { ...stripeAsk, key: "LOG_LEVEL" },
      want: "Restart appdev to use it: a running app keeps the value it started with.",
    },
    {
      name: "every reader runs it already",
      ask: { ...stripeAsk, key: "API_URL" },
      want: "appdev and appstage use it.",
    },
  ] as const)("$name", ({ ask, want }) => {
    expect(vaultAskPickUp(VAULT_FIXTURE, ask)).toBe(want);
  });

  it("says nothing before the vault is read", () => {
    expect(vaultAskPickUp({ ...VAULT_FIXTURE, status: "unread" } as VaultView, stripeAsk)).toBe(
      null,
    );
  });
});
