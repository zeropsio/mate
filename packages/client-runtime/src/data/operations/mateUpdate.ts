import type { EnvironmentId, ExecutionEnvironmentUpdate } from "@t3tools/contracts";
import type { OperationKind, Settlement } from "./kind.ts";
import type { ProjectionReads } from "../store.ts";
import { mateOfEnvironment } from "../projections/mateLinks.ts";

declare module "../model.ts" {
  interface OperationResults {
    readonly "mate-update": {
      readonly alreadyCurrent: boolean;
      readonly version: string | null;
      /** The container restart the press started or joined (`update.restart.attempt`). */
      readonly restartAttempt?: string | undefined;
    };
  }
  interface OperationIntents {
    readonly "mate-update": {
      readonly environmentId: EnvironmentId;
      readonly from: string;
      readonly bootId?: string | undefined;
      readonly to: string;
      /**
       * Only a container restart gets the Mate current: what it installs, zcp's version and the
       * mate's when that moves too. Its next boot reading them is the proof.
       */
      readonly restart?: MateRestartTarget | undefined;
    };
  }
}
export interface MateRestartTarget {
  readonly zcp?: string | undefined;
  readonly mate?: string | undefined;
}
export interface UpdateServer {
  readonly serverVersion: string;
  readonly bootId?: string | undefined;
  readonly update?: ExecutionEnvironmentUpdate | null | undefined;
}
/** What a restart press settles on: its own attempt postponed, or the next boot's reading. */
function restartOutcome(
  restart: MateRestartTarget,
  pressed: { readonly bootId?: string | undefined },
  server: UpdateServer,
  attempt: string | undefined,
): Settlement | null {
  const update = server.update ?? undefined;
  if (
    pressed.bootId === undefined ||
    server.bootId === undefined ||
    server.bootId === pressed.bootId
  ) {
    const progress = update?.restart;
    return attempt !== undefined && progress?.phase === "postponed" && progress.attempt === attempt
      ? {
          kind: "failed",
          reason: `Update postponed; ${progress.reason ?? "the restart did not happen"}`,
        }
      : null;
  }
  // zcp's word, never a comparison here (MU-1): current, or the version the press named.
  const missed = [
    ...(restart.zcp !== undefined &&
    update?.zcp?.behind !== false &&
    update?.zcp?.installed !== restart.zcp
      ? [`Zerops Control Plane ${restart.zcp}`]
      : []),
    ...(restart.mate !== undefined &&
    server.serverVersion !== restart.mate &&
    update?.available !== false
      ? [`mate ${restart.mate}`]
      : []),
  ];
  return missed.length === 0
    ? { kind: "succeeded" }
    : { kind: "failed", reason: `The restart didn't install ${missed.join(" and ")}.` };
}
export function updateOutcome(
  pressed: {
    readonly from: string;
    readonly bootId?: string | undefined;
    readonly restart?: MateRestartTarget | undefined;
  },
  server: UpdateServer | null,
  /** The restart this press started, from its acceptance; absent before the answer. */
  attempt?: string,
): Settlement | null {
  if (server === null) return null;
  if (pressed.restart !== undefined)
    return restartOutcome(pressed.restart, pressed, server, attempt);
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
