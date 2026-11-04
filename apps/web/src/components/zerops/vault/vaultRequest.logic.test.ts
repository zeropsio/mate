import type { VaultAskActivityPayload, VaultView } from "@t3tools/client-runtime/data";
import type { OrchestrationThreadActivity } from "@t3tools/contracts";
import type { ZeropsEnvChange, ZeropsOperation } from "@t3tools/client-runtime/zerops/model";
import { describe, expect, it } from "vite-plus/test";

import { askWhereWords } from "../../ask/ask.logic";

import { VAULT_FIXTURE, VAULT_FIXTURE_NOW } from "./vaultFixture";
import {
  type VaultAsk,
  engineVaultAskFor,
  openVaultAsk,
  vaultAskOf,
  vaultAskLooksLikeZeropsSignIn,
  vaultAskRestartWords,
  vaultAskResult,
  vaultAskRowHolds,
  vaultAskView,
  vaultAskWarning,
  vaultAskState,
  vaultAskWrite,
  type VaultAskSource,
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

describe("vaultAskLooksLikeZeropsSignIn — the card warns before a Zerops sign-in is given", () => {
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

describe("vaultAskView — the ask's card, read off the engine's record and the vault", () => {
  const ana = { kind: "person", subject: "user-ana" } as const;
  const asked = (over: Partial<VaultAsk> = {}): VaultAsk => ({
    key: "NEW_STRIPE_KEY",
    label: "Stripe secret key",
    scope: { kind: "shared" },
    sensitive: true,
    reason: "for checkout",
    askedAt: ago(5 * MINUTE),
    ...over,
  });
  const unread: VaultView = { status: "unread", complete: false, scopes: [], notLive: [] };
  const source = (over: Partial<VaultAskSource> & { readonly view?: VaultView } = {}) => {
    const { view = VAULT_FIXTURE, ...rest } = over;
    const ask = rest.ask ?? asked();
    return {
      ask,
      mateName: "Fen",
      record: { state: "open", answer: null },
      vault: vaultAskState(view, ask),
      pending: null,
      refusal: null,
      nameOf: (subject: string) => (subject === "user-ana" ? "Aleš" : undefined),
      clock: () => "15:04",
      ...rest,
    } satisfies VaultAskSource;
  };
  const answered = (state: "saved" | "declined" | "closed", by = ana) =>
    ({ state, answer: state === "closed" ? null : { by, at: VAULT_FIXTURE_NOW } }) as const;

  it.each([
    {
      name: "asked: the field, Save to vault and Not now",
      source: source(),
      want: { state: "waiting", body: "field", main: "Save to vault" },
    },
    {
      name: "the vault not read yet: the field waits for it",
      source: source({ view: unread }),
      want: { state: "waiting", body: "field-waiting", main: "Save to vault" },
    },
    {
      name: "given in the Vault since it was asked: offered as the answer",
      source: source({ ask: asked({ key: "STRIPE_SECRET_KEY" }) }),
      want: { state: "waiting", body: "given", main: "Use that one" },
    },
    {
      name: "a save under way",
      source: source({ pending: "save" }),
      want: { state: "working", body: "field", main: "Save to vault" },
    },
    {
      name: "a refused save: the field kept to try again",
      source: source({ refusal: "The key exists already." }),
      want: { state: "failed", body: "field", main: "Save to vault" },
    },
    {
      name: "a name the Mate keeps for itself: nothing to save, Not now only",
      source: source({ ask: asked({ key: "MATE_PROBE_TOKEN" }) }),
      want: { state: "failed", body: "none", main: null },
    },
    {
      name: "a service no longer in the project: nothing to save",
      source: source({ ask: asked({ scope: { kind: "service", hostname: "gone" } }) }),
      want: { state: "failed", body: "none", main: null },
    },
    {
      name: "saved: the result, with nothing left to press",
      source: source({ record: answered("saved") }),
      want: { state: "done", body: "none", main: null },
    },
    {
      name: "Not now on the record",
      source: source({ record: answered("declined") }),
      want: { state: "notNow", body: "none", main: null },
    },
    {
      name: "closed without an answer",
      source: source({ record: answered("closed") }),
      want: { state: "replaced", body: "none", main: null },
    },
    {
      name: "the record outranks a press still under way here",
      source: source({ record: answered("saved"), pending: "save" }),
      want: { state: "done", body: "none", main: null },
    },
  ])("$name", ({ source: given, want }) => {
    const view = vaultAskView(given);
    expect({
      state: view.state.kind,
      body:
        view.body.kind === "field" ? (view.body.ready ? "field" : "field-waiting") : view.body.kind,
      main: view.main?.label ?? null,
    }).toEqual(want);
  });

  it.each([
    {
      name: "every app",
      ask: asked(),
      want: { where: "This Mate · every app", title: "Add NEW_STRIPE_KEY to Fen's vault" },
    },
    {
      name: "an app's own",
      ask: asked({ key: "MAIL_FROM", scope: { kind: "service", hostname: "appdev" } }),
      want: { where: "This Mate · appdev", title: "Add MAIL_FROM to appdev's vault" },
    },
  ])("the chip and the title name where the value goes: $name", ({ ask, want }) => {
    const view = vaultAskView(source({ ask }));
    expect({ where: askWhereWords(view.where), title: view.title }).toEqual(want);
  });

  it.each([
    {
      name: "saved hidden, by a person",
      source: source({ ask: asked({ key: "STRIPE_SECRET_KEY" }), record: answered("saved") }),
      want: {
        words: "In Fen's vault · hidden · set by Aleš",
        told: "Fen hears: STRIPE_SECRET_KEY is saved for every app",
      },
    },
    {
      name: "saved to an app's own, the vault not read",
      source: source({
        ask: asked({ key: "MAIL_FROM", scope: { kind: "service", hostname: "appdev" } }),
        record: answered("saved"),
        view: unread,
      }),
      want: {
        words: "In appdev's vault · set by Aleš",
        told: "Fen hears: MAIL_FROM is saved for appdev",
      },
    },
    {
      name: "saved by nobody the record names",
      source: source({
        ask: asked({ key: "STRIPE_SECRET_KEY" }),
        record: answered("saved", { kind: "engine" } as never),
      }),
      want: {
        words: "In Fen's vault · hidden",
        told: "Fen hears: STRIPE_SECRET_KEY is saved for every app",
      },
    },
  ])("done says the real result and who: $name", ({ source: given, want }) => {
    const { state } = vaultAskView(given);
    expect(state.kind === "done" ? { words: state.words, told: state.told } : null).toEqual(want);
  });

  it.each([
    {
      name: "Not now, who and when",
      source: source({ record: answered("declined") }),
      want: "Not now · Aleš, 15:04",
    },
    {
      name: "closed some other way",
      source: source({ record: answered("closed") }),
      want: "Fen isn't waiting on this any more.",
    },
    {
      name: "a refusal, in Zerops' words",
      source: source({ refusal: "The key exists already." }),
      want: "The key exists already.",
    },
    {
      name: "a name the Mate keeps",
      source: source({ ask: asked({ key: "MATE_PROBE_TOKEN" }) }),
      want: "MATE_PROBE_TOKEN is a name Fen keeps for itself, so the vault won't list it.",
    },
    {
      name: "a service gone",
      source: source({ ask: asked({ scope: { kind: "service", hostname: "gone" } }) }),
      want: "gone isn't in this project any more.",
    },
  ])("a settled or failed card says it in the source's words: $name", ({ source: given, want }) => {
    const { state } = vaultAskView(given);
    expect("words" in state ? state.words : null).toBe(want);
  });

  it("the value given since it was asked says it is there, hidden as the vault keeps it", () => {
    const { body } = vaultAskView(source({ ask: asked({ key: "STRIPE_SECRET_KEY" }) }));
    expect(body).toEqual({ kind: "given", words: "Added in the Vault since Fen asked · hidden" });
  });
});

describe("vaultAskRowHolds — Show in conversation finds the ask's card", () => {
  const rows = [
    { kind: "vault-request", operation: sharedAsk("STRIPE_SECRET_KEY") },
    { kind: "message" },
    { kind: "vault-request", operation: sharedAsk("OTHER_KEY", { anchorAt: ago(20 * MINUTE) }) },
    {
      kind: "vault-request",
      operation: sharedAsk("STRIPE_SECRET_KEY", { anchorAt: ago(10 * MINUTE) }),
    },
  ];
  it.each([
    { name: "the call that asked before the record", recordedAgo: 30, want: 0 },
    { name: "the latest call when the key was asked twice", recordedAgo: 9, want: 3 },
    { name: "none recorded before any call", recordedAgo: 90, want: -1 },
  ])("$name", ({ recordedAgo, want }) => {
    const holds = vaultAskRowHolds({
      key: "STRIPE_SECRET_KEY",
      scope: { kind: "shared" },
      askedAt: ago(recordedAgo * MINUTE),
    });
    expect(rows.findLastIndex(holds)).toBe(want);
  });
});
