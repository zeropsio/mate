/**
 * What an operation kind declares about itself: its intent (added to `OperationIntents`), which
 * owner executes it, and when the scope it changes shows it — so the coordinator and the progress
 * projection never name a kind. `operations/kinds.ts` lists them.
 *
 * @module data/operations/kind
 */
import type {
  Authority,
  OperationIntent,
  OperationIntents,
  OperationReceipt,
  OperationResult,
  OperationResults,
} from "../model.ts";
import type { DetailDemand } from "../demand.ts";
import type { ProjectionReads } from "../store.ts";

export type IntentOf<Kind extends keyof OperationIntents & string> = Extract<
  OperationIntent,
  { readonly kind: Kind }
>;

export interface OperationKind<Kind extends keyof OperationIntents & string> {
  readonly kind: Kind;
  readonly executor: Authority;
  /**
   * Whether the scope the intent changes shows it now — read with the owner's receipt, whose
   * handles (a Zerops process id) name what to look for: its reflection, never its outcome.
   */
  readonly reflected: (
    read: ProjectionReads,
    intent: IntentOf<Kind>,
    receipt: OperationReceipt,
  ) => boolean;
  /**
   * Where the owner's own facts say how an accepted operation ended (its process row going
   * terminal), how they say it; `null` while they do not. Read whenever those facts change, never
   * on a clock. Without it, only the owner's receipt ends the operation.
   */
  readonly settledBy?: (
    read: ProjectionReads,
    intent: IntentOf<Kind>,
    receipt: OperationReceipt,
  ) => Settlement | null;
  /**
   * The detail that holds the accepted operation's handle (its project's process history): held as
   * a standing demand until the operation settles, so an end that came while the account was away
   * is read in the detail's next baseline.
   */
  readonly observedIn?: (intent: IntentOf<Kind>, receipt: OperationReceipt) => DetailDemand | null;
  /**
   * For an owner that keeps no request ids (Zerops, a Mate): the handles in its facts that would
   * show this intent's effect (the processes running for the service). After a lost answer, the
   * coordinator adopts exactly one that was absent at the send and no other operation holds.
   *
   * `null` where the owner's facts cannot say yet (its listing not wholly read): what they show
   * then could have been there before, so nothing is adopted.
   */
  readonly effectHandles?: (
    read: ProjectionReads,
    intent: IntentOf<Kind>,
  ) => ReadonlyArray<string> | null;
  /**
   * Where the kind declares a result: the one an adopted effect handle stands for (the project id
   * a lost create answered), so a lost answer leaves its caller what a receipt would have.
   */
  readonly adoptedResult?: (
    handle: string,
  ) => Kind extends keyof OperationResults ? OperationResults[Kind] : never;
}

export type Settlement =
  | { readonly kind: "succeeded" }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * A kind as the registry holds it, whatever its intent: every `OperationKind` is one, so the
 * registry and its lookups type-check with no kind registered yet.
 */
export interface RegisteredOperationKind {
  readonly kind: string;
  readonly executor: Authority;
  // Methods, not properties: each kind narrows the intent it is called with to its own.
  reflected(read: ProjectionReads, intent: OperationIntent, receipt: OperationReceipt): boolean;
  settledBy?(
    read: ProjectionReads,
    intent: OperationIntent,
    receipt: OperationReceipt,
  ): Settlement | null;
  effectHandles?(read: ProjectionReads, intent: OperationIntent): ReadonlyArray<string> | null;
  observedIn?(intent: OperationIntent, receipt: OperationReceipt): DetailDemand | null;
  adoptedResult?(handle: string): OperationResult;
}
