/**
 * Cleaning up the door's throwaway credentials, at Zerops: the account's recorded debt names what
 * this browser owes, and exactly those throwaways are deleted (`executors/throwawaySweep.ts`). The
 * deletes are the outcome: the owner's answer settles the operation, and the debt records what is
 * still owed.
 *
 * @module data/operations/throwawaySweep
 */
import type { OperationKind } from "./kind.ts";

declare module "../model.ts" {
  interface OperationIntents {
    readonly "throwaway-sweep": {
      readonly clientId: string;
      /** Whose expired throwaways an explicit cleanup also deletes; null when not known. */
      readonly userId: string | null;
      /** Asked by the person, not started by a matured debt. */
      readonly explicit: boolean;
    };
  }
}

export const throwawaySweep: OperationKind<"throwaway-sweep"> = {
  kind: "throwaway-sweep",
  executor: "zerops",
  // Changes no scope this account reads: the owner's answer is all there is to show.
  reflected: () => true,
};
