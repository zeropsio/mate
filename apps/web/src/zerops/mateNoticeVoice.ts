import type { OperationProgress } from "@t3tools/client-runtime/data";
import {
  comingSentence,
  KEEP_TAB_OPEN_LINE,
  pressNote,
  pressRuns,
  type ArrivalSubstep,
} from "./mateArrival";
import { type MateComing } from "./mateComing";
import { NOT_SET_UP_LINE } from "~/components/zerops/ZeropsProjectRow.logic";
import { usageLimitWords } from "./noticeWords";

const UNCERTAIN_RESTART =
  "Zerops did not answer whether it took the restart. Check the Mate before trying again.";
const stoppedRestartWords = (nextAction: string | undefined, reason?: string) =>
  `The Mate was stopped, but it was not started again here${reason === undefined ? "" : `: ${reason.replace(/\.$/, "")}`}. ${nextAction ?? "Start the Mate"}.`;

/** What the person is told of a restart its owner did not take; `null` once Zerops took it. */
export function restartRefusal(progress: OperationProgress): string | null {
  switch (progress.stage) {
    case "refused":
      return progress.reason;
    case "unsent":
      return progress.reason ?? "Zerops did not take the restart. Try again.";
    case "uncertain":
      return UNCERTAIN_RESTART;
    case "unresolved":
      return stoppedRestartWords(progress.nextAction, progress.reason);
    default:
      return null;
  }
}

export interface MateOperationRefusal {
  readonly kind: "retry" | "finish" | "remove";
  readonly details: string;
  readonly receipt?: OperationProgress | undefined;
  /** A retry answers this failed source attempt, not any later attempt. */
  readonly attemptId?: string | undefined;
}

export interface MateArrivalNoticeInput {
  readonly coming: MateComing | undefined;
  readonly progress:
    | {
        readonly startedAt?: string | undefined;
        readonly press?: ReadonlyArray<ArrivalSubstep> | undefined;
      }
    | undefined;
  readonly nowMs: number | undefined;
  readonly failureReason?: string | undefined;
  readonly details?: string | undefined;
  readonly attemptId?: string | undefined;
  readonly refusal?: MateOperationRefusal | null | undefined;
  readonly finish?: string | undefined;
}

/** Current source evidence chooses the words; refusals keep their diagnostics collapsed. */
export function mateArrivalNotice(input: MateArrivalNoticeInput) {
  const { coming, progress, nowMs } = input;
  const note = pressNote(progress?.press);
  const running = coming?.kind === "coming" && note?.kind !== "unfinished";
  const refusal =
    !running &&
    (input.refusal?.kind !== "retry" ||
      (input.attemptId !== undefined && input.refusal.attemptId === input.attemptId))
      ? input.refusal
      : null;
  const receipt = refusal?.receipt;
  const refusalText =
    refusal == null
      ? undefined
      : receipt?.stage === "uncertain"
        ? UNCERTAIN_RESTART
        : receipt?.stage === "unresolved"
          ? stoppedRestartWords(receipt.nextAction)
          : refusal.kind === "retry"
            ? "Zerops didn't accept the setup retry."
            : refusal.kind === "remove"
              ? "Zerops didn't accept removing the project."
              : "Zerops couldn't finish setting up the Mate.";
  const startedAt = Date.parse(progress?.startedAt ?? "");
  const elapsed = nowMs === undefined || Number.isNaN(startedAt) ? undefined : nowMs - startedAt;
  const secondary =
    refusalText ??
    (coming === undefined
      ? undefined
      : coming.kind === "failed"
        ? (input.failureReason ??
          (coming.verb === "go-to-projects"
            ? coming.line
            : note?.kind === "stopped"
              ? NOT_SET_UP_LINE
              : coming.line))
        : (input.finish ??
          (pressRuns(progress?.press) ? KEEP_TAB_OPEN_LINE : comingSentence(elapsed))));
  const details = [
    ...new Set(
      [
        refusal?.details,
        input.details,
        coming?.kind === "failed" ? coming.details : undefined,
        ...(progress?.press
          ?.filter(
            (step) =>
              step.why !== undefined && (step.state === "failed" || step.state === "unfinished"),
          )
          .map((step) => `${step.label}: ${step.why}`) ?? []),
      ].filter((value): value is string => value !== undefined && value.length > 0),
    ),
  ].join("\n\n");
  return {
    secondary,
    details: details || undefined,
    note:
      note?.kind === "unfinished"
        ? `${progress?.press?.find((step) => step.state === "unfinished")?.label ?? "Setup isn't finished"}.`
        : null,
  };
}

/** The creation page and its design fixtures share the same phrase producer. */
export const comingSentenceOf = (input: MateArrivalNoticeInput) =>
  mateArrivalNotice(input).secondary;

import type { MateRecovery } from "@t3tools/client-runtime/data";
import { mateUnreachableWords } from "./lastKnownMate.logic";
import type { TimestampFormat } from "@t3tools/contracts/settings";
import { recoveryNotice } from "./mateRecovery.logic";
import { restartLine, RESTART_LINES } from "./restartLine";

import {
  reachabilityPhrase,
  type MateVoice,
  type MateVoiceInput,
} from "@t3tools/client-runtime/zerops/environments";

export type WebMateVoice =
  | { readonly surface: "none" }
  | (Exclude<MateVoice, { readonly surface: "none" }> & {
      readonly face?: "idle" | "sleep" | "waking";
      readonly severity?: "info" | "attention" | "danger" | undefined;
      readonly headline?: string;
      /** The source is still opening the conversation; its waiting pose follows readiness. */
      readonly opening?: true;
      readonly secondary?: string;
      readonly details?: string;
      /** Its container is restarting: its face plays the restart for as long as it lasts. */
      readonly restarting?: true;
      readonly restartLines?: ReadonlyArray<string>;
    });

/** Web copy and pose follow source evidence. Native clients keep their current presentation. */
export function mateNoticeVoice(
  input: Omit<MateVoiceInput, "heldMs"> & {
    readonly limit?: { readonly provider: string; readonly detail: string };
    readonly recovery?: MateRecovery;
    readonly restartLine?: number | undefined;
    readonly lastKnown?: string | undefined;
    readonly offlineSince?: string | undefined;
    readonly timestampFormat?: TimestampFormat;
  },
): WebMateVoice {
  const { reachability, conversationShown } = input;
  const name = input.mateName.trim() || "The Mate";
  const surface = conversationShown ? "banner" : "stage";
  const say = (
    headline: string,
    secondary: string,
    face: "idle" | "sleep" | "waking" = "sleep",
    actions: Exclude<MateVoice, { surface: "none" }>["actions"] = [],
    processes = false,
  ): Exclude<WebMateVoice, { readonly surface: "none" }> => ({
    surface,
    severity:
      reachability?.kind === "refused-configuration" ||
      reachability?.kind === "not-answering" ||
      reachability?.kind === "no-address"
        ? "danger"
        : actions.length > 0 ||
            (reachability?.kind === "connecting" && reachability.waitingOn === "visible")
          ? "attention"
          : "info",
    headline,
    secondary,
    text: secondary.length === 0 ? headline : `${headline} ${secondary}`,
    face,
    actions,
    processes,
  });
  if (input.limit !== undefined)
    return {
      ...say(usageLimitWords(input.limit.provider, undefined, name), input.limit.detail),
      severity: "attention",
    };
  const notice =
    reachability?.kind === "ready"
      ? reachability.notice
      : reachability?.kind === "container"
        ? reachability.container
        : null;
  const recovery =
    (input.recovery === undefined ? null : recoveryNotice(input.recovery, name)) ??
    (notice?.level === "inactive"
      ? recoveryNotice(
          { standing: { kind: "unknown" }, status: notice.status, process: undefined },
          name,
        )
      : null);
  const process = input.recovery?.process;
  const recoveringRestart =
    input.recovery?.standing.kind !== "denied" &&
    input.recovery?.standing.kind !== "deleted" &&
    (process?.status === "RUNNING" || process?.status === "PENDING") &&
    process.actionName === "stack.restart";
  if (recovery !== null)
    return {
      surface,
      text: input.lastKnown === undefined ? recovery.text : `${recovery.text} ${input.lastKnown}`,
      headline: recovery.headline,
      ...(recovery.details === undefined ? {} : { details: recovery.details }),
      secondary: [recoveringRestart ? restartLine(name, 0) : recovery.secondary, input.lastKnown]
        .filter(Boolean)
        .join(" "),
      ...(recoveringRestart
        ? {
            restarting: true as const,
            restartLines: RESTART_LINES.map((line) =>
              [line(name), input.lastKnown].filter(Boolean).join(" "),
            ),
          }
        : {}),
      severity:
        recovery.tone === "error" ? "danger" : recovery.tone === "warning" ? "attention" : "info",
      actions: recovery.actions,
      processes: false,
      face:
        (input.recovery?.process?.status === "RUNNING" ||
          input.recovery?.process?.status === "PENDING") &&
        (input.recovery.process.actionName === "stack.restart" ||
          input.recovery.process.actionName === "stack.start")
          ? "waking"
          : "sleep",
    };
  if (notice?.level === "restarting" || notice?.level === "updating") {
    if (!("overdue" in notice && notice.overdue)) {
      return notice.level === "restarting"
        ? {
            ...say(`${name} is restarting.`, restartLine(name, input.restartLine ?? 0), "waking"),
            restarting: true,
            restartLines: RESTART_LINES.map((line) => line(name)),
          }
        : say(
            `${name} is updating.`,
            "The conversation will open once the update finishes.",
            "waking",
          );
    }
  }
  if (
    reachability === null ||
    reachability.kind === "resolving" ||
    (reachability.kind === "connecting" && reachability.waitingOn !== "visible")
  ) {
    return conversationShown
      ? { surface: "none" }
      : {
          ...say(
            `${name} is opening the conversation.`,
            "Picking up where you left off.",
            "sleep",
            [],
            false,
          ),
          opening: true,
        };
  }
  if (reachability.kind === "ready" && reachability.notice === null) return { surface: "none" };
  const phrase = reachabilityPhrase(reachability, { ...input, mateName: name });
  const actions = phrase.actions;
  switch (reachability.kind) {
    case "replaced":
      return say(
        `${name} was redeployed.`,
        "Earlier conversations aren't available here.",
        "sleep",
        actions,
      );
    case "refused-configuration":
      return say(
        `${name} refused the connection settings.`,
        "Check the settings before trying again.",
        "sleep",
        actions,
      );
    case "refused-credential":
      return say(
        `${name} couldn't accept your sign-in.`,
        "Try again to renew the connection.",
        "sleep",
        actions,
      );
    case "refused-role":
      return say(
        `${name} isn't available with your access.`,
        "You can see the project, but can't operate its Mate.",
        "sleep",
        actions,
      );
    case "gone":
      return say(
        reachability.because === "direct-not-found"
          ? `${name}'s project was deleted.`
          : reachability.because === "direct-forbidden"
            ? `You no longer have access to ${name}'s project.`
            : `${name}'s project isn't listed for this account.`,
        reachability.because === "direct-not-found"
          ? "This conversation is no longer available."
          : reachability.because === "direct-forbidden"
            ? "Ask a project owner to restore it."
            : "Zerops has not confirmed whether you still have access.",
        "sleep",
        actions,
      );
    case "update-required":
      return say(
        `${name} needs an update.`,
        `Version ${reachability.actual} is installed; ${reachability.minimum} or newer is required.`,
        "sleep",
        actions,
      );
    case "update-unavailable":
      return say(
        `${name} needs newer Zerops tooling.`,
        "The installed tooling supplies an older Mate than this app supports.",
        "sleep",
        actions,
      );
    case "no-address":
      return say(
        `${name} has no public address.`,
        "Open the project in Zerops to check its address.",
        "sleep",
        actions,
      );
    case "waiting-for-zerops":
      return say(
        `${name} can't reach Zerops.`,
        "The connection will resume when Zerops answers.",
        "sleep",
        actions,
      );
    case "not-answering":
      return say(
        mateUnreachableWords(name, input.offlineSince, input.timestampFormat),
        input.lastKnown ?? "",
        "sleep",
        [...actions, "open-in-zerops"],
      );
    case "reconnecting":
    case "retrying": {
      if (reachability.kind === "reconnecting" && reachability.retryAtMs === undefined) {
        return say(
          mateUnreachableWords(name, input.offlineSince, input.timestampFormat, true),
          input.lastKnown ?? "The conversation will open when the connection returns.",
          "sleep",
          ["open-in-zerops"],
        );
      }
      const secondary = [
        phrase.text ?? "The conversation will open when the connection returns.",
        input.lastKnown,
      ]
        .filter(Boolean)
        .join(" ");
      return say(
        mateUnreachableWords(name, input.offlineSince, input.timestampFormat, true),
        secondary.replaceAll("This Mate", name).replaceAll("this Mate", name),
        "sleep",
        [...actions, "open-in-zerops"],
      );
    }
    case "container": {
      if ("overdue" in reachability.container && reachability.container.overdue) {
        return say(
          `${name} is taking longer to start.`,
          "Check the connection or restart from projects.",
          "sleep",
          actions,
        );
      }
      switch (reachability.container.level) {
        case "creating":
        case "provisioning":
          return say(
            `${name} is getting ready.`,
            "Zerops is preparing the container.",
            "waking",
            actions,
          );
        case "booting":
          return say(
            `${name} is starting.`,
            "Waiting for the container to answer.",
            "waking",
            actions,
          );
        case "inactive":
          return say(
            `${name} is stopped.`,
            "Open projects to start the container.",
            "sleep",
            actions,
          );
        case "needs-update":
          return say(
            `${name} needs an update before starting.`,
            "Open projects to restart the container.",
            "sleep",
            actions,
          );
        default:
          return say(
            `${name} isn't ready to start.`,
            phrase.text ?? "Check the container in Zerops.",
            "sleep",
            actions,
          );
      }
    }
    case "connecting":
      return say(
        `${name} is paused while this tab is in the background.`,
        "Return to this tab to continue connecting.",
        "sleep",
      );
    default:
      return say(
        `${name} is taking longer to start.`,
        phrase.text ?? "Waiting for the connection to be verified.",
        "sleep",
        actions,
      );
  }
}
