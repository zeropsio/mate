/**
 * claudeProvider — the owned, typed "which model/effort does this Claude
 * turn use" capability. `textGeneration/ClaudeTextGeneration.ts` resolves a
 * `ModelSelection` into the Claude CLI's `--model`/`--effort` flags via
 * catalog/effort logic that `provider/ClaudeModelCatalog.ts` owns (the
 * manifest-driven model catalog — capabilities, effort maps and version
 * compatibility resolved from `model-manifest.json`, not hardcoded).
 *
 * This module wraps the `ClaudeModelCatalog` type plus exactly the functions
 * `ClaudeTextGeneration.ts` calls. A port that changes the effort-
 * normalization table or the model catalog lookup fails
 * `claudeProvider.test.ts`, not the `claude -p` spawn call.
 *
 * @module claudeProvider
 */
import type { ModelCapabilities, ModelSelection } from "@t3tools/contracts";

import {
  BUNDLED_CLAUDE_MODEL_CATALOG as driverBundledClaudeModelCatalog,
  type ClaudeModelCatalog as DriverClaudeModelCatalog,
  getClaudeCatalogModelCapabilities as driverGetClaudeCatalogModelCapabilities,
  isClaudeCatalogUltracodeEffort as driverIsClaudeCatalogUltracodeEffort,
  normalizeClaudeCatalogEffort as driverNormalizeClaudeCatalogEffort,
  resolveClaudeCatalogApiModelId as driverResolveClaudeCatalogApiModelId,
  resolveClaudeCatalogEffort as driverResolveClaudeCatalogEffort,
  resolveClaudeModelSlug as driverResolveClaudeModelSlug,
  scopeClaudeModelCatalog as driverScopeClaudeModelCatalog,
} from "../provider/ClaudeModelCatalog.ts";

/** The resolved, manifest-driven Claude model catalog. Opaque to callers outside the ported zone. */
export type ClaudeModelCatalog = DriverClaudeModelCatalog;

/** The bundled (offline-fallback) catalog, for tests and callers with no live `ModelManifest` refresh. */
export const BUNDLED_CLAUDE_MODEL_CATALOG: ClaudeModelCatalog = driverBundledClaudeModelCatalog;

/** Keeps custom model aliases opaque while preserving canonical built-in models and capabilities. */
export function scopeClaudeModelCatalog(
  catalog: ClaudeModelCatalog,
  customModels: ReadonlyArray<string>,
): ClaudeModelCatalog {
  return driverScopeClaudeModelCatalog(catalog, customModels);
}

/** Resolves a slug or alias to its canonical catalog slug (unchanged when not found in the catalog). */
export function resolveClaudeModelSlug(catalog: ClaudeModelCatalog, slugOrAlias: string): string {
  return driverResolveClaudeModelSlug(catalog, slugOrAlias);
}

/** Looks up the catalog entry's capabilities, or a safe default for an unknown/custom model. */
export function getClaudeCatalogModelCapabilities(
  catalog: ClaudeModelCatalog,
  slugOrAlias: string | null | undefined,
): ModelCapabilities {
  return driverGetClaudeCatalogModelCapabilities(catalog, slugOrAlias);
}

/** Resolves the effective effort value for a model from the catalog's capabilities and a raw selection. */
export function resolveClaudeCatalogEffort(
  catalog: ClaudeModelCatalog,
  model: string | null | undefined,
  raw: string | null | undefined,
): string | undefined {
  return driverResolveClaudeCatalogEffort(catalog, model, raw);
}

/**
 * Normalizes a resolved effort value into one valid for the Claude CLI's
 * `--effort` flag, via the catalog entry's own effort remap (e.g.
 * `ultracode` → `xhigh`, or an older model's `xhigh` → `max`).
 */
export function normalizeClaudeCatalogEffort(
  catalog: ClaudeModelCatalog,
  effort: string | null | undefined,
  model: string | null | undefined,
): string | undefined {
  return driverNormalizeClaudeCatalogEffort(catalog, effort, model);
}

/** True when the resolved effort is the `ultracode` setting (xhigh effort + multi-agent orchestration). */
export function isClaudeCatalogUltracodeEffort(effort: string | null | undefined): boolean {
  return driverIsClaudeCatalogUltracodeEffort(effort);
}

/** Resolves the `--model` value: the catalog slug, or the slug plus the runtime's model-id suffix for the selected option (e.g. the `[1m]` context window suffix). */
export function resolveClaudeCatalogApiModelId(
  catalog: ClaudeModelCatalog,
  modelSelection: ModelSelection,
): string {
  return driverResolveClaudeCatalogApiModelId(catalog, modelSelection);
}
