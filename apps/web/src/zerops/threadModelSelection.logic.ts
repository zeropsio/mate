import type { ModelSelection, ProviderInstanceId } from "@t3tools/contracts";

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
}): ModelSelection | null {
  if (input.threadChanged) return null;
  const pick = draftModelSelection(input.draft, input.threadSelection);
  if (pick === null) return null;
  return modelSelectionKey(pick) === modelSelectionKey(input.threadSelection) ? null : pick;
}
