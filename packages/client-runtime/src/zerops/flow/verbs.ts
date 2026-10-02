/**
 * What a flow verb changed, so its settlement re-reads that and nothing else
 * (DESIGN §4.7 "Verbs"): the group repo's tags — never another group, and
 * never a whole pass. A change merges and closes in HQ, which moves nothing of
 * Gitea's, and comes back down HQ's stream: nothing is read again for it.
 *
 * @module flow/verbs
 */
import type { FlowVerb } from "../projectFlow.ts";

/** One part of a group's Gitea half: the group repo's tags. */
export type ForgeScope = { readonly kind: "tags" };

export interface FlowInvalidation {
  readonly forge: ForgeScope | null;
}

export function flowVerbInvalidations(verb: FlowVerb): FlowInvalidation {
  switch (verb.kind) {
    case "merge":
    case "close":
      return { forge: null };
    case "release":
    case "roll-back":
      return { forge: { kind: "tags" } };
  }
}
