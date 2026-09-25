import {
  USAGE_CONTRACT_VERSION,
  USAGE_MERGE_COMPATIBLE_SINCE,
  type EnvironmentId,
  type UsageBucket,
  type UsageDay,
  type UsageProviderKind,
  type UsageSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { isModelCostUnknown, mergeUsage, type EnvironmentUsage } from "./usageMerge.ts";

function bucket(overrides: Partial<UsageBucket> = {}): UsageBucket {
  return {
    day: "2026-08-07" as UsageDay,
    provider: "claude",
    model: "claude-fable-5",
    totals: {
      uncachedInputTokens: 100,
      cachedInputTokens: 1000,
      cacheCreationTokens: 10,
      outputTokens: 50,
      reasoningTokens: 0,
    },
    costUsd: 10,
    cacheSavingsUsd: 2,
    costSource: "modelPriced",
    records: 5,
    unpricedRecords: 0,
    sessions: 1,
    ...overrides,
  };
}

function summary(
  buckets: readonly UsageBucket[],
  sources: readonly {
    provider: UsageProviderKind;
    hostId: string;
    homePath: string;
    volumeId?: string;
    distinctSessions?: number;
  }[],
  contractVersion: number = USAGE_CONTRACT_VERSION,
): UsageSummary {
  return {
    contractVersion,
    readAt: "2026-08-07T00:00:00.000Z",
    timeZone: "UTC",
    sinceDay: "2026-08-01" as UsageDay,
    untilDay: "2026-08-31" as UsageDay,
    buckets,
    sources: sources.map((source) => ({
      fingerprint: {
        hostId: source.hostId,
        provider: source.provider,
        resolvedHomePath: source.homePath,
        volumeId: source.volumeId ?? `vol-${source.hostId}`,
      },
      status: "ok" as const,
      scannedFiles: 1,
      skippedFiles: 0,
      malformedRecords: 0,
      distinctSessions: source.distinctSessions ?? 1,
      message: null,
    })),
    pricing: { status: "fresh", source: "litellm", fetchedAt: null, knownModels: 10 },
    scanDurationMs: 1,
  };
}

function environment(id: string, usageSummary: UsageSummary): EnvironmentUsage {
  return { environmentId: id as EnvironmentId, label: id, summary: usageSummary };
}

describe("mergeUsage", () => {
  it("counts a Cursor account once across servers while retaining each server's other providers", () => {
    const account = {
      provider: "cursor" as const,
      hostId: "cursor.com",
      homePath: "cursor-account:account-hash",
      volumeId: "account-hash",
    };
    const merged = mergeUsage(
      [
        environment(
          "mac",
          summary([bucket({ provider: "cursor", sourcePath: account.homePath })], [account]),
        ),
        environment(
          "linux",
          summary(
            [
              bucket({ provider: "cursor", sourcePath: account.homePath }),
              bucket({ provider: "opencode", sourcePath: "/opencode" }),
            ],
            [account, { provider: "opencode", hostId: "linux", homePath: "/opencode" }],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );
    expect(
      merged.providers.map((provider) => [provider.provider, provider.costUsd]).sort(),
    ).toEqual([
      ["cursor", 10],
      ["opencode", 10],
    ]);
    expect(merged.duplicateSources).toHaveLength(1);
  });

  it("sums environments that read different transcript directories", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary([bucket()], [{ provider: "claude", hostId: "mac", homePath: "/a/.claude" }]),
        ),
        environment(
          "env-b",
          summary([bucket()], [{ provider: "claude", hostId: "linux", homePath: "/b/.claude" }]),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(20);
    expect(merged.records).toBe(10);
    expect(merged.duplicateSources).toHaveLength(0);
  });

  it("counts a shared transcript directory once", () => {
    // Two worktree servers on one machine resolve the same provider home.
    const shared = { provider: "claude" as const, hostId: "mac", homePath: "/home/theo/.claude" };
    const merged = mergeUsage(
      [
        environment("env-a", summary([bucket()], [shared])),
        environment("env-b", summary([bucket()], [shared])),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(10);
    expect(merged.records).toBe(5);
    expect(merged.sessions).toBe(1);
    expect(merged.duplicateSources).toHaveLength(1);
    expect(merged.contributingEnvironments).toEqual(["env-a"]);
  });

  it("drops only the duplicated provider, keeping the environment's other one", () => {
    const sharedClaude = {
      provider: "claude" as const,
      hostId: "mac",
      homePath: "/home/theo/.claude",
    };
    const merged = mergeUsage(
      [
        environment("env-a", summary([bucket()], [sharedClaude])),
        environment(
          "env-b",
          summary(
            [bucket(), bucket({ provider: "codex", model: "gpt-5.6-sol", costUsd: 4 })],
            [sharedClaude, { provider: "codex", hostId: "mac", homePath: "/home/theo/.codex" }],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    // env-b's claude bucket is dropped, its codex bucket survives.
    expect(merged.costUsd).toBe(14);
    expect(merged.providers.map((provider) => provider.provider).sort()).toEqual([
      "claude",
      "codex",
    ]);
    expect(merged.sessions).toBe(2);
    expect(
      Object.fromEntries(
        merged.providers.map((provider) => [provider.provider, provider.sessions]),
      ),
    ).toEqual({ claude: 1, codex: 1 });
  });

  it("counts overlapping provider roots once while keeping each environment's unique root", () => {
    const source = (homePath: string) => ({
      provider: "opencode" as const,
      hostId: "host",
      homePath,
    });
    const usage = (sourcePath: string, costUsd: number) =>
      bucket({ provider: "opencode", sourcePath, costUsd });
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary([usage("/shared", 10), usage("/a", 2)], [source("/shared"), source("/a")]),
        ),
        environment(
          "env-b",
          summary([usage("/shared", 10), usage("/b", 3)], [source("/shared"), source("/b")]),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );
    expect(merged.costUsd).toBe(15);
    expect(merged.sessions).toBe(3);
  });

  it("uses the newest scan when environments share the same transcript directory", () => {
    const source = { provider: "claude" as const, hostId: "mac", homePath: "/home/theo/.claude" };
    const environments = [
      environment("env-a", summary([bucket({ costUsd: 4, records: 2 })], [source])),
      environment("env-b", {
        ...summary([bucket()], [source]),
        readAt: "2026-08-07T01:00:00.000Z",
      }),
    ];

    for (const ordered of [environments, environments.toReversed()]) {
      const merged = mergeUsage(ordered, USAGE_CONTRACT_VERSION);
      expect(merged.costUsd).toBe(10);
      expect(merged.records).toBe(5);
      expect(merged.sessions).toBe(1);
      expect(merged.contributingEnvironments).toEqual(["env-b"]);
      expect(merged.duplicateSources).toEqual(["env-a: /home/theo/.claude"]);
    }
  });

  it("prefers a complete scan over a newer partial scan of the same directory", () => {
    const source = { provider: "claude" as const, hostId: "mac", homePath: "/home/theo/.claude" };
    const incomplete = summary([bucket({ costUsd: 4, records: 2 })], [source]);
    const partial = environment("new", {
      ...incomplete,
      readAt: "2026-08-07T01:00:00.000Z",
      sources: incomplete.sources.map((entry) => ({ ...entry, status: "partial" as const })),
    });
    const complete = environment("old", summary([bucket()], [source]));

    for (const ordered of [
      [partial, complete],
      [complete, partial],
    ]) {
      const merged = mergeUsage(ordered, USAGE_CONTRACT_VERSION);
      expect(merged.costUsd).toBe(10);
      expect(merged.contributingEnvironments).toEqual(["old"]);
      expect(merged.duplicateSources).toEqual(["new: /home/theo/.claude"]);
    }
    expect(mergeUsage([partial], USAGE_CONTRACT_VERSION).costUsd).toBe(4);
  });

  it("keeps new cells from a later partial scan without recounting older cells", () => {
    const source = { provider: "claude" as const, hostId: "mac", homePath: "/home/theo/.claude" };
    const complete = environment(
      "old",
      summary([bucket()], [source], USAGE_MERGE_COMPATIBLE_SINCE),
    );
    const partialSummary = summary(
      [
        bucket({ sourcePath: source.homePath, costUsd: 4, records: 2 }),
        bucket({
          day: "2026-08-08" as UsageDay,
          sourcePath: source.homePath,
          costUsd: 3,
          records: 1,
        }),
      ],
      [{ ...source, distinctSessions: 2 }],
    );
    const partial = environment("new", {
      ...partialSummary,
      readAt: "2026-08-08T01:00:00.000Z",
      sources: partialSummary.sources.map((entry) => ({ ...entry, status: "partial" as const })),
    });

    for (const ordered of [
      [complete, partial],
      [partial, complete],
    ]) {
      const merged = mergeUsage(ordered, USAGE_CONTRACT_VERSION);
      expect(merged.costUsd).toBe(13);
      expect(merged.records).toBe(6);
      expect(merged.sessions).toBe(2);
      expect(merged.daily.map(({ day, costUsd }) => [day, costUsd])).toEqual([
        ["2026-08-07", 10],
        ["2026-08-08", 3],
      ]);
      expect(merged.contributingEnvironments).toEqual(
        ordered.map(({ environmentId }) => environmentId),
      );
      expect(merged.duplicateSources).toEqual(["new: /home/theo/.claude"]);
    }
  });

  it("retains a complete cell when a larger partial cell may have skipped old records", () => {
    const source = { provider: "claude" as const, hostId: "mac", homePath: "/home/theo/.claude" };
    const complete = environment("old", summary([bucket()], [source]));
    const partialSummary = summary(
      [
        bucket({
          costUsd: 4,
          records: 6,
          totals: {
            uncachedInputTokens: 80,
            cachedInputTokens: 500,
            cacheCreationTokens: 10,
            outputTokens: 30,
            reasoningTokens: 0,
          },
        }),
      ],
      [{ ...source, distinctSessions: 2 }],
    );
    const partial = environment("new", {
      ...partialSummary,
      readAt: "2026-08-07T01:00:00.000Z",
      sources: partialSummary.sources.map((entry) => ({ ...entry, status: "partial" as const })),
    });

    const merged = mergeUsage([complete, partial], USAGE_CONTRACT_VERSION);
    expect(merged.costUsd).toBe(10);
    expect(merged.totalTokens).toBe(1160);
    expect(merged.records).toBe(5);
    expect(merged.sessions).toBe(1);
    expect(merged.contributingEnvironments).toEqual(["old"]);
  });

  it("excludes an environment reporting an older contract version", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary([bucket()], [{ provider: "claude", hostId: "mac", homePath: "/a" }]),
        ),
        environment(
          "env-b",
          summary(
            [bucket()],
            [{ provider: "claude", hostId: "linux", homePath: "/b" }],
            USAGE_MERGE_COMPATIBLE_SINCE - 1,
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(10);
    expect(merged.staleEnvironments).toEqual(["env-b"]);
  });

  it("keeps the previous compatible contract version so additive provider expansions still merge", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [bucket({ costUsd: 10 })],
            [{ provider: "claude", hostId: "mac", homePath: "/a" }],
          ),
        ),
        environment(
          "env-b",
          summary(
            [bucket({ costUsd: 4, provider: "codex", model: "gpt-5.6-sol" })],
            [{ provider: "codex", hostId: "linux", homePath: "/b" }],
            USAGE_CONTRACT_VERSION - 1,
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(14);
    expect(merged.staleEnvironments).toEqual([]);
  });

  it("derives provider shares and cost quality", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              bucket({ costUsd: 75 }),
              bucket({ provider: "codex", model: "gpt-5.6-sol", costUsd: 25, unpricedRecords: 5 }),
            ],
            [
              { provider: "claude", hostId: "mac", homePath: "/a/.claude" },
              { provider: "codex", hostId: "mac", homePath: "/a/.codex" },
            ],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.providers[0]?.provider).toBe("claude");
    expect(merged.providers[0]?.costShare).toBeCloseTo(0.75, 5);
    expect(merged.costQuality.unpricedShare).toBeCloseTo(0.5, 5);
    expect(merged.costQuality.cacheSavingsUsd).toBe(4);
  });

  it("marks a model with no known rates as unpriced rather than free", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              bucket({ costUsd: 75 }),
              bucket({
                provider: "codex",
                model: "unknown-model",
                costUsd: 0,
                costSource: "unpriced",
                unpricedRecords: 5,
              }),
            ],
            [
              { provider: "claude", hostId: "mac", homePath: "/a/.claude" },
              { provider: "codex", hostId: "mac", homePath: "/a/.codex" },
            ],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.models.find((model) => model.model === "unknown-model")?.unpricedRecords).toBe(5);
    expect(merged.models.filter(isModelCostUnknown).map((model) => model.model)).toEqual([
      "unknown-model",
    ]);
  });

  it("orders models by cost descending", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              bucket({ provider: "claude", model: "lower-cost", costUsd: 4 }),
              bucket({ provider: "codex", model: "higher-cost", costUsd: 9 }),
            ],
            [
              { provider: "claude", hostId: "mac", homePath: "/a/.claude" },
              { provider: "codex", hostId: "mac", homePath: "/a/.codex" },
            ],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.models.map((model) => model.model)).toEqual(["higher-cost", "lower-cost"]);
  });

  it("keeps two machines apart when hostname and home path collide", () => {
    // Every Mac resolves /Users/theo/.claude, so a hostname clash used to make
    // one machine's usage vanish. Filesystem identity separates them.
    const shape = { provider: "claude" as const, hostId: "mac", homePath: "/Users/theo/.claude" };
    const merged = mergeUsage(
      [
        environment("env-a", summary([bucket()], [{ ...shape, volumeId: "16777220:1234" }])),
        environment("env-b", summary([bucket()], [{ ...shape, volumeId: "16777221:9999" }])),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(20);
    expect(merged.duplicateSources).toHaveLength(0);
  });

  it("still collapses two servers reading the same directory", () => {
    const same = {
      provider: "claude" as const,
      hostId: "mac",
      homePath: "/Users/theo/.claude",
      volumeId: "16777220:1234",
    };
    const merged = mergeUsage(
      [
        environment("env-a", summary([bucket()], [same])),
        environment("env-b", summary([bucket()], [same])),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.costUsd).toBe(10);
    expect(merged.duplicateSources).toHaveLength(1);
  });

  it("totals sessions from per-directory distinct counts, not per-bucket sums", () => {
    // One session that spans two days appears in two buckets. Summing bucket
    // sessions would say 2; the source's distinct count says 1.
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [bucket({ day: "2026-08-06" as UsageDay }), bucket({ day: "2026-08-07" as UsageDay })],
            [
              {
                provider: "claude",
                hostId: "mac",
                homePath: "/a/.claude",
                distinctSessions: 1,
              },
            ],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.sessions).toBe(1);
    expect(merged.providers[0]?.sessions).toBe(1);
  });

  it("returns empty totals with no environments", () => {
    const merged = mergeUsage([], USAGE_CONTRACT_VERSION);
    expect(merged.costUsd).toBe(0);
    expect(merged.daily).toHaveLength(0);
    expect(merged.hourly).toHaveLength(0);
  });

  it("omits providers with no sessions or usage", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [],
            [
              {
                provider: "claude",
                hostId: "mac",
                homePath: "/a/.claude",
                distinctSessions: 0,
              },
            ],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.providers).toEqual([]);
  });

  it("derives hourly totals without losing the daily rollup", () => {
    const merged = mergeUsage(
      [
        environment(
          "env-a",
          summary(
            [
              bucket({ hourStart: "2026-08-07T09:37:00.000Z", costUsd: 3 }),
              bucket({ hourStart: "2026-08-07T10:37:00.000Z", costUsd: 7 }),
            ],
            [{ provider: "claude", hostId: "mac", homePath: "/a/.claude" }],
          ),
        ),
      ],
      USAGE_CONTRACT_VERSION,
    );

    expect(merged.hourly.map((hour) => [hour.hourStart, hour.costUsd])).toEqual([
      ["2026-08-07T09:37:00.000Z", 3],
      ["2026-08-07T10:37:00.000Z", 7],
    ]);
    expect(merged.daily).toHaveLength(1);
    expect(merged.daily[0]?.costUsd).toBe(10);
  });
});

describe("mergeUsage byEnvironment", () => {
  const claudeAt = (hostId: string) => ({
    provider: "claude" as const,
    hostId,
    homePath: `/${hostId}/.claude`,
  });
  const codexAt = (hostId: string) => ({
    provider: "codex" as const,
    hostId,
    homePath: `/${hostId}/.codex`,
  });
  // bucket() carries 1160 tokens: 100 uncached + 1000 cached + 10 creation + 50 output.
  const cases: readonly {
    readonly name: string;
    readonly environments: readonly EnvironmentUsage[];
    readonly expected: readonly {
      environmentId: string;
      costUsd: number;
      totalTokens: number;
      records: number;
      unpricedRecords: number;
      sessions: number;
      providers: readonly UsageProviderKind[];
    }[];
  }[] = [
    {
      name: "splits two environments, the costlier first",
      environments: [
        environment("env-a", summary([bucket()], [claudeAt("mac")])),
        environment(
          "env-b",
          summary(
            [
              bucket({ provider: "codex", model: "gpt-5.6-sol", costUsd: 4, unpricedRecords: 2 }),
              bucket({ costUsd: 20 }),
            ],
            [claudeAt("linux"), { ...codexAt("linux"), distinctSessions: 3 }],
          ),
        ),
      ],
      expected: [
        {
          environmentId: "env-b",
          costUsd: 24,
          totalTokens: 2320,
          records: 10,
          unpricedRecords: 2,
          sessions: 4,
          providers: ["claude", "codex"],
        },
        {
          environmentId: "env-a",
          costUsd: 10,
          totalTokens: 1160,
          records: 5,
          unpricedRecords: 0,
          sessions: 1,
          providers: ["claude"],
        },
      ],
    },
    {
      name: "counts a shared directory only to the environment that claims it",
      environments: [
        environment("env-a", {
          ...summary([bucket()], [claudeAt("mac")]),
          readAt: "2026-08-07T01:00:00.000Z",
        }),
        environment(
          "env-b",
          summary(
            [
              bucket({ costUsd: 50 }),
              bucket({ provider: "codex", model: "gpt-5.6-sol", costUsd: 4 }),
            ],
            [claudeAt("mac"), codexAt("mac")],
          ),
        ),
      ],
      expected: [
        {
          environmentId: "env-a",
          costUsd: 10,
          totalTokens: 1160,
          records: 5,
          unpricedRecords: 0,
          sessions: 1,
          providers: ["claude"],
        },
        {
          environmentId: "env-b",
          costUsd: 4,
          totalTokens: 1160,
          records: 5,
          unpricedRecords: 0,
          sessions: 1,
          providers: ["codex"],
        },
      ],
    },
    {
      name: "leaves out a stale environment",
      environments: [
        environment("env-a", summary([bucket()], [claudeAt("mac")])),
        environment(
          "env-b",
          summary([bucket({ costUsd: 99 })], [claudeAt("linux")], USAGE_MERGE_COMPATIBLE_SINCE - 1),
        ),
      ],
      expected: [
        {
          environmentId: "env-a",
          costUsd: 10,
          totalTokens: 1160,
          records: 5,
          unpricedRecords: 0,
          sessions: 1,
          providers: ["claude"],
        },
      ],
    },
    {
      name: "leaves out environments with no buckets of their own",
      environments: [
        environment("env-a", {
          ...summary([bucket()], [claudeAt("mac")]),
          readAt: "2026-08-07T01:00:00.000Z",
        }),
        // Every bucket duplicates env-a's directory.
        environment("env-b", summary([bucket()], [claudeAt("mac")])),
        // Owns a directory, but it holds no usage.
        environment("env-c", summary([], [{ ...claudeAt("linux"), distinctSessions: 0 }])),
      ],
      expected: [
        {
          environmentId: "env-a",
          costUsd: 10,
          totalTokens: 1160,
          records: 5,
          unpricedRecords: 0,
          sessions: 1,
          providers: ["claude"],
        },
      ],
    },
    {
      name: "is empty with no environments",
      environments: [],
      expected: [],
    },
  ];

  it.each(cases)("$name", ({ environments, expected }) => {
    const merged = mergeUsage(environments, USAGE_CONTRACT_VERSION);

    expect(merged.byEnvironment.map(({ costShare: _c, tokenShare: _t, ...rest }) => rest)).toEqual(
      expected,
    );

    const sum = (pick: (row: (typeof merged.byEnvironment)[number]) => number) =>
      merged.byEnvironment.reduce((total, row) => total + pick(row), 0);
    expect(sum((row) => row.costUsd)).toBeCloseTo(merged.costUsd, 9);
    expect(sum((row) => row.totalTokens)).toBe(merged.totalTokens);
    expect(sum((row) => row.records)).toBe(merged.records);
    expect(sum((row) => row.sessions)).toBe(merged.sessions);
    expect(sum((row) => row.unpricedRecords)).toBe(
      merged.models.reduce((total, model) => total + model.unpricedRecords, 0),
    );
    if (merged.byEnvironment.length > 0) {
      expect(sum((row) => row.costShare)).toBeCloseTo(1, 9);
      expect(sum((row) => row.tokenShare)).toBeCloseTo(1, 9);
    }
  });

  it.each([
    {
      name: "shares follow cost and tokens separately",
      costs: [30, 10],
      tokenScale: [1, 3],
      expected: [
        { environmentId: "env-a", costShare: 0.75, tokenShare: 0.25 },
        { environmentId: "env-b", costShare: 0.25, tokenShare: 0.75 },
      ],
    },
    {
      name: "cost share is 0 when nothing was priced",
      costs: [0, 0],
      tokenScale: [3, 1],
      expected: [
        { environmentId: "env-a", costShare: 0, tokenShare: 0.75 },
        { environmentId: "env-b", costShare: 0, tokenShare: 0.25 },
      ],
    },
  ])("$name", ({ costs, tokenScale, expected }) => {
    const merged = mergeUsage(
      ["env-a", "env-b"].map((id, index) =>
        environment(
          id,
          summary(
            [
              bucket({
                costUsd: costs[index] ?? 0,
                totals: {
                  uncachedInputTokens: 100 * (tokenScale[index] ?? 0),
                  cachedInputTokens: 0,
                  cacheCreationTokens: 0,
                  outputTokens: 0,
                  reasoningTokens: 0,
                },
              }),
            ],
            [claudeAt(id)],
          ),
        ),
      ),
      USAGE_CONTRACT_VERSION,
    );

    expect(
      merged.byEnvironment.map(({ environmentId, costShare, tokenShare }) => ({
        environmentId,
        costShare,
        tokenShare,
      })),
    ).toEqual(expected);
  });
});

describe("mergeUsage scope", () => {
  const shared = { provider: "claude" as const, hostId: "mac", homePath: "/home/theo/.claude" };
  // env-a read last, so it claims the shared directory in the unscoped merge.
  const environments = [
    environment("env-a", {
      ...summary([bucket()], [shared]),
      readAt: "2026-08-07T01:00:00.000Z",
    }),
    environment("env-b", summary([bucket({ costUsd: 50 })], [shared])),
    environment("env-c", summary([bucket({ costUsd: 3 })], [{ ...shared, hostId: "linux" }])),
  ];
  const unscoped = mergeUsage(environments, USAGE_CONTRACT_VERSION);

  it.each([
    {
      name: "a scoped environment that lost a shared directory does not re-claim it",
      scope: ["env-b"],
      costUsd: 0,
      contributing: [],
    },
    {
      name: "the owner keeps its claim under a scope",
      scope: ["env-a"],
      costUsd: 10,
      contributing: ["env-a"],
    },
    {
      name: "several scoped environments sum their unscoped rows",
      scope: ["env-b", "env-c"],
      costUsd: 3,
      contributing: ["env-c"],
    },
  ])("$name", ({ scope, costUsd, contributing }) => {
    const scoped = mergeUsage(environments, USAGE_CONTRACT_VERSION, (environmentId) =>
      scope.includes(environmentId),
    );
    const unscopedRows = unscoped.byEnvironment.filter((row) => scope.includes(row.environmentId));

    expect(scoped.costUsd).toBe(costUsd);
    expect(scoped.costUsd).toBe(unscopedRows.reduce((sum, row) => sum + row.costUsd, 0));
    expect(scoped.byEnvironment.map((row) => row.environmentId)).toEqual(
      unscopedRows.map((row) => row.environmentId),
    );
    expect(scoped.contributingEnvironments).toEqual(contributing);
    expect(scoped.duplicateSources).toEqual(unscoped.duplicateSources);
    expect(scoped.duplicateSources).toHaveLength(1);
  });
});
