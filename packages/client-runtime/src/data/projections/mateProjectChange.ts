import type { HqOperation } from "../../zerops/hq/client.ts";
import { hqOperationOf, type HqOperationStanding } from "./hqOperation.ts";

export interface MateProjectChange {
  readonly kind: "mate_stop" | "mate_start" | "mate_rename";
  readonly standing: HqOperationStanding;
  readonly open: boolean;
}

/** The change HQ shows on the Mate's project, including waits and failures after admission. */
export function mateProjectChangeOf(
  operation: HqOperation | undefined,
): MateProjectChange | undefined {
  if (
    operation?.kind !== "mate_stop" &&
    operation?.kind !== "mate_start" &&
    operation?.kind !== "mate_rename"
  )
    return undefined;
  const standing = hqOperationOf(operation, operation.kind);
  return {
    kind: operation.kind,
    standing,
    open: standing.kind === "going" || standing.kind === "waiting",
  };
}
