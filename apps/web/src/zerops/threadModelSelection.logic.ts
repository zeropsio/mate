import type { ModelCapabilities, ModelSelection, ProviderInstanceId } from "@t3tools/contracts";
import {
  buildExplicitProviderOptionSelectionsFromDescriptors,
  getProviderOptionDescriptors,
} from "@t3tools/shared/model";

/**
 * A thread has one model selection, held on the server. A tab's draft only
 * carries a pick until the thread takes it: the composer shows and sends the
 * thread's selection, never a per-tab copy.
 */

/** A selection by value: option order and absent against empty options don't count. */
export function modelSelectionKey(selection: ModelSelection | null | undefined): string | null {
  if (!selection) return null;
  const options = (selection.options ?? [])
    .map((option) => [option.id, option.value] as const)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([selection.instanceId, selection.model, options]);
}

export interface DraftModelSelection {
  readonly modelSelectionByProvider?:
    | Partial<Record<ProviderInstanceId, ModelSelection>>
    | undefined;
  readonly activeProvider?: ProviderInstanceId | null | undefined;
}

/** The pick a draft holds for the instance it shows, if any. */
export function draftModelSelection(
  draft: DraftModelSelection | null | undefined,
  threadSelection: ModelSelection,
): ModelSelection | null {
  const instanceId = draft?.activeProvider ?? threadSelection.instanceId;
  return draft?.modelSelectionByProvider?.[instanceId] ?? null;
}

/**
 * What a tab writes to its thread after its draft changed: the draft's pick
 * when the person made one that differs from the thread's; nothing when the
 * thread changed under the tab (the thread wins) or the pick is the thread's.
 */
export function selectionToWrite(input: {
  readonly threadChanged: boolean;
  readonly draft: DraftModelSelection | null | undefined;
  readonly threadSelection: ModelSelection;
  readonly capabilitiesFor?: ((selection: ModelSelection) => ModelCapabilities | null) | undefined;
}): ModelSelection | null {
  if (input.threadChanged) return null;
  const drafted = draftModelSelection(input.draft, input.threadSelection);
  if (drafted === null) return null;
  const pick = withThreadOptions(drafted, input.threadSelection, input.capabilitiesFor);
  return modelSelectionKey(pick) === modelSelectionKey(input.threadSelection) ? null : pick;
}

/**
 * A model picked without options (the model picker) keeps the thread's
 * options the new model takes, so a switch never resets effort and the rest.
 */
export function withThreadOptions(
  pick: ModelSelection,
  threadSelection: ModelSelection,
  capabilitiesFor: ((selection: ModelSelection) => ModelCapabilities | null) | undefined,
): ModelSelection {
  if (pick.options !== undefined || pick.instanceId !== threadSelection.instanceId) return pick;
  const caps = capabilitiesFor?.(pick);
  const kept = caps
    ? buildExplicitProviderOptionSelectionsFromDescriptors(
        getProviderOptionDescriptors({ caps, selections: threadSelection.options }),
        threadSelection.options,
      )
    : undefined;
  return kept ? { ...pick, options: kept } : pick;
}

/** A draft's model picks by value, whatever thread they are for. */
export function draftPicksKey(draft: DraftModelSelection | null | undefined): string {
  const picks = Object.entries(draft?.modelSelectionByProvider ?? {})
    .map(([instanceId, selection]) => [instanceId, modelSelectionKey(selection)] as const)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return JSON.stringify([draft?.activeProvider ?? null, picks]);
}
