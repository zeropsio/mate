import type { ModelUsage } from "@anthropic-ai/claude-agent-sdk";
import {
  type ClaudeModelCatalog,
  resolveClaudeCatalogContextWindowTokens,
} from "../ClaudeModelCatalog.ts";
import type { ModelSelection, ThreadTokenUsageSnapshot } from "@t3tools/contracts";
import type { ClaudeSessionContext } from "./ClaudeSessionState.ts";

/**
 * The window to report when nothing here knows which model the conversation
 * runs: no selection reached the session, so there is no api model id to
 * match on either.
 *
 * The answer is in the numerator. `modelUsage` covers "the main loop, Task
 * subagents, sidechains, and internal calls such as compaction" (the SDK's
 * own words), but the conversation's own model is the one the turn's tokens
 * are on — a subagent or an internal call (a title, a classifier) touches a
 * fraction of them. Taking that entry's window is not a heuristic so much as
 * the fix for what went wrong in the first place: a numerator from one model
 * measured against a denominator from another.
 *
 * Nothing said how busy each model was — a crash result carries zeroed usage
 * — leaves every entry tied, and then the narrowest is taken: understating
 * the room left is the safe way for a gauge to be wrong. Zeroed windows are
 * not windows and are skipped.
 */
export function claudeConversationContextWindowFromModelUsage(
  modelUsage: Record<string, ModelUsage> | undefined,
): number | undefined {
  if (!modelUsage) return undefined;

  let chosen: number | undefined;
  let busiest = -1;
  for (const usage of Object.values(modelUsage)) {
    const contextWindow = finitePositiveInteger(usage.contextWindow);
    if (contextWindow === undefined) continue;
    const tokens =
      (finiteNonNegativeInteger(usage.inputTokens) ?? 0) +
      (finiteNonNegativeInteger(usage.cacheReadInputTokens) ?? 0) +
      (finiteNonNegativeInteger(usage.cacheCreationInputTokens) ?? 0);
    if (tokens > busiest || (tokens === busiest && contextWindow < (chosen ?? Infinity))) {
      busiest = tokens;
      chosen = contextWindow;
    }
  }

  return chosen;
}

/**
 * The window of the model this conversation runs on, out of a turn's report.
 *
 * `modelUsage` carries every model the turn touched — a Task's subagent, a
 * background helper — so the largest window in it is not the conversation's:
 * one subagent on a million-token model put `1m` under a conversation the
 * person had set to 200k (`verified.md`, 2026-09-19). The session's own model
 * is the one to read, matched by the id the query was started with, allowing
 * for the SDK naming it more fully (`claude-sonnet-5` →
 * `claude-sonnet-5-20260901`) and for the `[1m]` marker, which selects a
 * window rather than naming a model.
 */
export function claudeContextWindowForModel(
  modelUsage: Record<string, ModelUsage> | undefined,
  apiModelId: string | undefined,
): number | undefined {
  if (!modelUsage || apiModelId === undefined) return undefined;
  const wanted = apiModelId.replace(/\[[^\]]*\]$/, "");
  const names = Object.keys(modelUsage);
  const name =
    names.find((candidate) => candidate === wanted) ??
    names.find((candidate) => candidate.startsWith(`${wanted}-`)) ??
    names.find((candidate) => candidate.includes(wanted));
  return name === undefined ? undefined : finitePositiveInteger(modelUsage[name]?.contextWindow);
}

export function selectedClaudeContextWindow(
  catalog: ClaudeModelCatalog,
  modelSelection: ModelSelection | undefined,
): number | undefined {
  return resolveClaudeCatalogContextWindowTokens(catalog, modelSelection);
}

export function finiteNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined;
}

function finitePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;
}

export function claudeUsageInputTokens(usage: Record<string, unknown>): number {
  return (
    (finiteNonNegativeInteger(usage.input_tokens) ?? 0) +
    (finiteNonNegativeInteger(usage.cache_creation_input_tokens) ?? 0) +
    (finiteNonNegativeInteger(usage.cache_read_input_tokens) ?? 0)
  );
}

export function claudeUsageOutputTokens(usage: Record<string, unknown>): number {
  return finiteNonNegativeInteger(usage.output_tokens) ?? 0;
}

export function lastClaudeUsageIteration(
  value: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const iterations = Array.isArray(value.iterations) ? value.iterations : [];
  return iterations.findLast(
    (iteration): iteration is Record<string, unknown> =>
      iteration !== null && typeof iteration === "object" && !Array.isArray(iteration),
  );
}

export function claudeTotalProcessedTokens(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const usage = value as Record<string, unknown>;
  const explicitTotal = finiteNonNegativeInteger(usage.total_tokens);
  if (explicitTotal !== undefined && explicitTotal > 0) {
    return explicitTotal;
  }

  const total = claudeUsageInputTokens(usage) + claudeUsageOutputTokens(usage);
  return total > 0 ? total : undefined;
}

function makeClaudeTokenUsageSnapshot(input: {
  readonly activeTokens: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly contextWindow?: number;
  readonly totalProcessedTokens?: number;
  readonly lastUsedTokens?: number;
  readonly compactsAutomatically?: boolean;
  readonly autoCompactThreshold?: number;
}): ThreadTokenUsageSnapshot | undefined {
  const activeTokens = finiteNonNegativeInteger(input.activeTokens);
  if (activeTokens === undefined || activeTokens <= 0) {
    return undefined;
  }

  const maxTokens = finitePositiveInteger(input.contextWindow);
  const usedTokens = maxTokens !== undefined ? Math.min(activeTokens, maxTokens) : activeTokens;
  const lastUsedTokens =
    finiteNonNegativeInteger(input.lastUsedTokens) ??
    (maxTokens !== undefined ? Math.min(activeTokens, maxTokens) : activeTokens);
  const totalProcessedTokens = finiteNonNegativeInteger(input.totalProcessedTokens);
  const inputTokens = finiteNonNegativeInteger(input.inputTokens);
  const outputTokens = finiteNonNegativeInteger(input.outputTokens);

  return {
    usedTokens,
    lastUsedTokens,
    ...(totalProcessedTokens !== undefined && totalProcessedTokens > usedTokens
      ? { totalProcessedTokens }
      : {}),
    ...(inputTokens !== undefined && inputTokens > 0 ? { inputTokens } : {}),
    ...(outputTokens !== undefined && outputTokens > 0 ? { outputTokens } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {}),
    ...(input.compactsAutomatically !== undefined
      ? { compactsAutomatically: input.compactsAutomatically }
      : {}),
    ...(input.autoCompactThreshold !== undefined
      ? { autoCompactThreshold: input.autoCompactThreshold }
      : {}),
  };
}

export function normalizeClaudeActiveTokenUsage(
  value: unknown,
  contextWindow?: number,
  totalProcessedTokens?: number,
): ThreadTokenUsageSnapshot | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const usage = value as Record<string, unknown>;
  const activeUsage = lastClaudeUsageIteration(usage) ?? usage;
  const inputTokens = claudeUsageInputTokens(activeUsage);
  const outputTokens = claudeUsageOutputTokens(activeUsage);
  const activeTokens = claudeTotalProcessedTokens(activeUsage) ?? inputTokens + outputTokens;
  if (activeTokens <= 0) {
    return undefined;
  }

  return makeClaudeTokenUsageSnapshot({
    activeTokens,
    inputTokens,
    outputTokens,
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(totalProcessedTokens !== undefined ? { totalProcessedTokens } : {}),
  });
}

export function compactBoundaryTokenUsageSnapshot(
  message: Record<string, unknown>,
  contextWindow?: number,
  totalProcessedTokens?: number,
): ThreadTokenUsageSnapshot | undefined {
  const metadata = message.compact_metadata;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }

  const compactMetadata = metadata as Record<string, unknown>;
  const postTokens = finiteNonNegativeInteger(compactMetadata.post_tokens);
  if (postTokens === undefined || postTokens <= 0) {
    return undefined;
  }

  const preTokens = finiteNonNegativeInteger(compactMetadata.pre_tokens);
  const snapshot = makeClaudeTokenUsageSnapshot({
    activeTokens: postTokens,
    ...(preTokens !== undefined ? { lastUsedTokens: preTokens } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(totalProcessedTokens !== undefined ? { totalProcessedTokens } : {}),
  });
  if (snapshot === undefined || preTokens !== undefined) {
    return snapshot;
  }
  const { lastUsedTokens: _lastUsedTokens, ...snapshotWithoutBeforeTokens } = snapshot;
  return snapshotWithoutBeforeTokens;
}

export function normalizeClaudeTaskProgressTokenUsage(
  value: unknown,
  context: ClaudeSessionContext,
): ThreadTokenUsageSnapshot | undefined {
  const totalTokens = claudeTotalProcessedTokens(value);
  if (totalTokens === undefined || totalTokens <= 0) {
    return undefined;
  }

  const lastUsedTokens = context.lastKnownTokenUsage?.usedTokens;
  const activeTokens =
    lastUsedTokens !== undefined ? Math.max(totalTokens, lastUsedTokens) : totalTokens;
  if (lastUsedTokens !== undefined && activeTokens === lastUsedTokens) {
    return undefined;
  }

  const usage = value as Record<string, unknown>;
  const snapshot = makeClaudeTokenUsageSnapshot({
    activeTokens,
    ...(context.lastKnownContextWindow !== undefined
      ? { contextWindow: context.lastKnownContextWindow }
      : {}),
    totalProcessedTokens: Math.max(
      totalTokens,
      context.lastKnownTotalProcessedTokens ?? totalTokens,
    ),
  });
  if (!snapshot) {
    return undefined;
  }

  const toolUses = finiteNonNegativeInteger(usage.tool_uses);
  const durationMs = finiteNonNegativeInteger(usage.duration_ms);
  return {
    ...snapshot,
    ...(toolUses !== undefined ? { toolUses } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
  };
}
