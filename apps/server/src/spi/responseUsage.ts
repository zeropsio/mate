import {
  TurnUsageCompletedPayload,
  type UsageComponents,
  type UsageModelLine,
  UsageNativeCost,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";

const completedUsage = Schema.decodeSync(TurnUsageCompletedPayload);
const decodeRecord = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown));
const isNativeCost = Schema.is(UsageNativeCost);
function record(value: unknown): Record<string, unknown> | undefined {
  return Option.getOrUndefined(decodeRecord(value));
}
function text(value: unknown): string | null {
  return Predicate.isString(value) && value.trim().length > 0 ? value.trim() : null;
}
function quantity(value: unknown): string | null {
  if (!Predicate.isNumber(value) || !Number.isSafeInteger(value) || value < 0) return null;
  return String(value);
}
function cost(value: unknown, basis: string): UsageNativeCost | null {
  if (!Predicate.isNumber(value) || !Number.isFinite(value) || value < 0) return null;
  const [mantissa = "", exponent = "0"] = String(value).split("e");
  const [whole = "", fraction = ""] = mantissa.split(".");
  // Native USD numbers are rounded in decimal, avoiding both binary multiplication and float noise.
  const shift = 9 + Number(exponent) - fraction.length;
  const digits = BigInt(whole + fraction);
  const divisor = 10n ** BigInt(Math.max(0, -shift));
  const amount =
    shift >= 0
      ? digits * 10n ** BigInt(shift)
      : digits / divisor + ((digits % divisor) * 2n >= divisor ? 1n : 0n);
  const normalized: UsageNativeCost = { amount: String(amount), scale: 9, currency: "USD", basis };
  return isNativeCost(normalized) ? normalized : null;
}
function difference(current: string | null, previous: string | null): string | null {
  if (current === null || previous === null) return null;
  const delta = BigInt(current) - BigInt(previous);
  return delta < 0n ? null : String(delta);
}
function costDifference(current: UsageNativeCost | null, previous: UsageNativeCost | null) {
  if (!current || !previous) return null;
  if (current.currency !== previous.currency) return null;
  const delta = difference(current.amount, previous.amount);
  return delta === null ? null : { ...current, amount: delta };
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
function normalizeComponents(components: UsageComponents): UsageComponents {
  const split = [
    components.uncachedInput,
    components.cachedInput,
    components.cacheCreation,
    components.output,
  ];
  return {
    ...components,
    reasoning:
      components.reasoning !== null &&
      components.output !== null &&
      BigInt(components.reasoning) > BigInt(components.output)
        ? null
        : components.reasoning,
    inclusiveTotal:
      components.inclusiveTotal !== null &&
      split.every((part) => part !== null) &&
      split.reduce((sum, part) => sum + BigInt(part!), 0n) !== BigInt(components.inclusiveTotal)
        ? null
        : components.inclusiveTotal,
  };
}
function hasTokens(components: UsageComponents): boolean {
  return componentNames.some((key) => components[key] !== null && components[key] !== "0");
}
function unknownModel(model: string | null): UsageModelLine {
  return {
    model,
    components: {
      uncachedInput: null,
      cachedInput: null,
      cacheCreation: null,
      output: null,
      reasoning: null,
      inclusiveTotal: null,
    },
    nativeCost: null,
  };
}
function claudeModels(value: unknown): UsageModelLine[] | null {
  const models = record(value);
  if (!models) return null;
  return Object.entries(models)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([model, raw]) => {
      const usage = record(raw);
      if (!usage) return unknownModel(model);
      return {
        model,
        components: normalizeComponents({
          uncachedInput: quantity(usage.inputTokens),
          cachedInput: quantity(usage.cacheReadInputTokens),
          cacheCreation: quantity(usage.cacheCreationInputTokens),
          output: quantity(usage.outputTokens),
          reasoning: quantity(usage.thinkingTokens),
          inclusiveTotal: null,
        }),
        nativeCost: cost(usage.costUSD, text(usage.costBasis) ?? "provider-reported-estimate"),
      };
    });
}
interface ClaudeLedger {
  readonly models: UsageModelLine[] | null;
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
  if (ledger.models === null) throw new Error("Claude live model baseline is unavailable");
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
    const current = claudeLedger(envelope.modelUsage, envelope.total_cost_usd);
    const encoded = JSON.stringify(current);
    const receipt = JSON.stringify([nativeThreadId, nativeTurnId]);
    const prior = results.get(receipt);
    if (prior) {
      if (prior !== encoded)
        throw new Error("Claude repeated a result identity with changed usage");
      return [];
    }
    if (nativeSession !== null && nativeSession !== nativeThreadId) {
      ledger = current;
      nativeSession = nativeThreadId;
      results.set(receipt, encoded);
      throw new Error("Claude native session changed; its first result supplies a new baseline");
    }
    const oldModels = new Map((ledger.models ?? []).map((line) => [line.model, line]));
    const models = (current.models ?? []).map((line) => {
      const old = oldModels.get(line.model);
      return {
        ...line,
        components: normalizeComponents(
          ledger.models === null
            ? unknownModel(line.model).components
            : old
              ? subtract(line.components, old.components)
              : line.components,
        ),
        nativeCost:
          ledger.models === null
            ? null
            : old
              ? costDifference(line.nativeCost, old.nativeCost)
              : line.nativeCost,
      };
    });
    const participating = models.filter(
      (line) =>
        hasTokens(line.components) || (line.nativeCost !== null && line.nativeCost.amount !== "0"),
    );
    const nativeCost = costDifference(current.nativeCost, ledger.nativeCost);
    // A disappeared model is unknown, not zero: its next appearance cannot bridge the gap.
    ledger =
      current.models === null
        ? current
        : {
            ...current,
            models: [
              ...current.models,
              ...(ledger.models ?? [])
                .filter((old) => !current.models!.some((line) => line.model === old.model))
                .map((old) => unknownModel(old.model)),
            ],
          };
    nativeSession = nativeThreadId;
    results.set(receipt, encoded);
    if (participating.length === 0 && (nativeCost === null || nativeCost.amount === "0")) return [];
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
    resetNativeLedger: (resetId: string, retiredSessionId: string): void => {
      const prior = resets.get(resetId);
      if (prior !== undefined) {
        if (prior !== retiredSessionId)
          throw new Error("Claude repeated a reset identity with changed session");
        return;
      }
      // Native conversation_reset precedes CostLedger.reset: USD becomes zero and models empty.
      // The following native result occurs after that reset and reports its own new session id.
      resets.set(resetId, retiredSessionId);
      retiredSessions.add(retiredSessionId);
      ledger = claudeLedger({}, 0);
      nativeSession = null;
      results.clear();
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
  return normalizeComponents({
    uncachedInput: uncached !== null && uncached >= 0n ? String(uncached) : null,
    cachedInput: cached,
    cacheCreation: written,
    output: quantity(usage.outputTokens),
    reasoning: quantity(usage.reasoningOutputTokens),
    inclusiveTotal: quantity(usage.totalTokens),
  });
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
    const components = normalizeComponents(meters.slice(1).reduce(add, meters[0]!));
    if (!hasTokens(components)) return [];
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

/** OpenCode's meters: `input` excludes both cache counts and `output` excludes `reasoning`. */
function openCodeComponents(tokens: Record<string, unknown> | undefined): UsageComponents {
  const cache = record(tokens?.cache);
  const output = quantity(tokens?.output),
    reasoning = quantity(tokens?.reasoning);
  return normalizeComponents({
    uncachedInput: quantity(tokens?.input),
    cachedInput: quantity(cache?.read),
    cacheCreation: quantity(cache?.write),
    output:
      output !== null && reasoning !== null ? String(BigInt(output) + BigInt(reasoning)) : null,
    reasoning,
    inclusiveTotal: quantity(tokens?.total),
  });
}
const addCost = (a: UsageNativeCost | null, b: UsageNativeCost | null) =>
  a === null ? b : b === null ? a : { ...a, amount: String(BigInt(a.amount) + BigInt(b.amount)) };
interface OpenCodeStep {
  readonly messageId: string;
  readonly components: UsageComponents;
  readonly nativeCost: UsageNativeCost | null;
}
/**
 * Each step-finish part is one model call's exact meter; an assistant message's own `tokens`
 * hold only its last step. Steps of the session and its subagents count once, at the turn's end;
 * their cost so far is read on the way (`running`), the same sum the end's fact carries.
 */
export function makeOpenCodeTurnUsage() {
  const modelByMessage = new Map<string, string>();
  const pending = new Map<string, OpenCodeStep>();
  const counted = new Set<string>();
  // The running cost last read, so each read tells only a change; summed again only after a step.
  let told: string | undefined;
  let stepped = false;
  return {
    observe: (event: unknown): void => {
      const envelope = record(event);
      const properties = record(envelope?.properties);
      if (envelope?.type === "message.updated") {
        const info = record(properties?.info);
        const id = text(info?.id),
          provider = text(info?.providerID),
          model = text(info?.modelID);
        if (info?.role === "assistant" && id && provider && model)
          modelByMessage.set(id, `${provider}/${model}`);
        return;
      }
      if (envelope?.type !== "message.part.updated") return;
      const part = record(properties?.part);
      const id = text(part?.id),
        messageId = text(part?.messageID);
      if (part?.type !== "step-finish" || !id || !messageId || counted.has(id)) return;
      const charge = cost(part.cost, "provider-reported-estimate");
      stepped = true;
      pending.set(id, {
        messageId,
        components: openCodeComponents(record(part.tokens)),
        // OpenCode reports 0 for a model it has no price for: unknown, never free.
        nativeCost: charge === null || charge.amount === "0" ? null : charge,
      });
    },
    /** The turn's cost so far, when its steps moved it since the last read; else nothing. */
    running: (): UsageNativeCost | undefined => {
      // Every event of the session passes here; only a finished step can move the sum.
      if (!stepped) return undefined;
      stepped = false;
      const total = [...pending.values()].reduce<UsageNativeCost | null>(
        (sum, step) => addCost(sum, step.nativeCost),
        null,
      );
      if (total === null || total.amount === told) return undefined;
      told = total.amount;
      return total;
    },
    complete: (
      nativeThreadId: string,
      nativeTurnId: string,
    ): ReadonlyArray<TurnUsageCompletedPayload> => {
      const lines = new Map<string | null, UsageModelLine>();
      for (const [id, step] of pending) {
        counted.add(id);
        const model = modelByMessage.get(step.messageId) ?? null;
        const line = lines.get(model);
        lines.set(
          model,
          line
            ? {
                model,
                components: add(line.components, step.components),
                nativeCost: addCost(line.nativeCost, step.nativeCost),
              }
            : { model, components: step.components, nativeCost: step.nativeCost },
        );
      }
      pending.clear();
      told = undefined;
      const models = [...lines.values()]
        .map((line) => ({ ...line, components: normalizeComponents(line.components) }))
        .filter((line) => hasTokens(line.components))
        .sort((a, b) => ((a.model ?? "") < (b.model ?? "") ? -1 : 1));
      if (models.length === 0) return [];
      return [
        completedUsage({
          nativeThreadId,
          nativeTurnId,
          models,
          nativeCost: models.reduce<UsageNativeCost | null>(
            (total, line) => addCost(total, line.nativeCost),
            null,
          ),
          parentId: null,
        }),
      ];
    },
  };
}
