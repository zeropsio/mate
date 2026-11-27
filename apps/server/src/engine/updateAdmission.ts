import * as Effect from "effect/Effect";
import { makeAdmissionFence } from "../update/AdmissionFence.ts";

import type { CommandTag } from "./domain/command.ts";

export const UPDATE_DRAIN_MESSAGE =
  "Update ready; waiting for your work to finish. Try again after the update.";

/**
 * Only inputs that settle or stop accepted work may cross a closed admission fence: a lease's
 * binding is the record of what a running turn's agent did, and an answer heard elsewhere settles
 * a wait the conversation already holds.
 */
const allowedDuringUpdate = (tag: CommandTag): boolean => {
  switch (tag) {
    case "Stop":
    case "Answer":
    case "Dismiss":
    case "CloseSession":
    case "CancelWake":
    case "EffectSettled":
    case "ProviderSignals":
    case "Recovered":
    case "BindLease":
    case "UnbindLease":
    // An answer to another Mate's message heard elsewhere, or the mark on one sent: bookkeeping,
    // never new work.
    case "ForgetMateAnswer":
    case "MarkMateAnswer":
      return true;
    default:
      return false;
  }
};

/** Why a person's answer is refused once the update's final idle proof is under way. */
export const UPDATE_SEALED_MESSAGE =
  "The Mate is updating: your question stays open and is asked again after the restart.";

/**
 * A person's answer, once the update's final idle proof is under way: a run left to the restart
 * would take it into a turn the restart then cuts, and the person would be asked again.
 */
const sealedDuringUpdate = (tag: CommandTag): boolean => tag === "Answer";

export const makeUpdateAdmission = makeAdmissionFence(allowedDuringUpdate, sealedDuringUpdate);

/** What the person reads when the fence refuses a command: the seal's reason, or the drain's. */
export const updateRefusal = (tag: CommandTag): string =>
  allowedDuringUpdate(tag) ? UPDATE_SEALED_MESSAGE : UPDATE_DRAIN_MESSAGE;

export type UpdateAdmission = Effect.Success<typeof makeUpdateAdmission>;
