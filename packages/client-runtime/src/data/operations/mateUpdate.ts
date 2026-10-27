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
      /** The container restart the press started or joined (`update.restart.attempt`). */
      readonly restartAttempt?: string | undefined;
      /** What that restart installs, as the server said. */
      readonly restartTarget?: MateRestartTarget | undefined;
      /** The boot that answered. */
      readonly bootId?: string | undefined;
      /** When that restart started, by the server's clock. */
      readonly restartStartedAt?: string | undefined;
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
      /** When the restart on the line at the press had started (the server's clock), if one had. */
      readonly seenRestart?: string | undefined;
    };
  }
}
export interface MateRestartTarget {
  readonly zcp?: string | undefined;
  readonly mate?: string | undefined;
}
/** What the press's answer said the server is doing: absent when the answer was lost. */
export interface MateUpdateAnswer {
  /** The container restart it started or joined. */
  readonly attempt?: string | undefined;
  /** What that restart installs. */
  readonly target?: MateRestartTarget | undefined;
  /** The boot that answered: a reboot is judged against it. */
  readonly bootId?: string | undefined;
  /** When that restart started, by the server's clock. */
  readonly startedAt?: string | undefined;
}
export interface UpdateServer {
  readonly serverVersion: string;
  readonly bootId?: string | undefined;
  readonly update?: ExecutionEnvironmentUpdate | null | undefined;
}
interface Pressed {
  readonly from: string;
  readonly bootId?: string | undefined;
  /** What the press's own check said a restart would install; the answer outranks it. */
  readonly restart?: MateRestartTarget | undefined;
  /** When the restart on the line at the press had started (the server's clock), if one had. */
  readonly seenRestart?: string | undefined;
}
/** `unconfirmed`: the Mate is back but its reading cannot say yet, for a bounded wait to end. */
export type UpdateVerdict = Settlement | "unconfirmed" | null;

const POSTPONED_REASON = (reason: string | undefined) =>
  `Update postponed; ${reason ?? "the restart did not happen"}`;

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

/** A restart press: its own attempt postponed, or the next boot's reading of what it installs. */
function restartVerdict(
  target: MateRestartTarget,
  pressed: Pressed,
  server: UpdateServer,
  answer: MateUpdateAnswer | undefined,
): UpdateVerdict {
  const update = server.update ?? undefined;
  const baseline = answer?.bootId ?? pressed.bootId;
  if (baseline === undefined || server.bootId === undefined || server.bootId === baseline)
    return postponedVerdict(pressed, update, answer);
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
 * On the boot that answered: this press's restart postponed settles it. With the answer, its own
 * attempt, or that attempt gone from the line (no restart needed or asked any more, or a later one
 * in its place); with the answer lost, any restart that started strictly after the one seen at the
 * press.
 */
function postponedVerdict(
  pressed: Pressed,
  update: ExecutionEnvironmentUpdate | undefined,
  answer: MateUpdateAnswer | undefined,
): UpdateVerdict {
  const progress = update?.restart;
  if (answer?.attempt !== undefined) {
    if (progress?.attempt === answer.attempt)
      return progress.phase === "postponed"
        ? { kind: "failed", reason: POSTPONED_REASON(progress.reason) }
        : null;
    const gone =
      progress !== undefined &&
      ((progress.phase === undefined && !progress.needed) ||
        (progress.startedAt !== undefined &&
          answer.startedAt !== undefined &&
          progress.startedAt > answer.startedAt));
    return gone
      ? { kind: "failed", reason: "The restart didn't happen; Update to try again." }
      : null;
  }
  if (answer !== undefined || progress?.phase !== "postponed") return null;
  const later =
    progress.startedAt !== undefined &&
    (pressed.seenRestart === undefined || progress.startedAt > pressed.seenRestart);
  return later ? { kind: "failed", reason: POSTPONED_REASON(progress.reason) } : null;
}

/**
 * How a press ended, as far as the server's facts say: judged by what its answer said the server
 * is doing, never by the press's own check; with the answer lost, by the line and the boot.
 */
export function updateVerdict(
  pressed: Pressed,
  server: UpdateServer | null,
  answer?: MateUpdateAnswer,
): UpdateVerdict {
  if (server === null) return null;
  const target =
    answer === undefined
      ? pressed.restart
      : answer.attempt !== undefined || answer.target !== undefined
        ? (answer.target ?? {})
        : undefined;
  if (target !== undefined) return restartVerdict(target, pressed, server, answer);
  if (answer === undefined) {
    const postponed = postponedVerdict(pressed, server.update ?? undefined, answer);
    if (postponed !== null && (server.bootId === undefined || server.bootId === pressed.bootId))
      return postponed;
  }
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
  return {
    ...(result?.restartAttempt === undefined ? {} : { attempt: result.restartAttempt }),
    ...(result?.restartTarget === undefined ? {} : { target: result.restartTarget }),
    ...(result?.bootId === undefined ? {} : { bootId: result.bootId }),
    ...(result?.restartStartedAt === undefined ? {} : { startedAt: result.restartStartedAt }),
  };
}
export const mateUpdate: OperationKind<"mate-update"> = {
  kind: "mate-update",
  executor: "mate",
  reflected: (read, intent, receipt) =>
    updateOutcome(intent, updateServer(read, intent.environmentId), updateAnswer(receipt)) !== null,
  settledBy: (read, intent, receipt) =>
    updateOutcome(intent, updateServer(read, intent.environmentId), updateAnswer(receipt)),
};
