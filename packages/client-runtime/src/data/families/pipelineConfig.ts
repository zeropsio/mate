import { type FamilySpec } from "./spec.ts";

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
function readPipelineConfig(answer: unknown): PipelineConfigValue | null {
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
    refreshOn: ({ ownerId }, row, previous) => {
      if (row.family !== "version" || row.id !== ownerId) return false;
      const held = previous.fact("pipelineConfig", ownerId);
      return held.kind !== "known" || held.value.config === null;
    },
  },
};
