import type { UsageModelPriceOverride } from "@t3tools/contracts";

export const USAGE_PRICE_FIELDS = [
  { key: "inputCostPerMillionTokens", label: "Input", optional: false },
  { key: "outputCostPerMillionTokens", label: "Output", optional: false },
  { key: "cacheReadCostPerMillionTokens", label: "Cache read", optional: true },
  { key: "cacheWriteCostPerMillionTokens", label: "Cache write", optional: true },
] as const;

export type UsagePriceForm = { model: string } & Record<
  (typeof USAGE_PRICE_FIELDS)[number]["key"],
  string
>;

export function usagePriceForm(model = "", price?: UsageModelPriceOverride): UsagePriceForm {
  return {
    model,
    inputCostPerMillionTokens: price?.inputCostPerMillionTokens.toString() ?? "",
    outputCostPerMillionTokens: price?.outputCostPerMillionTokens.toString() ?? "",
    cacheReadCostPerMillionTokens: price?.cacheReadCostPerMillionTokens?.toString() ?? "",
    cacheWriteCostPerMillionTokens: price?.cacheWriteCostPerMillionTokens?.toString() ?? "",
  };
}

/** Blank cache prices use the input rate; explicit zero means free. */
export function parseUsagePriceForm(
  form: UsagePriceForm,
): { model: string; price: UsageModelPriceOverride } | null {
  const model = form.model.trim();
  if (model.length === 0) return null;
  const rates: Partial<Record<(typeof USAGE_PRICE_FIELDS)[number]["key"], number>> = {};
  for (const field of USAGE_PRICE_FIELDS) {
    const raw = form[field.key].trim();
    if (raw === "") {
      if (field.optional) continue;
      return null;
    }
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)) return null;
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return null;
    rates[field.key] = value;
  }
  if (
    rates.inputCostPerMillionTokens === undefined ||
    rates.outputCostPerMillionTokens === undefined
  ) {
    return null;
  }
  return {
    model,
    price: {
      inputCostPerMillionTokens: rates.inputCostPerMillionTokens,
      outputCostPerMillionTokens: rates.outputCostPerMillionTokens,
      ...(rates.cacheReadCostPerMillionTokens === undefined
        ? {}
        : { cacheReadCostPerMillionTokens: rates.cacheReadCostPerMillionTokens }),
      ...(rates.cacheWriteCostPerMillionTokens === undefined
        ? {}
        : { cacheWriteCostPerMillionTokens: rates.cacheWriteCostPerMillionTokens }),
    },
  };
}

export interface UsageAlias {
  readonly model: string;
  readonly target: string;
}

/** A "counts as" mapping from its two fields, or `null` until it names two different models. */
export function parseUsageAliasForm(form: {
  readonly model: string;
  readonly target: string;
}): UsageAlias | null {
  const model = form.model.trim();
  const target = form.target.trim();
  if (model === "" || target === "" || model === target) return null;
  return { model, target };
}

const PREVIEW_SUFFIX = /-preview(?:-[\w.-]+)?$/u;

/**
 * Preview model IDs whose released model also appears in usage, as mappings
 * to offer: a preview counted under its released name joins its row and price.
 */
export function previewAliasSuggestions(
  models: readonly string[],
  aliases: Readonly<Record<string, string>>,
): readonly UsageAlias[] {
  const known = new Set(models);
  return models.flatMap((model) => {
    if (Object.hasOwn(aliases, model)) return [];
    const target = model.replace(PREVIEW_SUFFIX, "");
    return target !== model && known.has(target) ? [{ model, target }] : [];
  });
}
