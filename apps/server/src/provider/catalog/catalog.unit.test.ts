import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerConfig from "../../config.ts";
import * as ServerSettings from "../../serverSettings.ts";
import {
  formatClaudeVersionUpgradeMessage,
  normalizeClaudeCatalogEffort,
  resolveClaudeCatalogApiModelId,
  resolveClaudeCatalogEffort,
  resolveClaudeModelCatalog,
  resolveClaudeModelsForVersion,
  resolveClaudeModelSlug,
  scopeClaudeModelCatalog,
} from "../ClaudeModelCatalog.ts";
import {
  applyManifestDefault,
  BUNDLED_MODEL_MANIFEST,
  classifyModels,
  encodeManifestCache,
  make,
  resolveProviderCatalog,
  type ModelManifestData,
} from "../ModelManifest.ts";
import {
  applyProviderCompatibility,
  ProviderCompatibilityPolicy,
  resolveProviderCompatibility,
} from "../providerCompatibility.ts";

const claudeManifest = (): ModelManifestData => ({
  version: 1,
  currentModels: {},
  providers: {
    claudeAgent: {
      profiles: {
        synthetic: {
          capabilities: {
            optionDescriptors: [
              {
                id: "effort",
                label: "Reasoning",
                type: "select",
                options: [{ id: "extreme", label: "Extreme", isDefault: true }],
              },
              {
                id: "contextWindow",
                label: "Context Window",
                type: "select",
                options: [{ id: "large", label: "Large", isDefault: true }],
              },
            ],
          },
          adapter: {
            claudeCode: {
              effortMap: { extreme: "high" },
              modelSuffixes: { contextWindow: { large: "[large]" } },
            },
          },
        },
      },
      models: [
        {
          slug: "claude-synthetic-next",
          name: "Claude Synthetic Next",
          aliases: ["synthetic"],
          status: "current",
          profile: "synthetic",
          adapter: { claudeCode: { minVersion: "3.2.0" } },
        },
      ],
    },
  },
});

const CODEX = ProviderDriverKind.make("codex");
const model = (overrides: Partial<ServerProviderModel>): ServerProviderModel => ({
  slug: "gpt-test",
  name: "GPT Test",
  isCustom: false,
  capabilities: null,
  ...overrides,
});

// Remote fixtures date after the bundle so a fetch still outranks it.
const REMOTE_MANIFEST: ModelManifestData = {
  version: 1,
  updatedAt: "2099-01-01T00:00:00Z",
  currentModels: {
    codex: ["remote-model"],
    claudeAgent: ["remote-agent-model"],
  },
};

const policy: ProviderCompatibilityPolicy = {
  driver: CODEX,
  // Mate versions, not T3 Code's: the range is read against apps/server/package.json.
  t3CodeRange: ">=0.11.0 <1.0.0",
  recommendedVersion: "2.0.0",
  recommendedRange: ">=2.0.0 <3.0.0",
  ranges: [
    { range: "<1.0.0", status: "broken" },
    { range: ">=1.0.0 <1.5.0", status: "unsupported" },
    { range: ">=1.5.0 <2.0.0", status: "graceful" },
    { range: ">=2.0.0 <3.0.0", status: "supported" },
  ],
};
const provider: ServerProvider = {
  driver: CODEX,
  instanceId: ProviderInstanceId.make("codex-work"),
  enabled: true,
  installed: true,
  version: "0.9.0",
  status: "error",
  message: "Authentication failed",
  checkedAt: "2026-09-22T00:00:00Z",
  auth: { status: "unauthenticated" },
  models: [],
  skills: [],
  slashCommands: [],
};

// witness: apps/server/src/provider/ClaudeModelCatalog.ts | if (compatibility.minVersion && compareSemverVersions(version, compatibility.minVersion) < 0) { → if (compatibility.minVersion && compareSemverVersions(version, compatibility.minVersion) <= 0) {
it("MC1: A Claude model whose minimum Claude Code version is above the installed one is not offered, and the upgrade hint names that model and its minimum version", () => {
  const catalog = resolveClaudeModelCatalog(claudeManifest());
  assert.deepStrictEqual(resolveClaudeModelsForVersion(catalog, "3.1.9"), []);
  assert.deepStrictEqual(
    resolveClaudeModelsForVersion(catalog, "3.2.0").map((entry) => entry.slug),
    ["claude-synthetic-next"],
  );
  const hint = formatClaudeVersionUpgradeMessage(catalog, "3.1.9");
  assert.include(hint, "Claude Synthetic Next");
  assert.include(hint, "v3.2.0");
});

// witness: apps/server/src/provider/ClaudeModelCatalog.ts | return effortMap[effort] ?? undefined; → return effort;
it("MC2: A Claude model picked by its alias reaches Claude Code under its slug, with the effort its profile maps the chosen effort to and the suffix its profile gives the chosen option", () => {
  const base = claudeManifest();
  const input: ModelManifestData = {
    ...base,
    providers: {
      ...base.providers,
      claudeAgent: {
        ...base.providers!.claudeAgent!,
        models: [
          {
            slug: "claude-synthetic-collision",
            name: "Claude Synthetic Collision",
            aliases: ["claude-synthetic-next"],
            status: "current",
          },
          ...base.providers!.claudeAgent!.models,
        ],
      },
    },
  };
  const catalog = resolveClaudeModelCatalog(input);
  assert.strictEqual(resolveClaudeModelSlug(catalog, "synthetic"), "claude-synthetic-next");
  assert.strictEqual(
    resolveClaudeModelSlug(catalog, "claude-synthetic-next"),
    "claude-synthetic-next",
  );
  assert.strictEqual(normalizeClaudeCatalogEffort(catalog, "extreme", "synthetic"), "high");
  assert.strictEqual(
    resolveClaudeCatalogApiModelId(catalog, {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "synthetic",
    }),
    "claude-synthetic-next[large]",
  );
});

// witness: apps/server/src/provider/ClaudeModelCatalog.ts | aliases: entry.model.aliases.filter((alias) => !customAliases.has(alias.toLowerCase())), → aliases: entry.model.aliases,
it("MC3: A custom model named like a built-in alias takes that alias over, and a custom model with its own options resolves effort against them and passes the value to Claude Code unchanged", () => {
  const catalog = scopeClaudeModelCatalog(resolveClaudeModelCatalog(claudeManifest()), [
    "synthetic",
    {
      slug: "claude-custom-tuned",
      name: "Tuned",
      capabilities: {
        optionDescriptors: [
          {
            id: "effort",
            label: "Reasoning",
            type: "select",
            options: [
              { id: "gentle", label: "Gentle", isDefault: true },
              { id: "brutal", label: "Brutal" },
            ],
          },
        ],
      },
    },
  ]);
  assert.strictEqual(resolveClaudeModelSlug(catalog, "synthetic"), "synthetic");
  assert.strictEqual(resolveClaudeCatalogEffort(catalog, "synthetic", "extreme"), undefined);
  assert.strictEqual(
    resolveClaudeCatalogEffort(catalog, "claude-custom-tuned", "brutal"),
    "brutal",
  );
  assert.strictEqual(resolveClaudeCatalogEffort(catalog, "claude-custom-tuned", "bogus"), "gentle");
  assert.strictEqual(
    normalizeClaudeCatalogEffort(catalog, "brutal", "claude-custom-tuned"),
    "brutal",
  );
  assert.strictEqual(
    resolveClaudeCatalogApiModelId(catalog, {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-custom-tuned",
      options: [{ id: "effort", value: "brutal" }],
    }),
    "claude-custom-tuned",
  );
  assert.deepStrictEqual(
    resolveClaudeModelsForVersion(catalog, "3.2.0").map((entry) => entry.slug),
    ["claude-synthetic-next", "claude-custom-tuned"],
  );
});

// witness: apps/server/src/provider/ModelManifest.ts | const family = driverKind === "codex" ? codexModelFamily(slug) : slug; → const family = slug;
it("MC4: A built-in model the manifest does not list as current is marked legacy, a listed one loses a stale legacy mark, a custom model is never marked, and a qualified Codex id is judged by its family without changing the id", () => {
  const qualified: ModelManifestData = { version: 1, currentModels: { codex: ["gpt-test"] } };
  assert.deepStrictEqual(
    classifyModels(
      [model({ slug: "openai.gpt-test", isLegacy: true }), model({ slug: "openai.gpt-old" })],
      qualified,
      CODEX,
    ).map((entry) => [entry.slug, entry.isLegacy ?? false]),
    [
      ["openai.gpt-test", false],
      ["openai.gpt-old", true],
    ],
  );
  const manifest: ModelManifestData = {
    version: 1,
    currentModels: { codex: ["current-a", "current-b"] },
  };
  const models = [
    model({ slug: "current-a" }),
    model({ slug: "current-b", isLegacy: true }),
    model({ slug: "old-model" }),
    model({ slug: "my-own-model", isCustom: true }),
  ];
  assert.deepStrictEqual(
    classifyModels(models, manifest, CODEX).map((entry) => [entry.slug, entry.isLegacy ?? false]),
    [
      ["current-a", false],
      ["current-b", false],
      ["old-model", true],
      ["my-own-model", false],
    ],
  );
});

// witness: apps/server/src/provider/ModelManifest.ts | const aliases = [...new Set([...(model.aliases ?? []), ...movedAliases])]; → const aliases = [...(model.aliases ?? [])];
it("MC5: The manifest's chat default takes the default mark and the previous default's aliases, on the qualified Codex model of its family too, while an account that does not offer it keeps its own default", () => {
  const codexManifest: ModelManifestData = {
    version: 1,
    currentModels: {},
    providers: { codex: { models: [], profiles: {}, defaults: { chat: "gpt-test" } } },
  };
  assert.strictEqual(
    applyManifestDefault(
      [model({ slug: "openai.gpt-old", isDefault: true }), model({ slug: "openai.gpt-test" })],
      codexManifest,
      CODEX,
    ).find((entry) => entry.isDefault)?.slug,
    "openai.gpt-test",
  );
  const driver = ProviderDriverKind.make("antigravity");
  const manifest: ModelManifestData = {
    version: 1,
    currentModels: {},
    providers: {
      antigravity: {
        defaults: { chat: "gemini-new" },
        profiles: {},
        models: [{ slug: "gemini-new", name: "New", status: "current" }],
      },
    },
  };
  const models = [
    model({ slug: "gemini-old", isDefault: true, aliases: ["antigravity-default"] }),
    model({ slug: "gemini-new" }),
  ];
  assert.deepStrictEqual(applyManifestDefault(models, manifest, driver), [
    model({ slug: "gemini-old" }),
    model({ slug: "gemini-new", isDefault: true, aliases: ["antigravity-default"] }),
  ]);
  assert.deepStrictEqual(
    applyManifestDefault(models.slice(0, 1), manifest, driver),
    models.slice(0, 1),
  );
});

// witness: apps/server/src/provider/ModelManifest.ts | if (catalog.defaults?.chat !== undefined && !seen.has(catalog.defaults.chat)) return null; → if (catalog.defaults?.chat !== undefined && seen.has(catalog.defaults.chat)) return null;
it("MC6: A provider catalog with a repeated slug, a model naming a missing profile, or a chat default naming no model resolves to nothing, and a valid one gives each model its profile's capabilities and the default mark", () => {
  const synthetic = ProviderDriverKind.make("synthetic");
  const manifest: ModelManifestData = {
    version: 1,
    currentModels: {},
    providers: {
      synthetic: {
        defaults: { chat: "model-next" },
        profiles: {
          standard: {
            capabilities: {
              optionDescriptors: [
                {
                  id: "mode",
                  label: "Mode",
                  type: "select",
                  options: [{ id: "fast", label: "Fast", isDefault: true }],
                },
              ],
            },
            adapter: { opaque: true },
          },
        },
        models: [
          {
            slug: "model-next",
            name: "Model Next",
            aliases: ["next"],
            status: "current",
            badge: "new",
            profile: "standard",
          },
        ],
      },
    },
  };
  assert.deepStrictEqual(resolveProviderCatalog(manifest, synthetic)?.models[0], {
    model: {
      slug: "model-next",
      name: "Model Next",
      aliases: ["next"],
      badge: "new",
      isCustom: false,
      isDefault: true,
      capabilities: manifest.providers!.synthetic!.profiles.standard!.capabilities!,
    },
    adapter: undefined,
    profileAdapter: { opaque: true },
  });

  const invalidCatalog = (input: {
    readonly models: NonNullable<ModelManifestData["providers"]>[string]["models"];
    readonly defaultChat?: string;
  }): ModelManifestData => ({
    version: 1,
    currentModels: {},
    providers: {
      synthetic: {
        ...(input.defaultChat ? { defaults: { chat: input.defaultChat } } : {}),
        profiles: {},
        models: input.models,
      },
    },
  });
  for (const invalid of [
    invalidCatalog({
      models: [
        { slug: "duplicate", name: "First", status: "current" },
        { slug: "duplicate", name: "Second", status: "current" },
      ],
    }),
    invalidCatalog({
      models: [
        { slug: "missing-profile", name: "Missing Profile", status: "current", profile: "missing" },
      ],
    }),
    invalidCatalog({
      models: [{ slug: "present", name: "Present", status: "current" }],
      defaultChat: "absent",
    }),
  ]) {
    assert.isNull(resolveProviderCatalog(invalid, synthetic));
  }
});

// witness: apps/server/src/provider/ModelManifest.ts | if (!force && isWithin(fetchedAtMs, MANIFEST_TTL_MS)) return manifest; → if (isWithin(fetchedAtMs, MANIFEST_TTL_MS)) return manifest;
it.effect(
  "MC7: The model manifest is fetched at most once while fresh and survives a restart from its disk copy, while an explicit refresh fetches at once and a failed one keeps the last good manifest",
  () => {
    const services = (prefix: string, response: () => Response) =>
      ServerConfig.layerTest(process.cwd(), { prefix }).pipe(
        Layer.provideMerge(NodeServices.layer),
        Layer.provideMerge(ServerSettings.layerTest({})),
        Layer.provideMerge(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.succeed(HttpClientResponse.fromWeb(request, response())),
            ),
          ),
        ),
      );
    const updated: ModelManifestData = {
      ...REMOTE_MANIFEST,
      currentModels: { codex: ["gpt-reloaded"] },
    };
    let forceCount = 0;
    let retryCount = 0;
    let initialCount = 0;
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const service = yield* make;
        assert.deepStrictEqual(yield* service.refresh, REMOTE_MANIFEST);
        assert.deepStrictEqual(yield* service.refresh, REMOTE_MANIFEST);
        assert.strictEqual(forceCount, 1);
        const rebooted = yield* make;
        assert.deepStrictEqual(yield* rebooted.refresh, REMOTE_MANIFEST);
        assert.strictEqual(forceCount, 1);
        assert.deepStrictEqual(yield* rebooted.forceRefresh, updated);
        assert.strictEqual(forceCount, 2);
        assert.deepStrictEqual(yield* rebooted.current, updated);
        assert.deepStrictEqual(yield* (yield* make).current, updated);
      }).pipe(
        Effect.scoped,
        Effect.provide(
          services("model-manifest-force-refresh-test", () =>
            Response.json(forceCount++ === 0 ? REMOTE_MANIFEST : updated),
          ),
        ),
      );

      yield* Effect.gen(function* () {
        const service = yield* make;
        assert.deepStrictEqual(yield* service.refresh, REMOTE_MANIFEST);
        assert.deepStrictEqual(yield* service.forceRefresh, REMOTE_MANIFEST);
        assert.deepStrictEqual(yield* service.current, REMOTE_MANIFEST);
        assert.deepStrictEqual(yield* (yield* make).current, REMOTE_MANIFEST);
        assert.strictEqual(retryCount, 2);
        assert.deepStrictEqual(yield* service.forceRefresh, REMOTE_MANIFEST);
        assert.strictEqual(retryCount, 3);
      }).pipe(
        Effect.scoped,
        Effect.provide(
          services("model-manifest-force-retry-test", () =>
            retryCount++ === 1
              ? new Response(null, { status: 503 })
              : Response.json(REMOTE_MANIFEST),
          ),
        ),
      );

      yield* Effect.gen(function* () {
        const service = yield* make;
        assert.deepStrictEqual(yield* service.refresh, BUNDLED_MODEL_MANIFEST);
        assert.deepStrictEqual(yield* service.refresh, BUNDLED_MODEL_MANIFEST);
        assert.strictEqual(initialCount, 1);
        assert.deepStrictEqual(yield* service.forceRefresh, REMOTE_MANIFEST);
        assert.strictEqual(initialCount, 2);
      }).pipe(
        Effect.scoped,
        Effect.provide(
          services("model-manifest-force-initial-retry-test", () =>
            initialCount++ === 0
              ? new Response(null, { status: 503 })
              : Response.json(REMOTE_MANIFEST),
          ),
        ),
      );

      yield* Effect.gen(function* () {
        const service = yield* make;
        assert.deepStrictEqual(yield* service.refresh, REMOTE_MANIFEST);
        const rebooted = yield* make;
        assert.deepStrictEqual(yield* rebooted.current, REMOTE_MANIFEST);
      }).pipe(
        Effect.scoped,
        Effect.provide(services("model-manifest-fetch-test", () => Response.json(REMOTE_MANIFEST))),
      );
    });
  },
);

// witness: apps/server/src/provider/ModelManifest.ts | if (slugs.has(model.slug)) return false; → if (slugs.has(model.name)) return false;
it.effect(
  "MC8: A fetched manifest that fails validation never replaces the bundled or the last good manifest, in memory or on disk, and neither does a compatibility policy that fails validation",
  () => {
    const services = (prefix: string, response: () => Response) =>
      ServerConfig.layerTest(process.cwd(), { prefix }).pipe(
        Layer.provideMerge(NodeServices.layer),
        Layer.provideMerge(ServerSettings.layerTest({})),
        Layer.provideMerge(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.succeed(HttpClientResponse.fromWeb(request, response())),
            ),
          ),
        ),
      );
    const remoteClaude: ModelManifestData = {
      version: 1,
      updatedAt: "2099-01-01T00:00:00Z",
      currentModels: {},
      providers: {
        claudeAgent: {
          profiles: {
            synthetic: {
              adapter: { claudeCode: { effortMap: { extreme: "high" } } },
            },
          },
          models: [
            {
              slug: "remote-only-model",
              name: "Remote Only Model",
              status: "current",
              profile: "synthetic",
            },
          ],
        },
      },
    };
    const withCompatibility = (compatibility: unknown): ModelManifestData => ({
      ...remoteClaude,
      providers: {
        claudeAgent: {
          profiles: remoteClaude.providers!.claudeAgent!.profiles,
          models: remoteClaude.providers!.claudeAgent!.models.map((entry) => ({
            ...entry,
            adapter: { claudeCode: compatibility },
          })),
        },
      },
    });
    const invalidManifests: ReadonlyArray<ModelManifestData> = [
      {
        ...remoteClaude,
        providers: {
          claudeAgent: {
            profiles: {
              synthetic: {
                adapter: { claudeCode: { effortMap: { extreme: 123 } } },
              },
            },
            models: remoteClaude.providers!.claudeAgent!.models,
          },
        },
      },
      {
        ...remoteClaude,
        providers: {
          claudeAgent: {
            profiles: {},
            models: remoteClaude.providers!.claudeAgent!.models,
          },
        },
      },
      {
        ...remoteClaude,
        providers: {
          claudeAgent: {
            profiles: remoteClaude.providers!.claudeAgent!.profiles,
            models: [
              ...remoteClaude.providers!.claudeAgent!.models,
              {
                slug: "remote-only-model",
                name: "Duplicate Remote Model",
                status: "current",
                profile: "synthetic",
              },
            ],
          },
        },
      },
      {
        ...remoteClaude,
        providers: {
          claudeAgent: {
            defaults: { chat: "absent-model" },
            profiles: remoteClaude.providers!.claudeAgent!.profiles,
            models: remoteClaude.providers!.claudeAgent!.models,
          },
        },
      },
      withCompatibility({ minVersion: "2.x" }),
      withCompatibility({ maxVersionExclusive: "2.x" }),
      withCompatibility({ minVersion: "2.2", maxVersionExclusive: "2.1" }),
    ];
    const responses = [remoteClaude, ...invalidManifests];
    let responseIndex = 0;
    const remoteWithPolicy: ModelManifestData = {
      ...REMOTE_MANIFEST,
      compatibility: [
        {
          driver: "codex",
          t3CodeRange: ">=0.0.42",
          recommendedVersion: "2.0.0",
          ranges: [{ range: "=2.0.0", status: "supported" }],
        },
      ],
    };
    let invalidPolicy = false;
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const service = yield* make;
        assert.deepStrictEqual(yield* service.refresh, BUNDLED_MODEL_MANIFEST);
      }).pipe(
        Effect.scoped,
        Effect.provide(
          services("model-manifest-malformed-test", () =>
            Response.json({ version: 999, nonsense: true }),
          ),
        ),
      );

      yield* Effect.gen(function* () {
        const service = yield* make;
        assert.deepStrictEqual(yield* service.refresh, remoteClaude);
        for (const _invalid of invalidManifests) {
          yield* TestClock.adjust("1 hour");
          responseIndex += 1;
          assert.deepStrictEqual(yield* service.refresh, remoteClaude);
        }
        const rebooted = yield* make;
        assert.deepStrictEqual(yield* rebooted.current, remoteClaude);
      }).pipe(
        Effect.scoped,
        Effect.provide(
          services("model-manifest-last-good-test", () => Response.json(responses[responseIndex])),
        ),
      );

      yield* Effect.gen(function* () {
        const service = yield* make;
        assert.deepStrictEqual(
          (yield* service.refresh).compatibility,
          remoteWithPolicy.compatibility,
        );
        invalidPolicy = true;
        yield* TestClock.adjust("1 hour");
        assert.deepStrictEqual(
          (yield* service.refresh).compatibility,
          remoteWithPolicy.compatibility,
        );
        const rebooted = yield* make;
        assert.deepStrictEqual(
          (yield* rebooted.current).compatibility,
          remoteWithPolicy.compatibility,
        );
      }).pipe(
        Effect.scoped,
        Effect.provide(
          services("model-manifest-compatibility-test", () =>
            Response.json(
              invalidPolicy
                ? {
                    ...remoteWithPolicy,
                    compatibility: [
                      { ...remoteWithPolicy.compatibility![0], recommendedVersion: "3.0.0" },
                    ],
                  }
                : remoteWithPolicy,
            ),
          ),
        ),
      );
    });
  },
);

// witness: apps/server/src/provider/ModelManifest.ts | if (manifestUpdatedAtMs(BUNDLED_MODEL_MANIFEST) > manifestUpdatedAtMs(fromDisk.manifest)) { → if (manifestUpdatedAtMs(BUNDLED_MODEL_MANIFEST) < manifestUpdatedAtMs(fromDisk.manifest)) {
it.effect(
  "MC9: A disk copy of a manifest edited before the bundled one, or undated, gives way to the bundled manifest, while a newer disk copy outranks it",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const config = yield* ServerConfig.ServerConfig;
      const cachePath = path.join(config.stateDir, "model-manifest.json");
      const { updatedAt: _undated, ...undatedManifest } = REMOTE_MANIFEST;
      for (const stale of [
        undatedManifest,
        { ...REMOTE_MANIFEST, updatedAt: "2000-01-01T00:00:00Z" },
      ]) {
        yield* fs.writeFileString(
          cachePath,
          yield* encodeManifestCache({ fetchedAtMs: 0, manifest: stale }),
        );
        const service = yield* make;
        assert.deepStrictEqual(yield* service.current, BUNDLED_MODEL_MANIFEST);
      }
      yield* fs.writeFileString(
        cachePath,
        yield* encodeManifestCache({ fetchedAtMs: 0, manifest: REMOTE_MANIFEST }),
      );
      const later = yield* make;
      assert.deepStrictEqual(yield* later.current, REMOTE_MANIFEST);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "model-manifest-newer-bundle-test" }).pipe(
          Layer.provideMerge(NodeServices.layer),
          Layer.provideMerge(ServerSettings.layerTest({})),
          Layer.provideMerge(
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make((request) =>
                Effect.succeed(HttpClientResponse.fromWeb(request, Response.json(REMOTE_MANIFEST))),
              ),
            ),
          ),
        ),
      ),
    ),
);

// witness: apps/server/src/provider/ModelManifest.ts | if (settings !== null && !settings.enableProviderUpdateChecks) return manifest; → if (settings === null) return manifest;
it.effect(
  "MC10: With provider update checks off, neither a refresh nor an explicit refresh fetches the manifest",
  () => {
    let fetchCount = 0;
    return Effect.gen(function* () {
      const service = yield* make;
      assert.deepStrictEqual(yield* service.refresh, BUNDLED_MODEL_MANIFEST);
      assert.deepStrictEqual(yield* service.forceRefresh, BUNDLED_MODEL_MANIFEST);
      assert.strictEqual(fetchCount, 0);
    }).pipe(
      Effect.scoped,
      Effect.provide(
        ServerConfig.layerTest(process.cwd(), { prefix: "model-manifest-optout-test" }).pipe(
          Layer.provideMerge(NodeServices.layer),
          Layer.provideMerge(ServerSettings.layerTest({ enableProviderUpdateChecks: false })),
          Layer.provideMerge(
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make((request) => {
                fetchCount += 1;
                return Effect.succeed(
                  HttpClientResponse.fromWeb(request, Response.json(REMOTE_MANIFEST)),
                );
              }),
            ),
          ),
        ),
      ),
    );
  },
);

// witness: apps/server/src/provider/providerCompatibility.ts | const unprefixed = version?.replace(/^v/, ""); → const unprefixed = version;
it("MC11: A provider CLI version, with or without a leading v, takes the status of the first range that holds it in the policy for its driver and this Mate release, a prerelease, an unlisted version, an unknown tag or no version is unknown, and no policy applies outside its Mate range", () => {
  for (const [version, expected] of [
    ["0.9.9", "broken"],
    ["1.0.0", "unsupported"],
    ["1.5.0", "graceful"],
    ["2.0.0", "supported"],
    ["v2.0.0", "supported"],
    ["3.0.0", "unknown"],
    ["2.0.0-beta.1", "unknown"],
    ["agy_acp_server_20260818_01_RC01", "unknown"],
    [null, "unknown"],
  ] as const) {
    assert.strictEqual(resolveProviderCompatibility([policy], CODEX, version)?.status, expected);
  }
  assert.isUndefined(resolveProviderCompatibility([policy], CODEX, "0.9.0", "1.0.0"));
  for (const kind of [
    "codex",
    "claudeAgent",
    "cursor",
    "grok",
    "opencode",
    "antigravity",
    "customDriver",
  ]) {
    const adapter = ProviderDriverKind.make(kind);
    assert.strictEqual(
      resolveProviderCompatibility([{ ...policy, driver: adapter }], adapter, "2.0.0")?.status,
      "supported",
    );
    assert.isUndefined(resolveProviderCompatibility([], adapter, "2.0.0"));
  }
});

// witness: apps/server/src/provider/providerCompatibility.ts | if (!snapshot.enabled || !snapshot.installed) return base; → if (!snapshot.enabled) return base;
it("MC12: A remote compatibility policy replaces its bundled one without touching the provider's own status and message, an omitted one leaves the bundled in force, the latest version gets its own verdict beside the update advice, and a disabled or uninstalled provider carries no compatibility verdict", () => {
  const broken = applyProviderCompatibility(provider, [], [policy]);
  assert.strictEqual(broken.compatibilityAdvisory?.status, "broken");
  const relaxed = { ...policy, ranges: [{ range: ">=0.0.0", status: "supported" as const }] };
  const supported = applyProviderCompatibility(broken, [relaxed], [policy]);
  assert.strictEqual(supported.compatibilityAdvisory?.status, "supported");
  assert.strictEqual(supported.status, "error");
  assert.strictEqual(supported.message, "Authentication failed");
  assert.strictEqual(
    applyProviderCompatibility(supported, [{ ...policy, t3CodeRange: ">=9.0.0" }], [policy])
      .compatibilityAdvisory?.status,
    "broken",
  );
  const removed = applyProviderCompatibility(supported, [], []);
  assert.isUndefined(removed.compatibilityAdvisory);
  assert.strictEqual(removed.status, "error");
  assert.strictEqual(removed.message, "Authentication failed");
  assert.isUndefined(
    applyProviderCompatibility({ ...broken, enabled: false }, [], [policy]).compatibilityAdvisory,
  );
  assert.isUndefined(
    applyProviderCompatibility({ ...broken, installed: false }, [], [policy]).compatibilityAdvisory,
  );

  const snapshot: ServerProvider = {
    ...provider,
    version: "2.0.0",
    versionAdvisory: {
      status: "behind_latest",
      currentVersion: "2.0.0",
      latestVersion: "4.0.0",
      canUpdate: true,
      updateCommand: "npm install -g fixture@latest",
      checkedAt: provider.checkedAt,
      message: null,
    },
  };
  const blockedPolicy: ProviderCompatibilityPolicy = {
    ...policy,
    ranges: [...policy.ranges, { range: ">=3.0.0", status: "broken" }],
  };
  const blocked = applyProviderCompatibility(snapshot, [blockedPolicy], []);
  assert.strictEqual(blocked.compatibilityAdvisory?.latestVersionStatus, "broken");
  const latestRelaxed = applyProviderCompatibility(
    blocked,
    [{ ...policy, ranges: [{ range: ">=2.0.0", status: "supported" }] }],
    [],
  );
  assert.strictEqual(latestRelaxed.compatibilityAdvisory?.latestVersionStatus, "supported");
  assert.deepStrictEqual(latestRelaxed.versionAdvisory, snapshot.versionAdvisory);
});

// witness: apps/server/src/provider/providerCompatibility.ts | policy.ranges.find((entry) => satisfiesSemverRange(version, entry.range))?.status === → policy.ranges.findLast((entry) => satisfiesSemverRange(version, entry.range))?.status ===
it("MC13: A compatibility policy is refused when a range is not a version comparison, its Mate range is open, or its recommended version is not a plain version whose first matching range is supported", () => {
  const decode = Schema.decodeUnknownSync(ProviderCompatibilityPolicy);
  assert.doesNotThrow(() => decode(policy));
  const prefixed = decode({
    ...policy,
    t3CodeRange: ">=v0.11 <v1",
    recommendedRange: "^v2",
    ranges: [{ range: ">=v2.0 <v3", status: "supported" }],
  });
  assert.strictEqual(resolveProviderCompatibility([prefixed], CODEX, "2.0.0")?.status, "supported");
  assert.strictEqual(resolveProviderCompatibility([prefixed], CODEX, "3.0.0")?.status, "unknown");
  for (const invalid of [
    { ...policy, t3CodeRange: "*" },
    { ...policy, recommendedVersion: "3.0.0" },
    { ...policy, ranges: [{ range: ">=2.0.0 garbage", status: "supported" }] },
    { ...policy, recommendedVersion: "2.0.0; echo unsafe" },
    { ...policy, ranges: [{ range: ">=0.0.0", status: "broken" }, ...policy.ranges] },
  ]) {
    assert.throws(() => decode(invalid));
  }
});
