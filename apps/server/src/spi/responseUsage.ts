import {
  TurnUsageCompletedPayload,
  type UsageComponents,
  type UsageModelLine,
  type UsageNativeCost,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

const completedUsage = Schema.decodeSync(TurnUsageCompletedPayload);
const decodeRecord = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));
function record(value: unknown): Record<string, unknown> | undefined {
  return Option.getOrUndefined(decodeRecord(value));
}
function text(value: unknown): string | null {
  return Predicate.isString(value) && value.trim().length > 0 ? value.trim() : null;
}
function quantity(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (!Predicate.isNumber(value) || !Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid provider token quantity");
  return String(value);
}
function cost(value: unknown, basis: string): UsageNativeCost | null {
  if (value === undefined || value === null) return null;
  if (!Predicate.isNumber(value) || !Number.isFinite(value) || value < 0)
    throw new Error("Invalid provider cost");
  const [mantissa = "", exponent = "0"] = String(value).split("e");
  const [whole = "", fraction = ""] = mantissa.split(".");
  const scale = fraction.length - Number(exponent);
  if (scale > 18) throw new Error("Provider cost exceeds supported decimal precision");
  const amount = BigInt(whole + fraction) * 10n ** BigInt(Math.max(0, -scale));
  return { amount: String(amount), scale: Math.max(0, scale), currency: "USD", basis };
}
function difference(current: string | null, previous: string | null): string | null {
  if (current === null || previous === null) return null;
  const delta = BigInt(current) - BigInt(previous);
  if (delta < 0n) throw new Error("Native usage ledger reset without an explicit baseline");
  return String(delta);
}
function costDifference(current: UsageNativeCost | null, previous: UsageNativeCost | null) {
  if (!current || !previous) return null;
  if (current.currency !== previous.currency || current.basis !== previous.basis)
    throw new Error("Provider cost basis changed without an explicit baseline");
  const scale = Math.max(current.scale, previous.scale);
  const delta = difference(
    String(BigInt(current.amount) * 10n ** BigInt(scale - current.scale)),
    String(BigInt(previous.amount) * 10n ** BigInt(scale - previous.scale)),
  );
  return { ...current, amount: delta!, scale };
}
const componentNames = [
  "uncachedInput",
  "cachedInput",
  "cacheCreation",
  "output",
  "reasoning",
  "inclusiveTotal",
] as const;
function subtract(current: UsageComponents, previous: UsageComponents): UsageComponents {
  return Object.fromEntries(
    componentNames.map((key) => [key, difference(current[key], previous[key])]),
  ) as UsageComponents;
}
function add(current: UsageComponents, next: UsageComponents): UsageComponents {
  return Object.fromEntries(
    componentNames.map((key) => [
      key,
      current[key] === null || next[key] === null
        ? null
        : String(BigInt(current[key]) + BigInt(next[key])),
    ]),
  ) as UsageComponents;
}
function claudeModels(value: unknown): UsageModelLine[] {
  const models = record(value);
  if (!models) throw new Error("Claude did not report its native cumulative model ledger");
  return Object.entries(models)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([model, raw]) => {
      const usage = record(raw);
      if (!usage) throw new Error("Invalid Claude model ledger");
      return {
        model,
        components: {
          uncachedInput: quantity(usage.inputTokens),
          cachedInput: quantity(usage.cacheReadInputTokens),
          cacheCreation: quantity(usage.cacheCreationInputTokens),
          output: quantity(usage.outputTokens),
          reasoning: quantity(usage.thinkingTokens),
          inclusiveTotal: null,
        },
        nativeCost: cost(usage.costUSD, text(usage.costBasis) ?? "provider-reported-estimate"),
      };
    });
}
interface ClaudeLedger {
  readonly models: UsageModelLine[];
  readonly nativeCost: UsageNativeCost | null;
}
function claudeLedger(models: unknown, totalCost: unknown): ClaudeLedger {
  return {
    models: claudeModels(models),
    nativeCost: cost(totalCost, "provider-reported-estimate"),
  };
}

/** Final native results include Task/sidechain usage. Their ledger is cumulative, including resume history. */
export function makeClaudeTurnUsage(baseline: unknown) {
  const session = record(record(baseline)?.session);
  if (!session) throw new Error("Claude live usage baseline is unavailable");
  let ledger = claudeLedger(session.model_usage, session.total_cost_usd);
  let nativeSession: string | null = null;
  const results = new Map<string, string>();
  const resets = new Map<string, string>();
  const retiredSessions = new Set<string>();
  const read = (message: unknown): ReadonlyArray<TurnUsageCompletedPayload> => {
    const envelope = record(message);
    if (envelope?.type !== "result") return [];
    const nativeThreadId = text(envelope.session_id);
    const nativeTurnId = text(envelope.uuid);
    if (!nativeThreadId || !nativeTurnId) throw new Error("Claude result has no native identity");
    if (retiredSessions.has(nativeThreadId))
      throw new Error("Claude result belongs to a retired native ledger");
    if (nativeSession !== null && nativeSession !== nativeThreadId)
      throw new Error("Claude native session changed without an explicit live baseline");
    const current = claudeLedger(envelope.modelUsage, envelope.total_cost_usd);
    const encoded = JSON.stringify(current);
    const prior = results.get(nativeTurnId);
    if (prior) {
      if (prior !== encoded)
        throw new Error("Claude repeated a result identity with changed usage");
      return [];
    }
    const oldModels = new Map(ledger.models.map((line) => [line.model, line]));
    for (const old of ledger.models) {
      if (!current.models.some((line) => line.model === old.model))
        throw new Error("Claude native model ledger disappeared without an explicit baseline");
    }
    const models = current.models.map((line) => {
      const old = oldModels.get(line.model);
      return {
        ...line,
        components: old ? subtract(line.components, old.components) : line.components,
        nativeCost: old ? costDifference(line.nativeCost, old.nativeCost) : line.nativeCost,
      };
    });
    const participating = models.filter(
      (line) =>
        componentNames.some(
          (key) => line.components[key] !== null && line.components[key] !== "0",
        ) ||
        (line.nativeCost !== null && line.nativeCost.amount !== "0"),
    );
    const nativeCost = costDifference(current.nativeCost, ledger.nativeCost);
    ledger = current;
    nativeSession = nativeThreadId;
    results.set(nativeTurnId, encoded);
    if (models.length === 0 && nativeCost === null) return [];
    const fact = completedUsage({
      nativeThreadId,
      nativeTurnId: nativeTurnId,
      models: participating,
      nativeCost,
      parentId: null,
    });
    return [fact];
  };
  return Object.assign(read, {
    resetNativeLedger: (resetId: string, retiredSessionId: string): boolean => {
      const prior = resets.get(resetId);
      if (prior !== undefined) {
        if (prior !== retiredSessionId)
          throw new Error("Claude repeated a reset identity with changed session");
        return false;
      }
      // Native conversation_reset precedes CostLedger.reset: USD becomes zero and models empty.
      // The following native result occurs after that reset and reports its own new session id.
      resets.set(resetId, retiredSessionId);
      retiredSessions.add(retiredSessionId);
      ledger = claudeLedger({}, 0);
      nativeSession = null;
      results.clear();
      return true;
    },
  });
}

function codexComponents(usage: Record<string, unknown>): UsageComponents {
  const input = quantity(usage.inputTokens),
    cached = quantity(usage.cachedInputTokens),
    written = quantity(usage.cacheWriteInputTokens);
  const uncached =
    input !== null && cached !== null && written !== null
      ? BigInt(input) - BigInt(cached) - BigInt(written)
      : null;
  if (uncached !== null && uncached < 0n)
    throw new Error("Provider cache tokens exceed input tokens");
  return {
    uncachedInput: uncached !== null ? String(uncached) : null,
    cachedInput: cached,
    cacheCreation: written,
    output: quantity(usage.outputTokens),
    reasoning: quantity(usage.reasoningOutputTokens),
    inclusiveTotal: quantity(usage.totalTokens),
  };
}
interface CodexTurn {
  readonly responses: Map<string, UsageComponents>;
  readonly parentId: string | null;
  completed: boolean;
}
/** Accumulate exact upstream response meters; context counters never participate. */
export function makeCodexTurnUsage() {
  const turns = new Map<string, CodexTurn>();
  return (method: string, payload: unknown): ReadonlyArray<TurnUsageCompletedPayload> => {
    const envelope = record(payload);
    if (!envelope) return [];
    if (method === "rawResponse/completed") {
      // Native raw completions may omit a meter; absence is not a corrupt accounting receipt.
      if (envelope.usage === null || envelope.usage === undefined) return [];
      const threadId = text(envelope.threadId),
        turnId = text(envelope.turnId),
        responseId = text(envelope.responseId);
      const usage = record(envelope.usage);
      if (!threadId || !turnId || !responseId || !usage)
        throw new Error("Codex exact response meter is unavailable");
      const key = JSON.stringify([threadId, turnId]);
      const turn = turns.get(key) ?? {
        responses: new Map(),
        parentId: text(envelope.parentThreadId),
        completed: false,
      };
      const components = codexComponents(usage);
      const old = turn.responses.get(responseId);
      if (old) {
        if (JSON.stringify(old) !== JSON.stringify(components))
          throw new Error("Codex repeated a response identity with changed usage");
        return [];
      }
      if (turn.completed)
        throw new Error("Codex response meter arrived after native turn completion");
      turn.responses.set(responseId, components);
      turns.set(key, turn);
      return [];
    }
    if (
      method !== "turn/completed" &&
      method !== "usage/turnCompleted" &&
      method !== "collabAgent/turnCompleted"
    )
      return [];
    const threadId = text(
      method === "collabAgent/turnCompleted" ? envelope.agentThreadId : envelope.threadId,
    );
    const turnId = text(record(envelope.turn)?.id);
    if (!threadId || !turnId) return [];
    const turn = turns.get(JSON.stringify([threadId, turnId]));
    if (!turn || turn.completed) return [];
    turn.completed = true;
    const meters = [...turn.responses.values()];
    const components = meters.slice(1).reduce(add, meters[0]!);
    return [
      completedUsage({
        nativeThreadId: threadId,
        nativeTurnId: turnId,
        models: [{ model: null, components, nativeCost: null }],
        nativeCost: null,
        parentId: turn.parentId,
      }),
    ];
  };
}
