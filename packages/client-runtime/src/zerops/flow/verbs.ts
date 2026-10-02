/**
 * What a flow verb changed, so its settlement re-reads that and nothing else
 * (DESIGN §4.7 "Verbs"): an application's releases — never another
 * application's. A release and a rollback are made in HQ, whose stream does
 * not carry them; a change merges and closes in HQ, and a deploy is asked
 * again there, and each comes back down HQ's stream: nothing is read again
 * for it.
 *
 * @module flow/verbs
 */
import type { FlowVerb } from "../projectFlow.ts";

export interface FlowInvalidation {
  /** Whether the application's releases are read again. */
  readonly releases: boolean;
}

export function flowVerbInvalidations(verb: FlowVerb): FlowInvalidation {
  switch (verb.kind) {
    case "merge":
    case "close":
    case "redeploy":
      return { releases: false };
    case "release":
    case "roll-back":
      return { releases: true };
  }
}
