import * as Effect from "effect/Effect";
import { makeAdmissionFence } from "../update/AdmissionFence.ts";

import type { CommandTag } from "./domain/command.ts";

export const UPDATE_DRAIN_MESSAGE =
  "Update ready; waiting for your work to finish. Try again after the update.";

/** Only inputs that settle or stop accepted work may cross a closed admission fence. */
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
      return true;
    default:
      return false;
  }
};

export const makeUpdateAdmission = makeAdmissionFence(allowedDuringUpdate);

export type UpdateAdmission = Effect.Success<typeof makeUpdateAdmission>;
