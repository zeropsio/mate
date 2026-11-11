import type { EnvironmentId, ExecutionEnvironmentUpdate } from "@t3tools/contracts";
import type { OperationKind, Settlement } from "./kind.ts";
import type { ProjectionReads } from "../store.ts";
import type { OperationReceipt, OperationResults } from "../model.ts";
import { mateOfEnvironment } from "../projections/mateLinks.ts";

declare module "../model.ts" {
  interface OperationResults {
    readonly "mate-update": {
      readonly alreadyCurrent: boolean;
      readonly version: string | null;
      /** The boot that answered. */
      readonly bootId?: string | undefined;
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
/** What the press's answer said: absent when the answer was lost. */
export interface MateUpdateAnswer {
  /** The boot that answered: a reboot is judged against it. */
  readonly bootId?: string | undefined;
}
export interface UpdateServer {
  readonly serverVersion: string;
  readonly bootId?: string | undefined;
  readonly update?: ExecutionEnvironmentUpdate | null | undefined;
}
interface Pressed {
  readonly from: string;
  readonly bootId?: string | undefined;
  /** What the press's own check said a restart would install. */
  readonly restart?: MateRestartTarget | undefined;
}
/** `unconfirmed`: the Mate is back but its reading cannot say yet, for a bounded wait to end. */
export type UpdateVerdict = Settlement | "unconfirmed" | null;

/** zcp writes `v9.226.0`; the press named `9.226.0`. */
const zcpVersionText = (version: string) => version.replace(/^v(?=\d)/u, "");

/**
 * One part of what a restart installs, as the next boot's reading says it — never a version
 * comparison here (MU-1): on the version pressed for, or current where the reading knows the
 * latest; behind where it knows, else unknown.
 */
function reached(
  target: string | undefined,
  installed: string | undefined,
  current: boolean | undefined,
  latest: string | undefined,
): "yes" | "no" | "unknown" {
  if (target === undefined || installed === target) return "yes";
  if (latest === undefined || latest === "" || current === undefined) return "unknown";
  return current ? "yes" : "no";
}

/** A restart press: the next boot's reading of what it installs. */
function restartVerdict(
  target: MateRestartTarget,
  pressed: Pressed,
  server: UpdateServer,
  answer: MateUpdateAnswer | undefined,
): UpdateVerdict {
  const update = server.update ?? undefined;
  const baseline = answer?.bootId ?? pressed.bootId;
  if (baseline === undefined || server.bootId === undefined || server.bootId === baseline)
    return null;
  const zcp = update?.zcp;
  const parts = [
    {
      words: `Zerops Control Plane ${target.zcp}`,
      state: reached(
        target.zcp,
        zcp === undefined ? undefined : zcpVersionText(zcp.installed),
        zcp === undefined ? undefined : !zcp.behind,
        zcp?.latest,
      ),
    },
    {
      words: `mate ${target.mate}`,
      state: reached(
        target.mate,
        server.serverVersion,
        update === undefined ? undefined : !update.available,
        update?.latest,
      ),
    },
  ];
  const missed = parts.filter((part) => part.state === "no").map((part) => part.words);
  if (missed.length > 0)
    return { kind: "failed", reason: `The restart didn't install ${missed.join(" and ")}.` };
  return parts.some((part) => part.state === "unknown") ? "unconfirmed" : { kind: "succeeded" };
}

/**
 * How a press ended, as far as the server's facts say: a press whose check read that only a
 * restart gets the Mate current is judged by what the next boot reads, any other by the version
 * the Mate answers on; the boot that answered (or, with the answer lost, the boot at the press) is
 * the baseline a reboot is judged against.
 */
export function updateVerdict(
  pressed: Pressed,
  server: UpdateServer | null,
  answer?: MateUpdateAnswer,
): UpdateVerdict {
  if (server === null) return null;
  if (pressed.restart !== undefined)
    return restartVerdict(pressed.restart, pressed, server, answer);
  if (server.serverVersion !== pressed.from) return { kind: "succeeded" };
  const baseline = answer?.bootId ?? pressed.bootId;
  if (baseline === undefined || server.bootId === undefined || server.bootId === baseline)
    return null;
  return {
    kind: "failed",
    reason: `The update did not take: this Mate is still on ${pressed.from}.`,
  };
}
export function updateOutcome(
  pressed: Pressed,
  server: UpdateServer | null,
  answer?: MateUpdateAnswer,
): Settlement | null {
  const verdict = updateVerdict(pressed, server, answer);
  return verdict === "unconfirmed" ? null : verdict;
}
export function updateServer(read: ProjectionReads, environmentId: string): UpdateServer | null {
  const link = mateOfEnvironment.derive(read, environmentId);
  const reading = link?.container.reading?.reading;
  return link?.watched === true && reading?.kind === "ready" ? reading.descriptor : null;
}
/** What the press's answer said, read off its receipt; absent when it was lost. */
export function updateAnswer(
  receipt: OperationReceipt | null | undefined,
): MateUpdateAnswer | undefined {
  const acceptance = receipt?.acceptance;
  if (acceptance?.kind !== "accepted") return undefined;
  const result = acceptance.result as OperationResults["mate-update"] | undefined;
  return result?.bootId === undefined ? {} : { bootId: result.bootId };
}
export const mateUpdate: OperationKind<"mate-update"> = {
  kind: "mate-update",
  executor: "mate",
  reflected: (read, intent, receipt) =>
    updateOutcome(intent, updateServer(read, intent.environmentId), updateAnswer(receipt)) !== null,
  settledBy: (read, intent, receipt) =>
    updateOutcome(intent, updateServer(read, intent.environmentId), updateAnswer(receipt)),
};
