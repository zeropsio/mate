import * as Effect from "effect/Effect";
import { makeAdmissionFence } from "../update/AdmissionFence.ts";

import type { CommandTag } from "./domain/command.ts";

export const UPDATE_DRAIN_MESSAGE =
  "Update ready; waiting for your work to finish. Try again after the update.";

/**
 * Only inputs that settle or stop accepted work may cross a closed admission fence: a lease's
 * binding is the record of what a running turn's agent did.
 */
export const allowedDuringUpdate = (tag: CommandTag): boolean => {
  switch (tag) {
    case "Stop":
    case "Answer":
    case "Dismiss":
    case "HistoryBatch":
    case "CloseSession":
    case "CancelWake":
    case "EffectSettled":
    case "ProviderSignals":
    case "Recovered":
    case "BindLease":
    case "UnbindLease":
      return true;
    default:
      return false;
  }
};

export const makeUpdateAdmission = makeAdmissionFence(allowedDuringUpdate);

export type UpdateAdmission = Effect.Success<typeof makeUpdateAdmission>;
