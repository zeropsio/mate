/** Transcript evidence normalized before replication; no heuristic payload dedup or fork timers. */
import { UsageComponents, type UsageFact } from "@t3tools/contracts";
import { usageDigest } from "@t3tools/shared/agentUsage";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

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
const common = (native: unknown, sessionId: string, provider: "claude" | "codex") => {
  const id = usageDigest([provider, native]);
  return {
    factId: id,
    nativeId: id,
    aliases: [],
    provider,
    nativeCost: null,
    sessionId: usageDigest([provider, sessionId]),
    runId: null,
    parentId: null,
    meterVersion: `${provider}-transcript-v1`,
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
    const components: UsageComponents = {
      uncachedInput: quantity(counts.input_tokens),
      cachedInput: quantity(counts.cache_read_input_tokens),
      cacheCreation: quantity(counts.cache_creation_input_tokens),
      output: quantity(counts.output_tokens),
      reasoning: null,
      inclusiveTotal: null,
    };
    return {
      ...(durationUnknown
        ? { gap: mixed ? "claude-mixed-cache-duration" : "claude-cache-duration-unavailable" }
        : {}),
      fact: {
        ...common([row.message.id], row.sessionId, provider),
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
    const inherited = meta.value.forked_from_id !== undefined || isChildSource(meta.value.source);
    if (state.sessionId) {
      if (state.sessionId !== meta.value.id) {
        state.fork = true;
        return { gap: "codex-session-changed" };
      }
      if (state.fork !== inherited) {
        state.fork = true;
        return { gap: "codex-incomparable-session-lineage" };
      }
      return {};
    }
    state.sessionId = meta.value.id;
    state.fork = inherited;
    const at = time(row.timestamp);
    state.since = at.kind === "instant" ? at.at : null;
    return isChildSource(meta.value.source)
      ? { gap: "codex-child-overlap-unproved" }
      : state.fork
        ? { gap: "codex-inherited-history" }
        : {};
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
  if (before(at, floor)) {
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
  if (cached !== undefined && counts.input_tokens !== undefined && cached > counts.input_tokens)
    return { gap: "codex-invalid-cache-subset" };
  const components: UsageComponents = {
    uncachedInput:
      cached !== undefined && counts.input_tokens !== undefined
        ? String(counts.input_tokens - cached)
        : null,
    cachedInput: quantity(cached),
    cacheCreation: "0",
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
      ...common([state.sessionId, "session-counter"], state.sessionId, provider),
      model: state.mixedModels ? null : state.model,
      pricingBand: "counter-pricing-approximate",
      components,
      time: period,
      evidence: "cumulative-session-segment",
    },
    gap: "codex-request-allocation-unavailable",
  };
}
