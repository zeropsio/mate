import type { ModelSelection, ServerProviderModel } from "@t3tools/contracts";
import {
  codexModelFamily,
  getModelSelectionOptionDescriptors,
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
} from "@t3tools/shared/model";

export function getCodexServiceTierOptionValue(
  modelSelection: ModelSelection | null | undefined,
): string | undefined {
  return (
    getModelSelectionStringOptionValue(modelSelection, "serviceTier") ??
    (getModelSelectionBooleanOptionValue(modelSelection, "fastMode") === true ? "fast" : undefined)
  );
}

export function getCodexContextWindowOptionValue(
  modelSelection: ModelSelection | null | undefined,
  models: ReadonlyArray<ServerProviderModel>,
): number | undefined {
  if (!modelSelection) return undefined;
  const model =
    models.find((model) => model.slug === modelSelection.model) ??
    models.find(
      (model) =>
        !model.isCustom && codexModelFamily(model.slug) === codexModelFamily(modelSelection.model),
    );
  const descriptor = getModelSelectionOptionDescriptors(modelSelection, model?.capabilities).find(
    (option) => option.id === "contextWindow",
  );
  if (descriptor?.type !== "select") return undefined;
  const value = descriptor.currentValue;
  if (!value || !descriptor.options.some((option) => option.id === value)) return undefined;
  const tokens = Number(value);
  return Number.isSafeInteger(tokens) && tokens > 0 ? tokens : undefined;
}
