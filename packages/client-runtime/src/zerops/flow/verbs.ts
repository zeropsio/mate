/**
 * What a flow verb changed, so its settlement re-reads that and nothing else
 * (DESIGN §4.7 "Verbs"): one repository, one `main` head, or the group repo's
 * tags — never another group, and never a whole pass.
 *
 * @module flow/verbs
 */
import type { FlowVerb } from "../projectFlow.ts";

/** One part of a group's Gitea half. */
export type ForgeScope =
  | { readonly kind: "repository"; readonly repository: string }
  | { readonly kind: "tags" };

/** One part of a group's deploy half: the head of one repository's `main`, which a merge moves. */
export type DeployScope = { readonly kind: "main-head"; readonly repository: string };

export interface FlowInvalidation {
  readonly forge: ForgeScope | null;
  readonly deploys: DeployScope | null;
}

export function flowVerbInvalidations(verb: FlowVerb): FlowInvalidation {
  switch (verb.kind) {
    case "merge":
      return {
        forge: { kind: "repository", repository: verb.repository },
        deploys: { kind: "main-head", repository: verb.repository },
      };
    case "open":
      return { forge: { kind: "repository", repository: verb.repository }, deploys: null };
    case "release":
    case "roll-back":
      return { forge: { kind: "tags" }, deploys: null };
  }
}
