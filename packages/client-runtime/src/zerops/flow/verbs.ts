/**
 * What a flow verb changed, so its settlement re-reads that and nothing else
 * (DESIGN §4.7 "Verbs"). A merge used to bump one account-wide generation that
 * blanked every stop in the account for a whole pass.
 *
 * @module flow/verbs
 */
import type { FlowVerb } from "../projectFlow.ts";

/** One part of a group's Gitea half. */
export type ForgeScope =
  | { readonly kind: "repository"; readonly repository: string }
  | { readonly kind: "tags" };

export interface FlowInvalidation {
  readonly forge: ForgeScope | null;
  /** The group's deploy half, whose `main` heads a merge moves. */
  readonly deploys: "group" | null;
}

export function flowVerbInvalidations(verb: FlowVerb): FlowInvalidation {
  switch (verb.kind) {
    case "merge":
      return { forge: { kind: "repository", repository: verb.repository }, deploys: "group" };
    case "open":
      return { forge: { kind: "repository", repository: verb.repository }, deploys: null };
    case "release":
    case "roll-back":
      return { forge: { kind: "tags" }, deploys: null };
  }
}
