/**
 * What a pipeline ran, which its read by id leaves out (`GET /app-version/{id}` returns neither
 * its name nor its zerops.yaml; measured 2026-11-11): the organization's version search for that
 * one id (`POST /app-version/search`, `clientId` and `id`), which Zerops answers only within an
 * organization. Neither ever changes: read once while the pipeline dialog holds it.
 *
 * @module data/families/pipelineConfig
 */
import type { ScopeKey } from "../model.ts";
import { scopeOf, type FamilySpec } from "./spec.ts";

export interface PipelineConfigValue {
  /** The name the deploy was given, e.g. a zcli version name or a Mate's `<repo> <sha>`. */
  readonly name: string | null;
  /** The zerops.yaml the pipeline ran, as Zerops kept it. */
  readonly config: string | null;
  /** The zerops.yaml setup it ran. */
  readonly setup: string | null;
}

declare module "../model.ts" {
  interface FamilyValues {
    readonly pipelineConfig: PipelineConfigValue;
  }
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

/** The one version the search answers; `null` where it answers none. */
export function readPipelineConfig(answer: unknown): PipelineConfigValue | null {
  if (typeof answer !== "object" || answer === null) return null;
  const items = (answer as { readonly items?: unknown }).items;
  const row: unknown = Array.isArray(items) ? items[0] : undefined;
  if (typeof row !== "object" || row === null) return null;
  const fields = row as Record<string, unknown>;
  return {
    name: text(fields.name),
    config: text(fields.configContent),
    setup: text(fields.zeropsYamlSetup),
  };
}

export const pipelineConfigFamily: FamilySpec<"pipelineConfig"> = {
  family: "pipelineConfig",
  authority: "zerops",
  scope: { source: "zerops", suffix: "pipeline-config", leaving: "removed", demand: "detail" },
  sampled: {
    path: () => "/app-version/search",
    search: ({ orgId, ownerId }) => ({
      search: [
        { name: "clientId", operator: "eq", value: orgId },
        { name: "id", operator: "eq", value: ownerId },
      ],
      limit: 1,
    }),
    decode: readPipelineConfig,
    freshMs: null,
  },
};

export const pipelineConfigScope = (orgId: string, versionId: string): ScopeKey =>
  scopeOf(pipelineConfigFamily, orgId, versionId);
