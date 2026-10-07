/** Transcript evidence normalized before replication; no heuristic payload dedup or fork timers. */
import { UsageComponents, type UsageFact } from "@t3tools/contracts";
import { usageDigest } from "@t3tools/shared/agentUsage";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { AntigravityGeneration } from "./antigravityUsageReader.ts";
import { readGrokTurn, type UsageRecord } from "./usageTranscripts.ts";

const Count = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
const Counts = Schema.Struct({
  input_tokens: Schema.optionalKey(Count),
  output_tokens: Schema.optionalKey(Count),
  cache_read_input_tokens: Schema.optionalKey(Count),
  cache_creation_input_tokens: Schema.optionalKey(Count),
  cached_input_tokens: Schema.optionalKey(Count),
  cache_write_input_tokens: Schema.optionalKey(Count),
  reasoning_output_tokens: Schema.optionalKey(Count),
  total_tokens: Schema.optionalKey(Count),
  speed: Schema.optionalKey(Schema.String),
  output_tokens_details: Schema.optionalKey(
    Schema.Struct({ thinking_tokens: Schema.optionalKey(Count) }),
  ),
  cache_creation: Schema.optionalKey(
    Schema.Struct({
      ephemeral_5m_input_tokens: Schema.optionalKey(Count),
      ephemeral_1h_input_tokens: Schema.optionalKey(Count),
    }),
  ),
});
const Claude = Schema.Struct({
  type: Schema.Literal("assistant"),
  sessionId: Schema.String,
  /** A sub-agent's records carry its own id beside the parent's `sessionId`. */
  agentId: Schema.optionalKey(Schema.String),
  requestId: Schema.optionalKey(Schema.String),
  timestamp: Schema.optionalKey(Schema.String),
  message: Schema.Struct({
    id: Schema.String,
    model: Schema.optionalKey(Schema.String),
    usage: Counts,
  }),
});
const Codex = Schema.Struct({
  type: Schema.String,
  timestamp: Schema.optionalKey(Schema.String),
  payload: Schema.Unknown,
});
const Meta = Schema.Struct({
  id: Schema.String,
  forked_from_id: Schema.optionalKey(Schema.String),
  source: Schema.optionalKey(Schema.Unknown),
});
const SpawnedSource = Schema.Struct({
  subagent: Schema.Struct({
    thread_spawn: Schema.Struct({ parent_thread_id: Schema.String }),
  }),
});
const decodeSpawned = Schema.decodeUnknownOption(SpawnedSource);
const Context = Schema.Struct({
  model: Schema.optionalKey(Schema.String),
  turn_id: Schema.optionalKey(Schema.String),
});
const Tokens = Schema.Struct({
  type: Schema.Literal("token_count"),
  info: Schema.NullOr(Schema.Struct({ total_token_usage: Counts })),
});
const isAssistantRecord = Schema.is(Schema.Struct({ type: Schema.Literal("assistant") }));
const isTokenRecord = Schema.is(Schema.Struct({ type: Schema.Literal("token_count") }));
const isChildSource = Schema.is(Schema.Struct({ subagent: Schema.Unknown }));
const decodeComponents = Schema.decodeOption(UsageComponents);
const decodeClaude = Schema.decodeUnknownOption(Claude);
const decodeCodex = Schema.decodeUnknownOption(Codex);
const decodeMeta = Schema.decodeUnknownOption(Meta);
const decodeContext = Schema.decodeUnknownOption(Context);
const decodeTokens = Schema.decodeUnknownOption(Tokens);
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
const quantity = (value: number | undefined) => (value === undefined ? null : String(value));
const time = (at: string | undefined): UsageFact["time"] => {
  if (at && /^\d{4}-\d{2}-\d{2}T.*Z$/u.test(at) && Number.isFinite(Date.parse(at)))
    return { kind: "instant", at, provenance: "provider-transcript" };
  return { kind: "undated" };
};
/** An instant a provider wrote as epoch milliseconds, or undated when it is no instant at all. */
const instant = (ms: number, provenance: string): UsageFact["time"] => {
  const at = DateTime.make(ms);
  return Option.isSome(at)
    ? { kind: "instant", at: DateTime.formatIso(at.value), provenance }
    : { kind: "undated" };
};
export type MeterFact = Omit<UsageFact, "originId" | "revision">;
export interface MeterResult {
  readonly fact?: MeterFact;
  readonly gap?: string;
}
/** A cumulative counter as it stood when capture began, subtracted from every later total. */
const CounterBaseline = Schema.Struct({
  input_tokens: Schema.optionalKey(Schema.Number),
  cached_input_tokens: Schema.optionalKey(Schema.Number),
  cache_write_input_tokens: Schema.optionalKey(Schema.Number),
  output_tokens: Schema.optionalKey(Schema.Number),
  reasoning_output_tokens: Schema.optionalKey(Schema.Number),
  total_tokens: Schema.optionalKey(Schema.Number),
});
type CounterBaseline = typeof CounterBaseline.Type;
export const CodexMeterState = Schema.Struct({
  sessionId: Schema.NullOr(Schema.String),
  fork: Schema.Boolean,
  model: Schema.NullOr(Schema.String),
  mixedModels: Schema.Boolean,
  total: Schema.NullOr(Schema.String),
  counterReset: Schema.optionalKey(Schema.Boolean),
  since: Schema.NullOr(Schema.String),
  baseline: Schema.optionalKey(CounterBaseline),
  /** The native session a fork or a spawned child came from. */
  parent: Schema.optionalKey(Schema.String),
  /** While set, token counts are the parent's history copied in at this instant. */
  copiedAt: Schema.optionalKey(Schema.String),
});
export type CodexMeterState = {
  -readonly [K in keyof typeof CodexMeterState.Type]: (typeof CodexMeterState.Type)[K];
};
export const initialMeterState = (): CodexMeterState => ({
  sessionId: null,
  fork: false,
  model: null,
  mixedModels: false,
  total: null,
  counterReset: false,
  since: null,
});
/**
 * A forked or spawned rollout opens with its parent's history copied in, re-stamped to the fork
 * instant within milliseconds; a genuine count follows a model turn, seconds later.
 */
const COPY_BURST_MS = 1000;
const common = (
  native: unknown,
  sessionId: string,
  provider: UsageFact["provider"],
  parent: string | undefined,
  source = "transcript",
) => {
  const id = usageDigest([provider, native]);
  return {
    factId: id,
    nativeId: id,
    aliases: [],
    provider,
    nativeCost: null,
    sessionId: usageDigest([provider, sessionId]),
    runId: null,
    // The native parent session, hashed as its own `sessionId`, so HQ can nest the two.
    parentId: parent === undefined ? null : usageDigest([provider, parent]),
    meterVersion: `${provider}-${source}-v1`,
    state: "provisional" as const,
  };
};
const COUNTER_FIELDS = [
  "input_tokens",
  "cached_input_tokens",
  "cache_write_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
  "total_tokens",
] as const;
const before = (at: UsageFact["time"], floor: number | undefined) =>
  floor !== undefined && at.kind === "instant" && Date.parse(at.at) < floor;

/**
 * One transcript line as normalized evidence. A record from before `floor` (when capture began)
 * is never a fact: a Codex counter there becomes the baseline its later totals are measured from.
 */
export function meterLine(
  provider: "claude" | "codex",
  line: string,
  state: CodexMeterState,
  floor?: number,
): MeterResult {
  const json = decodeJson(line);
  if (Option.isNone(json)) return { gap: "damaged-transcript" };
  if (provider === "claude") {
    const decoded = decodeClaude(json.value);
    if (Option.isNone(decoded)) {
      const isAssistant = isAssistantRecord(json.value);
      return isAssistant ? { gap: "claude-missing-native-meter" } : {};
    }
    const row = decoded.value;
    if (before(time(row.timestamp), floor)) return {};
    if (!row.sessionId || !row.message.id) return { gap: "claude-missing-native-identity" };
    const counts = row.message.usage;
    const five = counts.cache_creation?.ephemeral_5m_input_tokens;
    const hour = counts.cache_creation?.ephemeral_1h_input_tokens;
    if (
      counts.cache_creation_input_tokens !== undefined &&
      (five ?? 0) + (hour ?? 0) > counts.cache_creation_input_tokens
    )
      return { gap: "claude-invalid-cache-duration-split" };
    const speed = counts.speed === "fast" ? "fast" : "standard";
    let pricingBand: string = speed;
    if (counts.cache_creation_input_tokens && five === counts.cache_creation_input_tokens)
      pricingBand = speed === "fast" ? "fast-cache-5m" : "cache-5m";
    if (counts.cache_creation_input_tokens && hour === counts.cache_creation_input_tokens)
      pricingBand = speed === "fast" ? "fast-cache-1h" : "cache-1h";
    const mixed = Boolean(five && hour);
    const durationUnknown = Boolean(
      counts.cache_creation_input_tokens &&
      five !== counts.cache_creation_input_tokens &&
      hour !== counts.cache_creation_input_tokens,
    );
    if (durationUnknown) pricingBand = mixed ? "mixed-cache-duration" : "cache-duration-unknown";
    const thinking = counts.output_tokens_details?.thinking_tokens;
    const components: UsageComponents = {
      uncachedInput: quantity(counts.input_tokens),
      cachedInput: quantity(counts.cache_read_input_tokens),
      cacheCreation: quantity(counts.cache_creation_input_tokens),
      output: quantity(counts.output_tokens),
      // Thinking is part of output; a record without the detail leaves it unknown, never zero.
      reasoning:
        thinking !== undefined &&
        (counts.output_tokens === undefined || thinking <= counts.output_tokens)
          ? String(thinking)
          : null,
      inclusiveTotal: null,
    };
    return {
      ...(durationUnknown
        ? { gap: mixed ? "claude-mixed-cache-duration" : "claude-cache-duration-unavailable" }
        : {}),
      fact: {
        ...(row.agentId
          ? common([row.message.id], row.agentId, provider, row.sessionId)
          : common([row.message.id], row.sessionId, provider, undefined)),
        model: row.message.model || null,
        components,
        time: time(row.timestamp),
        pricingBand,
        evidence: "assistant-response",
      },
    };
  }
  const decoded = decodeCodex(json.value);
  if (Option.isNone(decoded)) return { gap: "damaged-codex-record" };
  const row = decoded.value;
  if (row.type === "session_meta") {
    const meta = decodeMeta(row.payload);
    if (Option.isNone(meta)) return { gap: "codex-missing-native-identity" };
    const spawned = decodeSpawned(meta.value.source);
    const parent =
      meta.value.forked_from_id ??
      (Option.isSome(spawned) ? spawned.value.subagent.thread_spawn.parent_thread_id : undefined);
    if (state.sessionId) {
      // Only the first meta describes this rollout; a fork repeats its ancestors' after it.
      if (state.sessionId === meta.value.id || state.parent !== undefined) return {};
      state.fork = true;
      return { gap: "codex-session-changed" };
    }
    state.sessionId = meta.value.id;
    const at = time(row.timestamp);
    state.since = at.kind === "instant" ? at.at : null;
    if (parent !== undefined) state.parent = parent;
    if (parent !== undefined || isChildSource(meta.value.source)) {
      if (at.kind === "instant") state.copiedAt = at.at;
    }
    return {};
  }
  if (row.type === "turn_context") {
    const context = decodeContext(row.payload);
    if (Option.isSome(context) && context.value.model) {
      if ((state.total !== null || state.model !== null) && state.model !== context.value.model)
        state.mixedModels = true;
      state.model = context.value.model;
    }
    return {};
  }
  if (row.type !== "event_msg") return {};
  const tokens = decodeTokens(row.payload);
  if (Option.isNone(tokens))
    return isTokenRecord(row.payload) ? { gap: "codex-damaged-meter" } : {};
  if (!tokens.value.info) return { gap: "codex-missing-meter" };
  if (!state.sessionId || state.fork || state.counterReset)
    return { gap: "codex-unproved-counter-lineage" };
  const cumulative = tokens.value.info.total_token_usage;
  const reached = quantity(cumulative.total_tokens);
  if (reached === null) return { gap: "codex-missing-inclusive-counter" };
  if (state.total !== null && BigInt(reached) < BigInt(state.total)) {
    state.counterReset = true;
    return { gap: "codex-unproved-counter-reset" };
  }
  const at = time(row.timestamp);
  const copied =
    state.copiedAt !== undefined &&
    at.kind === "instant" &&
    Date.parse(at.at) - Date.parse(state.copiedAt) < COPY_BURST_MS;
  if (copied && at.kind === "instant") state.copiedAt = at.at;
  else delete state.copiedAt;
  if (copied || before(at, floor)) {
    // What the session had used when capture began; its later totals count from here.
    state.baseline = Object.fromEntries(
      COUNTER_FIELDS.flatMap((field) =>
        cumulative[field] === undefined ? [] : [[field, cumulative[field]]],
      ),
    ) as CounterBaseline;
    state.total = reached;
    state.since = at.kind === "instant" ? at.at : state.since;
    return {};
  }
  const base = state.baseline;
  const counts: Partial<Record<(typeof COUNTER_FIELDS)[number], number>> = {};
  for (const field of COUNTER_FIELDS) {
    const value = cumulative[field];
    if (value !== undefined) counts[field] = value - (base?.[field] ?? 0);
  }
  if (Object.values(counts).some((value) => value < 0)) {
    state.counterReset = true;
    return { gap: "codex-unproved-counter-reset" };
  }
  const total = String(counts.total_tokens);
  if (total === "0") return {};
  const cached = counts.cached_input_tokens;
  // OpenAI has no cache-write meter: without the field a write is a structural zero.
  const written = counts.cache_write_input_tokens ?? 0;
  if (
    cached !== undefined &&
    counts.input_tokens !== undefined &&
    cached + written > counts.input_tokens
  )
    return { gap: "codex-invalid-cache-subset" };
  const components: UsageComponents = {
    uncachedInput:
      cached !== undefined && counts.input_tokens !== undefined
        ? String(counts.input_tokens - cached - written)
        : null,
    cachedInput: quantity(cached),
    cacheCreation: String(written),
    output: quantity(counts.output_tokens),
    reasoning: quantity(counts.reasoning_output_tokens),
    inclusiveTotal: total,
  };
  if (Option.isNone(decodeComponents(components))) return { gap: "codex-inconsistent-counter" };
  state.total = reached;
  const until = at;
  const period: UsageFact["time"] =
    state.since && until.kind === "instant" && Date.parse(state.since) < Date.parse(until.at)
      ? {
          kind: "interval",
          since: state.since,
          until: until.at,
          provenance: "provider-counter-range",
        }
      : { kind: "undated" };
  return {
    fact: {
      ...common([state.sessionId, "session-counter"], state.sessionId, provider, state.parent),
      model: state.mixedModels ? null : state.model,
      pricingBand: "counter-pricing-approximate",
      components,
      time: period,
      evidence: "cumulative-session-segment",
    },
    gap: "codex-request-allocation-unavailable",
  };
}

/** Every fact one native record holds, and why any part of it is not one. */
export interface MeterFacts {
  readonly facts: ReadonlyArray<MeterFact>;
  readonly gaps: ReadonlyArray<string>;
}
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const count = (record: Readonly<Record<string, unknown>>, key: string) => {
  const value = record[key];
  return isCount(value) ? value : undefined;
};

/**
 * One Grok `updates.jsonl` line: a completed turn is one fact per model it used, identified by its
 * session, prompt and model; a turn without a prompt id cannot be told from a repeat and is none.
 */
export function meterGrokLine(line: string, floor?: number): MeterFacts {
  if (Option.isNone(decodeJson(line))) return { facts: [], gaps: ["damaged-transcript"] };
  const turn = readGrokTurn(line);
  if (turn === null) return { facts: [], gaps: [] };
  const at = instant(turn.timestampMs, "provider-transcript");
  if (before(at, floor)) return { facts: [], gaps: [] };
  if (!turn.sessionId || !turn.promptId)
    return { facts: [], gaps: ["grok-missing-native-identity"] };
  const entries: ReadonlyArray<readonly [string | null, Readonly<Record<string, unknown>>]> =
    turn.models.length > 0 ? turn.models : [[null, turn.usage]];
  const facts: MeterFact[] = [];
  const gaps: string[] = [];
  for (const [model, meter] of entries) {
    const input = count(meter, "inputTokens");
    const output = count(meter, "outputTokens");
    const cached = count(meter, "cachedReadTokens");
    const written = count(meter, "cacheCreationTokens");
    const thinking = count(meter, "reasoningTokens");
    const total = count(meter, "totalTokens");
    if (!input && !output && !total) continue;
    // Grok's input includes its cached reads and writes; more cache than input is no split at all.
    const uncached =
      input !== undefined && cached !== undefined && written !== undefined
        ? input - cached - written
        : undefined;
    if (uncached !== undefined && uncached < 0) {
      gaps.push("grok-invalid-cache-subset");
      continue;
    }
    const split = [uncached, cached, written, output];
    const known = split.every((part) => part !== undefined);
    const components: UsageComponents = {
      uncachedInput: quantity(uncached),
      cachedInput: quantity(cached),
      cacheCreation: quantity(written),
      output: quantity(output),
      reasoning:
        thinking !== undefined && (output === undefined || thinking <= output)
          ? String(thinking)
          : null,
      inclusiveTotal:
        total !== undefined && (!known || split.reduce((sum, part) => sum! + part!, 0) === total)
          ? String(total)
          : null,
    };
    if (Option.isNone(decodeComponents(components))) {
      gaps.push("grok-inconsistent-meter");
      continue;
    }
    facts.push({
      ...common(
        [`${turn.sessionId}:${turn.promptId}:${model ?? "grok"}`],
        turn.sessionId,
        "grok",
        undefined,
      ),
      model,
      pricingBand: "standard",
      components,
      time: at,
      evidence: "turn-completed",
    });
  }
  return { facts, gaps };
}

/** A provider database's five token counts, which its own schema always writes. */
const databaseComponents = (totals: UsageRecord["totals"]): UsageComponents => ({
  uncachedInput: String(totals.uncachedInputTokens),
  cachedInput: String(totals.cachedInputTokens),
  cacheCreation: String(totals.cacheCreationTokens),
  output: String(totals.outputTokens),
  reasoning: String(totals.reasoningTokens),
  inclusiveTotal: null,
});

/** One OpenCode assistant message, as `readOpenCodeUsage` reads it, is one fact. */
export function meterOpenCodeMessage(record: UsageRecord): MeterFacts {
  const message = record.dedupeKey?.startsWith("opencode:")
    ? record.dedupeKey.slice("opencode:".length)
    : "";
  if (!message) return { facts: [], gaps: ["opencode-missing-native-identity"] };
  return {
    facts: [
      {
        ...common([message], record.sessionId, "opencode", undefined, "database"),
        sessionId: record.sessionId ? usageDigest(["opencode", record.sessionId]) : null,
        model: record.model || null,
        pricingBand: "standard",
        components: databaseComponents(record.totals),
        time: instant(record.timestampMs, "provider-database"),
        evidence: "assistant-message",
      },
    ],
    gaps: [],
  };
}

/** Aliases a fact may carry; the rest of a generation's identities are dropped. */
const ALIASES_MAX = 16;

/**
 * One Antigravity generation is one fact under its first identity, the others its aliases. One
 * without any identity has only a position in its file, which a rewrite moves: it is no fact.
 */
export function meterAntigravityGeneration(generation: AntigravityGeneration): MeterFacts {
  const [first, ...others] = generation.keys;
  if (first === undefined) return { facts: [], gaps: ["antigravity-missing-native-identity"] };
  const { record } = generation;
  // Only its own clock dates a generation; its conversation's start or the file's time never do.
  const dated = generation.timestampQuality === 2;
  return {
    facts: [
      {
        ...common([first], record.sessionId, "antigravity", undefined, "database"),
        aliases: others.slice(0, ALIASES_MAX).map((key) => usageDigest(["antigravity", [key]])),
        model: record.model === "antigravity-unknown" ? null : record.model || null,
        pricingBand: "standard",
        components: databaseComponents(record.totals),
        time: dated ? instant(record.timestampMs, "provider-database") : { kind: "undated" },
        evidence: "generation",
      },
    ],
    gaps: dated
      ? []
      : [
          generation.timestampQuality === 1
            ? "antigravity-conversation-time-only"
            : "antigravity-file-time-only",
        ],
  };
}
