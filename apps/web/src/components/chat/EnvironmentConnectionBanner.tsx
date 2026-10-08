import type { WebMateVoice as MateVoice } from "~/zerops/mateNoticeVoice";
import {
  connectionBannerCopy,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
} from "@t3tools/client-runtime/state/runtime";
import { askAgainLabel } from "@t3tools/client-runtime/zerops/environments";
import type { EnvironmentId } from "@t3tools/contracts";
import { useState, type ReactElement } from "react";

import { MateStateDetails } from "../zerops/MateStateDetails";
import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

/**
 * The banner over a conversation whose environment is not connected: the
 * cause named after the Mate (`connectionBannerCopy`) and at most one verb,
 * which asks the supervisor to try now. The failure's own detail stays out
 * of it.
 */
export function environmentConnectionBannerItem(input: {
  readonly environmentId: EnvironmentId;
  readonly connection: EnvironmentConnectionPresentation;
  readonly mateName: string | null;
  readonly onRetry: () => void;
}): ComposerBannerStackItem | null {
  const copy = connectionBannerCopy(input.connection, input.mateName);
  if (copy === null) return null;
  return {
    id: `environment-unavailable:${input.environmentId}`,
    variant: input.connection.phase === "error" ? "error" : "default",
    icon: null,
    layout: "centered",
    title: copy.title,
    ...(copy.description === null ? {} : { description: copy.description }),
    ...(copy.action === null
      ? {}
      : {
          actions: (
            <Button size="compact" variant="pill" onClick={input.onRetry}>
              {copy.action}
            </Button>
          ),
        }),
  };
}

/**
 * The banner over a Mate's conversation (`mateVoice`): the link's one line, in the Mate's name,
 * and its verb once — *Try now* (or *Try again*, after a refusal) asks its Mate again; the projects screen's verbs send the
 * person there. Nothing while the voice speaks elsewhere or not at all.
 */
export function mateVoiceBannerItem(input: {
  readonly environmentId: EnvironmentId;
  readonly voice: MateVoice;
  readonly onRetry: () => void;
  readonly projects: ReactElement;
  readonly onContainerAction?: ((action: "start" | "restart") => void) | undefined;
  readonly busy?: boolean;
  readonly projectUrl?: string;
}): ComposerBannerStackItem | null {
  const { voice } = input;
  if (voice.surface !== "banner" || voice.text === null) return null;
  const askAgain = askAgainLabel(voice.actions);
  const containerAction = voice.actions.includes("start")
    ? "start"
    : voice.actions.includes("restart")
      ? "restart"
      : null;
  const openInZerops = voice.actions.includes("open-in-zerops") && input.projectUrl !== undefined;
  const toProjects = voice.actions.some(
    (action) =>
      action === "go-to-projects" ||
      ((action === "start" || action === "restart") && input.onContainerAction === undefined) ||
      action === "enable" ||
      (action === "open-in-zerops" && !openInZerops),
  );
  return {
    id: `mate-link:${input.environmentId}`,
    variant:
      voice.severity === "danger"
        ? "error"
        : voice.severity === "attention"
          ? "warning"
          : "default",
    icon: null,
    layout: "centered",
    title: voice.headline ?? voice.text,
    ...(voice.secondary === undefined
      ? {}
      : {
          description:
            voice.restarting === true && voice.restartLines !== undefined ? (
              <RestartWords key={input.environmentId} lines={voice.restartLines} />
            ) : (
              <>
                {voice.secondary}
                {voice.details ? (
                  <MateStateDetails>
                    <p className="whitespace-pre-wrap break-words">{voice.details}</p>
                  </MateStateDetails>
                ) : null}
              </>
            ),
        }),
    ...(askAgain !== null ||
    toProjects ||
    openInZerops ||
    (containerAction !== null && input.onContainerAction !== undefined)
      ? {
          actions: (
            <>
              {containerAction === null || input.onContainerAction === undefined ? null : (
                <Button
                  variant="pill"
                  disabled={input.busy}
                  size="compact"
                  onClick={() => input.onContainerAction?.(containerAction)}
                >
                  {input.busy
                    ? "Asking Zerops…"
                    : containerAction === "start"
                      ? "Start"
                      : "Retry restart"}
                </Button>
              )}
              {askAgain === null ? null : (
                <Button size="compact" variant="pill" onClick={input.onRetry}>
                  {askAgain}
                </Button>
              )}
              {openInZerops ? (
                <Button
                  render={<a href={input.projectUrl} target="_blank" rel="noreferrer" />}
                  size="compact"
                  variant="pill"
                >
                  Open in Zerops
                </Button>
              ) : null}
              {toProjects ? (
                <Button render={input.projects} size="compact" variant="pill">
                  Go to projects
                </Button>
              ) : null}
            </>
          ),
        }
      : {}),
  };
}

/**
 * What a banner's "Try now" says when asking the supervisor failed, which
 * happens only when the connection runtime itself could not be built. The
 * failure's own words go to the console with the command's report, never
 * into the toast.
 */
export function environmentRetryFailureToast(
  result: AtomCommandResult<unknown, unknown>,
): { readonly title: string; readonly description: string } | null {
  if (result._tag === "Success" || isAtomCommandInterrupted(result)) return null;
  return { title: "Couldn't reconnect", description: "Reload the page to try again." };
}

/** The restart notice's copy rotates with its fade. It never changes the source verdict. */
function RestartWords({ lines }: { readonly lines: ReadonlyArray<string> }) {
  const [cycle, setCycle] = useState(0);
  return (
    <span
      data-mate-restart-words=""
      onAnimationIteration={(event) => {
        if (
          event.animationName === "mate-restart-words" &&
          !window.matchMedia("(prefers-reduced-motion: reduce)").matches
        )
          setCycle((value) => (value + 1) % lines.length);
      }}
    >
      {lines[cycle % lines.length]}
    </span>
  );
}
