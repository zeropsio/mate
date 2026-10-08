import { assert, describe, it } from "@effect/vitest";
import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { isProviderReadyToRun } from "@t3tools/shared/zeropsAgentAuth";

import {
  isBootstrapDecidable,
  isProbePendingProvider,
  pickBootstrapProvider,
  pickReadyAgentWithoutSignIn,
  resolveBootstrapModelSlug,
  resolveZeropsBootstrapModelSelection,
} from "./ZeropsBootstrapModel.ts";

const provider = (overrides: Partial<ServerProvider> & Pick<ServerProvider, "driver">) =>
  ({
    instanceId: ProviderInstanceId.make(overrides.driver),
    displayName: overrides.driver,
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-08-28T00:00:00.000Z",
    models: [
      { slug: "model-a", name: "Model A", isCustom: false, capabilities: null },
      { slug: "model-b", name: "Model B", isCustom: false, capabilities: null },
    ],
    slashCommands: [],
    skills: [],
    ...overrides,
  }) satisfies ServerProvider;

const CLAUDE = ProviderDriverKind.make("claudeAgent");
const CODEX = ProviderDriverKind.make("codex");
const CURSOR = ProviderDriverKind.make("cursor");

const readyClaude = provider({
  driver: CLAUDE,
  models: [
    { slug: "claude-opus-5", name: "Opus 5", isCustom: false, capabilities: null },
    { slug: "claude-opus-5-5", name: "Opus 5.5", isCustom: false, capabilities: null },
  ],
});

/** How an unauthenticated Codex CLI reports itself — see `CodexProvider.ts`. */
const unauthenticatedCodex = provider({
  driver: CODEX,
  status: "error",
  auth: { status: "unauthenticated" },
  models: [{ slug: DEFAULT_MODEL, name: "GPT", isCustom: false, capabilities: null }],
});

const readyCodex = provider({
  driver: CODEX,
  models: [{ slug: DEFAULT_MODEL, name: "GPT", isCustom: false, capabilities: null }],
});

describe("isProviderReadyToRun, as the bootstrap reads it", () => {
  it("accepts an enabled, installed, ready, authenticated provider with models", () => {
    assert.isTrue(isProviderReadyToRun(readyClaude));
  });

  it("rejects an unauthenticated provider", () => {
    assert.isFalse(isProviderReadyToRun(unauthenticatedCodex));
  });

  it("rejects a provider that reports ready but explicitly unauthenticated", () => {
    assert.isFalse(
      isProviderReadyToRun(
        provider({ driver: CLAUDE, status: "ready", auth: { status: "unauthenticated" } }),
      ),
    );
  });

  it("accepts a ready provider whose auth status is unknown", () => {
    assert.isTrue(isProviderReadyToRun(provider({ driver: CODEX, auth: { status: "unknown" } })));
  });

  it("rejects a disabled, uninstalled, unavailable or model-less provider", () => {
    assert.isFalse(isProviderReadyToRun(provider({ driver: CLAUDE, enabled: false })));
    assert.isFalse(isProviderReadyToRun(provider({ driver: CLAUDE, installed: false })));
    assert.isFalse(isProviderReadyToRun(provider({ driver: CLAUDE, availability: "unavailable" })));
    assert.isFalse(isProviderReadyToRun(provider({ driver: CLAUDE, models: [] })));
  });
});

describe("resolveBootstrapModelSlug", () => {
  it("prefers the manifest default when the provider actually offers it", () => {
    assert.equal(resolveBootstrapModelSlug(readyClaude), DEFAULT_MODEL_BY_PROVIDER[CLAUDE]);
    assert.equal(resolveBootstrapModelSlug(readyCodex), DEFAULT_MODEL);
  });

  it("falls back to the snapshot's own default flag when the manifest default is absent", () => {
    const snapshot = provider({
      driver: CLAUDE,
      models: [
        { slug: "claude-opus-5", name: "Opus 5", isCustom: false, capabilities: null },
        {
          slug: "claude-opus-4-8",
          name: "Opus 4.8",
          isCustom: false,
          isDefault: true,
          capabilities: null,
        },
      ],
    });
    assert.equal(resolveBootstrapModelSlug(snapshot), "claude-opus-4-8");
  });

  it("falls back to the first offered model when nothing is flagged", () => {
    assert.equal(resolveBootstrapModelSlug(provider({ driver: CURSOR })), "model-a");
  });
});

describe("pickBootstrapProvider", () => {
  it("prefers Claude over Codex when both are ready", () => {
    assert.equal(pickBootstrapProvider([readyCodex, readyClaude])?.driver, CLAUDE);
  });

  it("picks Codex when Claude is not ready", () => {
    const unreadyClaude = provider({ driver: CLAUDE, status: "error" });
    assert.equal(pickBootstrapProvider([unreadyClaude, readyCodex])?.driver, CODEX);
  });

  it("falls through to any other ready provider when neither preferred driver is ready", () => {
    const readyCursor = provider({ driver: CURSOR });
    assert.equal(pickBootstrapProvider([unauthenticatedCodex, readyCursor])?.driver, CURSOR);
  });

  it("returns undefined when nothing is ready", () => {
    assert.isUndefined(pickBootstrapProvider([unauthenticatedCodex]));
    assert.isUndefined(pickBootstrapProvider([]));
  });
});

describe("resolveZeropsBootstrapModelSelection", () => {
  it("returns the preferred ready provider's instance and its default model", () => {
    assert.deepStrictEqual(
      resolveZeropsBootstrapModelSelection([unauthenticatedCodex, readyClaude]),
      {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: DEFAULT_MODEL_BY_PROVIDER[CLAUDE]!,
      },
    );
  });

  it("returns undefined when no provider is ready", () => {
    assert.isUndefined(resolveZeropsBootstrapModelSelection([unauthenticatedCodex]));
  });

  it("opens the first conversation on Extra High where the model offers it (D10)", () => {
    const effortClaude = provider({
      driver: CLAUDE,
      models: [
        {
          slug: DEFAULT_MODEL_BY_PROVIDER[CLAUDE]!,
          name: "Opus 5.5",
          isCustom: false,
          capabilities: {
            optionDescriptors: [
              {
                id: "effort",
                label: "Effort",
                type: "select",
                options: [
                  { id: "medium", label: "Medium", isDefault: true },
                  { id: "xhigh", label: "Extra High" },
                  { id: "max", label: "Max" },
                ],
              },
            ],
          },
        },
      ],
    });
    assert.deepStrictEqual(resolveZeropsBootstrapModelSelection([effortClaude]), {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: DEFAULT_MODEL_BY_PROVIDER[CLAUDE]!,
      options: [{ id: "effort", value: "xhigh" }],
    });
  });
});

/**
 * How a provider looks while its very first probe is still running: the
 * managed snapshot is published synchronously with the CLI unexamined, and
 * the real result arrives seconds later on a forked fibre.
 */
const probingClaude = provider({
  driver: CLAUDE,
  installed: false,
  status: "warning",
  auth: { status: "unknown" },
  message: "Claude provider status has not been checked in this session yet.",
  models: [{ slug: "claude-sonnet-5", name: "Sonnet 5", isCustom: false, capabilities: null }],
});

const probingCodex = provider({
  driver: CODEX,
  installed: false,
  status: "warning",
  auth: { status: "unknown" },
  message: "Codex provider status has not been checked in this session yet.",
  models: [{ slug: DEFAULT_MODEL, name: "GPT", isCustom: false, capabilities: null }],
});

describe("isProbePendingProvider", () => {
  it("recognises an enabled provider whose first probe has not landed", () => {
    assert.isTrue(isProbePendingProvider(probingClaude));
    assert.isTrue(isProbePendingProvider(probingCodex));
  });

  it("does not treat a settled provider as pending", () => {
    assert.isFalse(isProbePendingProvider(readyClaude));
    assert.isFalse(isProbePendingProvider(unauthenticatedCodex));
  });

  it("does not wait on a disabled provider", () => {
    assert.isFalse(
      isProbePendingProvider(
        provider({ driver: CLAUDE, enabled: false, installed: false, status: "warning" }),
      ),
    );
  });
});

describe("isBootstrapDecidable", () => {
  it("is not decidable while any enabled provider is still probing", () => {
    assert.isFalse(isBootstrapDecidable([probingClaude, probingCodex]));
  });

  it("is not decidable on an empty registry — no snapshot is not evidence", () => {
    assert.isFalse(isBootstrapDecidable([]));
  });

  it("waits for a probing Claude even when Codex has already settled ready", () => {
    // The preference order is only meaningful against a complete picture; an
    // early exit here would hand the container Codex purely because its probe
    // returned first.
    assert.isFalse(isBootstrapDecidable([probingClaude, readyCodex]));
  });

  it("is decidable once every enabled provider has settled", () => {
    assert.isTrue(isBootstrapDecidable([unauthenticatedCodex, readyClaude]));
    assert.isTrue(isBootstrapDecidable([unauthenticatedCodex]));
  });
});

// Mate signs people in to Claude Code and Codex only: the stand-up's other way in is an agent it
// signs nobody in to, ready by its own probe.
describe("pickReadyAgentWithoutSignIn", () => {
  const OPENCODE = ProviderDriverKind.make("opencode");
  const cases: ReadonlyArray<[string, ReadonlyArray<ServerProvider>, string | undefined]> = [
    ["a ready Cursor", [provider({ driver: CURSOR })], "cursor"],
    ["never Claude Code or Codex, however ready", [readyClaude, readyCodex], undefined],
    [
      "the first ready one, after a Claude Code the feed answers for",
      [readyClaude, provider({ driver: CURSOR, status: "error" }), provider({ driver: OPENCODE })],
      "opencode",
    ],
    ["not a signed-out Cursor", [provider({ driver: CURSOR, status: "error" })], undefined],
    ["not a Cursor still probing", [provider({ driver: CURSOR, status: "warning" })], undefined],
    ["not a turned-off Cursor", [provider({ driver: CURSOR, enabled: false })], undefined],
    ["not a Cursor listing no models", [provider({ driver: CURSOR, models: [] })], undefined],
    ["nothing configured", [], undefined],
    // Grok and Cursor can say ready with a sign-in they could not read.
    [
      "not a ready Cursor whose sign-in is unknown",
      [provider({ driver: CURSOR, auth: { status: "unknown" } })],
      undefined,
    ],
  ];
  it.each(
    Array.from(cases, ([name, providers, expected]) => ({ title: name, providers, expected })),
  )("$title", ({ providers, expected }) =>
    assert.strictEqual(pickReadyAgentWithoutSignIn(providers)?.instanceId, expected),
  );

  // The conversation's own instance when it is one of the ready ones; the registry's order else.
  it.each([
    ["the conversation's, ready", "opencode", "opencode"],
    ["the registry's first, the conversation's not ready", "grok", "cursor"],
    ["the registry's first, the conversation on Claude Code", "claudeAgent", "cursor"],
    ["the registry's first, no conversation", undefined, "cursor"],
  ] as const)("picks %s", (_name, current, expected) => {
    const providers = [
      readyClaude,
      provider({ driver: CURSOR }),
      provider({ driver: ProviderDriverKind.make("grok"), status: "error" }),
      provider({ driver: OPENCODE }),
    ];
    assert.strictEqual(
      pickReadyAgentWithoutSignIn(
        providers,
        current === undefined ? undefined : ProviderInstanceId.make(current),
      )?.instanceId,
      ProviderInstanceId.make(expected),
    );
  });
});
