import { useComposerDraftStore } from "~/composerDraftStore";
import { type MateDraftOf, mateRowDraftQuote } from "./SidebarMateRow.logic";

/** A draft's words in its Mate's row, read as they are typed: a key draws these and nothing around them. */
export function MateDraftWords({ of }: { readonly of: MateDraftOf }) {
  return useComposerDraftStore((state) => mateRowDraftQuote(state, of)) ?? null;
}
