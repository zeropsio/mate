import type { VaultAskActivityPayload, VaultView } from "@t3tools/client-runtime/data";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import type { ZeropsEnvChange, ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { describe, expect, it } from "vite-plus/test";

import { VAULT_FIXTURE, VAULT_FIXTURE_NOW } from "./vaultFixture";
import {
  type VaultAsk,
  engineVaultAskFor,
  openVaultAsk,
  vaultAskFace,
  vaultAskOf,
  vaultAskLine,
  vaultAskLooksLikeZeropsSignIn,
  vaultAskNote,
  vaultAskRestartWords,
  vaultAskResult,
  vaultAskWarning,
  vaultAskReach,
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
        label: null,
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
        label: null,
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
    label: null,
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

describe("vaultAskState — a name the vault keeps hidden", () => {
  const ask = (key: string): VaultAsk => ({
    key,
    label: null,
    scope: { kind: "shared" },
    sensitive: true,
    reason: null,
    askedAt: ago(5 * MINUTE),
  });
  it.each([
    ["MATE_PROBE_TOKEN", "reserved"],
    ["ZCP_API_KEY", "reserved"],
    ["GITEA_URL", "reserved"],
    ["GIT_TOKEN", "reserved"],
    ["NEW_KEY", "open"],
  ] as const)(
    "a name the Mate keeps for itself is never saved from the card, since the vault would hide it: %s → %s",
    (key, want) => {
      expect(vaultAskState(VAULT_FIXTURE, ask(key)).kind).toBe(want);
      expect(
        vaultAskState({ ...VAULT_FIXTURE, status: "unread" } as VaultView, ask(key)).kind,
      ).toBe(want === "reserved" ? "reserved" : "reading");
    },
  );
});

describe("vaultAskWrite — the one write a put makes", () => {
  const ask = {
    key: "LOG_LEVEL",
    label: null,
    scope: { kind: "shared" } as const,
    sensitive: true,
    reason: null,
    askedAt: ago(5 * MINUTE),
  };
  it("adds a key the vault does not hold, kept as asked", () => {
    expect(vaultAskWrite({ ...ask, key: "NEW_KEY" }, null, "v4lue", ask.sensitive)).toEqual({
      kind: "add",
      key: "NEW_KEY",
      value: "v4lue",
      sensitive: true,
    });
  });
  it("updates the value it holds, the flag always sent", () => {
    const held = VAULT_FIXTURE.scopes[0]!.values.find((value) => value.key === "LOG_LEVEL")!;
    expect(vaultAskWrite({ ...ask, sensitive: false }, held, "info", false)).toEqual({
      kind: "update",
      id: "v-log",
      key: "LOG_LEVEL",
      value: "info",
      sensitive: false,
    });
  });
});

describe("vaultAskWrite — whose word makes it secret", () => {
  const ask = {
    key: "NEW_KEY",
    label: null,
    scope: { kind: "shared" } as const,
    sensitive: false,
    reason: null,
    askedAt: ago(5 * MINUTE),
  };
  const heldSecret = VAULT_FIXTURE.scopes[0]!.values.find((v) => v.key === "STRIPE_SECRET_KEY")!;
  const heldPlain = VAULT_FIXTURE.scopes[0]!.values.find((v) => v.key === "LOG_LEVEL")!;
  it.each([
    { name: "a new value the person keeps secret", held: null, secret: true, want: true },
    { name: "a new value the person makes plain", held: null, secret: false, want: false },
    {
      name: "a held secret the person would make plain",
      held: heldSecret,
      secret: false,
      want: true,
    },
    {
      name: "a held plain value the person makes secret",
      held: heldPlain,
      secret: true,
      want: true,
    },
    { name: "a held plain value kept plain", held: heldPlain, secret: false, want: false },
  ])(
    "a secret is stored sensitive unless the person chooses otherwise: $name",
    ({ held, secret, want }) => {
      expect(vaultAskWrite(ask, held, "v", secret).sensitive).toBe(want);
    },
  );
});

describe("vaultAskReach — who can read it, in our words", () => {
  it.each([
    {
      name: "Shared reaches every app",
      ask: { key: "API_KEY", scope: { kind: "shared" } as const },
      want: "Every app in this project can read it, Fen included. Never paste your own password or Zerops token.",
    },
    {
      name: "an app's own reaches that app",
      ask: { key: "API_KEY", scope: { kind: "service", hostname: "appdev" } as const },
      want: "appdev reads it, and Fen can reach it. Never paste your own password or Zerops token.",
    },
  ])("$name", ({ ask, want }) => {
    expect(vaultAskReach(ask, "Fen")).toBe(want);
  });

  // Milo, 2026-10-10: "MATE_PROBE_TOKEN looks like a Zerops sign-in" fired on the MATE prefix.
  it.each([
    ["ZEROPS_TOKEN", true],
    ["MY_ZEROPS_API_TOKEN", true],
    ["ZEROPS_TOKEN_PROD", true],
    ["ZEROPS_PASSWORD", true],
    ["ZCP_API_KEY", true],
    ["ZCP_TOKEN", true],
    ["ZCP_SETUP_RUNTIMES", false],
    ["ZEROPS_SUBDOMAIN", false],
    ["MATE_PROBE_TOKEN", false],
    ["GITEA_PASSWORD", false],
    ["GIT_TOKEN", false],
    ["STRIPE_SECRET_KEY", false],
    ["SMTP_PASSWORD", false],
    ["ESTIMATE_URL", false],
  ] as const)("%s looks like a Zerops sign-in: %s", (key, want) => {
    expect(vaultAskLooksLikeZeropsSignIn(key)).toBe(want);
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
  label: null,
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
    label: null,
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

describe("the ask in the composer drawer, in words", () => {
  const stripe: VaultAsk = {
    key: "STRIPE_SECRET_KEY",
    label: "Stripe secret key",
    scope: { kind: "shared" },
    sensitive: true,
    reason: "for checkout",
    askedAt: ago(5 * MINUTE),
  };
  it.each([
    {
      name: "labelled, with its why",
      ask: stripe,
      want: "Milo needs your Stripe secret key, for checkout",
    },
    {
      name: "a why written as a sentence",
      ask: { ...stripe, reason: "For the questionnaire API." },
      want: "Milo needs your Stripe secret key, for the questionnaire API",
    },
    {
      name: "from a zcp that names no label",
      ask: { ...stripe, label: null, reason: null },
      want: "Milo needs your STRIPE_SECRET_KEY",
    },
  ])("one line says what Milo needs and why: $name", ({ ask, want }) => {
    expect(vaultAskLine(ask, "Milo")).toBe(want);
  });

  it.each([
    {
      state: "open",
      ask: stripe,
      want: "Goes to this project's vault for every app, never into this chat.",
    },
    {
      state: "open",
      ask: { ...stripe, scope: { kind: "service", hostname: "apidev" } as const },
      want: "Goes to apidev's vault, never into this chat.",
    },
    {
      state: "reading",
      ask: stripe,
      want: "Goes to this project's vault for every app, never into this chat.",
    },
    { state: "filled", ask: stripe, want: "You added it in the Vault." },
    {
      state: "reserved",
      ask: { ...stripe, key: "MATE_PROBE_TOKEN" },
      want: "MATE_PROBE_TOKEN is a name Milo keeps for itself, so the vault won't list it.",
    },
    {
      state: "unplaced",
      ask: { ...stripe, scope: { kind: "service", hostname: "gone" } as const },
      want: "gone isn't in this project any more.",
    },
  ] as const)("one plain sentence says what happens: $state", ({ state, ask, want }) => {
    expect(vaultAskNote(ask, state, "Milo")).toBe(want);
  });

  it.each([
    ["ZEROPS_TOKEN", "Looks like a Zerops sign-in. Milo never needs yours."],
    ["STRIPE_SECRET_KEY", null],
    ["MATE_PROBE_TOKEN", null],
  ] as const)("the one warning, only for a Zerops sign-in: %s", (key, want) => {
    expect(vaultAskWarning({ ...stripe, key }, "Milo")).toBe(want);
  });
});

describe("the answered ask as a result row of the run that asked", () => {
  const ask = (key: string, hostname: string | null = null): VaultAsk => ({
    key,
    label: "Stripe secret key",
    scope: hostname === null ? { kind: "shared" } : { kind: "service", hostname },
    sensitive: true,
    reason: null,
    askedAt: ago(5 * MINUTE),
  });
  it.each([
    {
      name: "saved for every app, hidden, nothing reads it yet",
      ask: ask("STRIPE_SECRET_KEY"),
      engine: "saved",
      want: { title: "Stripe secret key", words: "added for every app · hidden", restart: [] },
    },
    {
      name: "saved, an app runs the value it started with",
      ask: ask("LOG_LEVEL"),
      engine: "saved",
      want: {
        title: "Stripe secret key",
        words: "added for every app",
        restart: [{ serviceId: "svc-appdev", hostname: "appdev" }],
      },
    },
    {
      name: "saved for one app's own",
      ask: ask("FEATURE_FLAGS", "appdev"),
      engine: "saved",
      want: { title: "Stripe secret key", words: "added for appdev", restart: [] },
    },
    {
      name: "not given",
      ask: ask("STRIPE_SECRET_KEY"),
      engine: "declined",
      want: { title: "Stripe secret key", words: "Not now", restart: [] },
    },
    {
      name: "still asked: the drawer holds it",
      ask: ask("STRIPE_SECRET_KEY"),
      engine: "open",
      want: null,
    },
  ] as const)("$name", ({ ask, engine, want }) => {
    expect(vaultAskResult(ask, engine, VAULT_FIXTURE)).toEqual(want);
  });

  it("words the restart the row offers", () => {
    expect(vaultAskRestartWords([{ serviceId: "svc-appdev", hostname: "appdev" }])).toBe(
      "restart appdev to use it",
    );
  });
});

describe("openVaultAsk — the ask the composer's drawer holds", () => {
  const record = (requestId: string, state: VaultAskActivityPayload["state"], minutesAgo: number) =>
    askActivity(minutesAgo, { requestId, state, label: "Stripe secret key" });
  it.each([
    { name: "none asked", activities: [], want: null },
    { name: "one open", activities: [record("q1", "open", 3)], want: "q1" },
    {
      name: "the oldest open first",
      activities: [record("q2", "open", 1), record("q1", "open", 3)],
      want: "q1",
    },
    {
      name: "an answered one leaves it",
      activities: [record("q1", "saved", 3), record("q2", "open", 1)],
      want: "q2",
    },
    { name: "every one answered", activities: [record("q1", "declined", 3)], want: null },
  ])("$name", ({ activities, want }) => {
    expect(openVaultAsk(activities)?.requestId ?? null).toBe(want);
  });

  it("reads the record as the ask the drawer words", () => {
    const open = openVaultAsk([record("q1", "open", 3)]);
    expect(open?.ask).toEqual({
      key: "STRIPE_SECRET_KEY",
      label: "Stripe secret key",
      scope: { kind: "shared" },
      sensitive: true,
      reason: "Stripe charges cards.",
      askedAt: ago(3 * MINUTE),
    });
  });
});
