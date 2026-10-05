/**
 * What an operation kind declares about itself: its intent (added to `OperationIntents`), which
 * owner executes it, and when the scope it changes shows it — so the coordinator and the progress
 * projection never name a kind. `operations/kinds.ts` lists them.
 *
 * @module data/operations/kind
 */
import type { Authority, OperationIntent, OperationIntents } from "../model.ts";
import type { ProjectionReads } from "../store.ts";

export type IntentOf<Kind extends keyof OperationIntents & string> = Extract<
  OperationIntent,
  { readonly kind: Kind }
>;

export interface OperationKind<Kind extends keyof OperationIntents & string> {
  readonly kind: Kind;
  readonly executor: Authority;
  /** Whether the scope the intent changes shows it now: its reflection, never its outcome. */
  readonly reflected: (read: ProjectionReads, intent: IntentOf<Kind>) => boolean;
}

export type AnyOperationKind = {
  readonly [Kind in keyof OperationIntents & string]: OperationKind<Kind>;
}[keyof OperationIntents & string];
