import type { OrchestrationCommand } from "@t3tools/contracts";
import type * as Effect from "effect/Effect";
import { makeAdmissionFence } from "../update/AdmissionFence.ts";

export const allowedDuringV1Update = (type: OrchestrationCommand["type"]): boolean => {
  switch (type) {
    case "thread.turn.interrupt":
    case "thread.approval.respond":
    case "thread.user-input.respond":
    case "thread.user-input.dismiss":
    case "thread.session.stop":
    case "thread.session.set":
    case "thread.message.assistant.delta":
    case "thread.message.assistant.complete":
    case "thread.message.reasoning.delta":
    case "thread.message.reasoning.complete":
    case "thread.proposed-plan.upsert":
    case "thread.turn.diff.complete":
    case "thread.activity.append":
    case "thread.revert.complete":
    case "thread.title.generate.complete":
    case "thread.title.regeneration.complete":
    case "thread.title.refine":
    case "thread.usage-pause.set":
      return true;
    default:
      return false;
  }
};

export const makeV1UpdateAdmission = makeAdmissionFence(allowedDuringV1Update);
export type V1UpdateAdmission = Effect.Success<typeof makeV1UpdateAdmission>;
