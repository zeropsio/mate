import type { EnvironmentId } from "@t3tools/contracts";
import type { OperationKind, Settlement } from "./kind.ts";
import type { ProjectionReads } from "../store.ts";
import { mateOfEnvironment } from "../projections/mateLinks.ts";

declare module "../model.ts" {
  interface OperationResults {
    readonly "mate-update": { readonly alreadyCurrent: boolean; readonly version: string | null };
  }
  interface OperationIntents {
    readonly "mate-update": {
      readonly environmentId: EnvironmentId;
      readonly from: string;
      readonly bootId?: string | undefined;
      readonly to: string;
    };
  }
}
export interface UpdateServer {
  readonly serverVersion: string;
  readonly bootId?: string | undefined;
}
export function updateOutcome(
  pressed: { readonly from: string; readonly bootId?: string | undefined },
  server: UpdateServer | null,
): Settlement | null {
  if (server === null) return null;
  if (server.serverVersion !== pressed.from) return { kind: "succeeded" };
  if (
    pressed.bootId === undefined ||
    server.bootId === undefined ||
    server.bootId === pressed.bootId
  )
    return null;
  return {
    kind: "failed",
    reason: `The update did not take: this Mate is still on ${pressed.from}.`,
  };
}
export function updateServer(read: ProjectionReads, environmentId: string): UpdateServer | null {
  const link = mateOfEnvironment.derive(read, environmentId);
  const reading = link?.container.reading?.reading;
  return link?.watched === true && reading?.kind === "ready" ? reading.descriptor : null;
}
export const mateUpdate: OperationKind<"mate-update"> = {
  kind: "mate-update",
  executor: "mate",
  reflected: (read, intent) =>
    updateOutcome(intent, updateServer(read, intent.environmentId)) !== null,
  settledBy: (read, intent) => updateOutcome(intent, updateServer(read, intent.environmentId)),
};
