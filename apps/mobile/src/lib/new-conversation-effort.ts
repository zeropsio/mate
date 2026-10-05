/**
 * The phone's side of D10: a new conversation shows and sends Extra High
 * (`@t3tools/shared/zeropsEffort`), one that ran keeps what it has, and a
 * person's own pick always wins.
 */
import type { ModelSelection, ServerProvider } from "@t3tools/contracts";
import { selectionWithPreferredEffort } from "@t3tools/shared/zeropsEffort";

export function newConversationSelection<Selection extends ModelSelection | null>(input: {
  readonly isNew: boolean;
  readonly providers: ReadonlyArray<ServerProvider> | undefined;
  readonly selection: Selection;
}): Selection {
  if (!input.isNew || input.selection === null) return input.selection;
  return selectionWithPreferredEffort(input.providers ?? [], input.selection) as Selection;
}
