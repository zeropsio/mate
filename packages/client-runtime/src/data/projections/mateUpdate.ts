import type { ExecutionEnvironmentUpdate } from "@t3tools/contracts";
import { operationResult } from "../model.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";
import { updateAvailabilityScope } from "../families/mateUpdate.ts";
import { updateServer } from "../operations/mateUpdate.ts";
import { mateOfEnvironment } from "./mateLinks.ts";
import { operationProgress } from "./operation.ts";

export type MateUpdateState =
  | { readonly phase: "idle" | "checking" | "already-current" }
  | { readonly phase: "updating"; readonly to: string }
  | { readonly phase: "updated"; readonly to: string }
  | { readonly phase: "failed"; readonly message: string };
export interface MateUpdateRead {
  readonly state: MateUpdateState;
  readonly checked: ExecutionEnvironmentUpdate | null | undefined;
  readonly notice?: string | undefined;
}
export const mateUpdate: Projection<string, MateUpdateRead> = {
  name: "mateUpdate",
  keyOf: (key) => key,
  equals: sameValue,
  derive: (read, environmentId) => {
    const availability = read.fact("mateUpdateAvailability", environmentId);
    const checkStream = read.stream(updateAvailabilityScope(environmentId));
    const request = read.fact("mateUpdateRequest", environmentId);
    const mate = mateOfEnvironment.derive(read, environmentId);
    const source = mate?.container.reading?.reading;
    const automatic =
      mate?.watched === true && source?.kind === "ready" ? source.descriptor.update : undefined;
    const checked =
      automatic?.automatic === undefined
        ? availability.kind === "known"
          ? availability.value
          : undefined
        : automatic;
    if (request.kind === "known" && request.value.requestId !== null) {
      const record = read.operation(request.value.requestId);
      if (record?.intent.kind === "mate-update") {
        const progress = operationProgress.derive(read, request.value.requestId);
        if (record.receipt?.acceptance.kind === "refused")
          return { checked, state: { phase: "failed", message: record.receipt.acceptance.reason } };
        if (progress.stage === "done") {
          if (progress.outcome === "failed")
            return {
              checked: undefined,
              state: {
                phase: "failed",
                message:
                  record.receipt?.outcome.kind === "failed"
                    ? record.receipt.outcome.evidence
                    : (("reason" in progress ? progress.reason : undefined) ??
                      "The update did not take."),
              },
            };
          return {
            checked: undefined,
            state:
              operationResult(record, "mate-update")?.alreadyCurrent === true
                ? { phase: "already-current" }
                : {
                    phase: "updated",
                    to:
                      operationResult(record, "mate-update")?.version ??
                      updateServer(read, environmentId)?.serverVersion ??
                      record.intent.to,
                  },
          };
        }
        if (progress.stage === "unsent")
          return {
            checked,
            state: { phase: "failed", message: progress.reason ?? "The update could not be sent." },
          };
        return {
          checked: undefined,
          state: { phase: "updating", to: record.intent.to },
          notice:
            progress.stage === "uncertain"
              ? "The update answer was lost. Check the connection again; the update may have started."
              : "Waiting for this Mate to return. Check the connection again.",
        };
      }
    }
    if (["connecting", "baselining"].includes(checkStream.phase))
      return { checked, state: { phase: "checking" } };
    if (checkStream.fault !== null)
      return { checked, state: { phase: "failed", message: checkStream.fault.message } };
    return {
      checked,
      state:
        checked !== undefined &&
        (checked === null || (checked.latest !== "" && checked.available !== true))
          ? { phase: "already-current" }
          : { phase: "idle" },
    };
  },
};
export const mateUpdateStates: Projection<
  null,
  ReadonlyMap<
    string,
    {
      readonly environmentId: string;
      readonly containerKey: string | null;
      readonly state: MateUpdateState;
    }
  >
> = {
  name: "mateUpdateStates",
  keyOf: () => "all",
  equals: (left, right) =>
    left.size === right.size && [...left].every(([key, value]) => sameValue(value, right.get(key))),
  derive: (read) =>
    new Map(
      [...read.index("mateUpdateRequests", "all")].flatMap((environmentId) => {
        const ref = read.fact("mateUpdateRequest", environmentId);
        return ref.kind === "known"
          ? [
              [
                environmentId,
                {
                  environmentId,
                  containerKey: ref.value.containerKey,
                  state: mateUpdate.derive(read, environmentId).state,
                },
              ] as const,
            ]
          : [];
      }),
    ),
};
