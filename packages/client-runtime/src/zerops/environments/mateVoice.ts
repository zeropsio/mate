/**
 * The one voice of a Mate's link (the owner, 2026-09-30: "banners and snacks and weirdly aligned
 * states all over the place"): in every state of its link, one surface speaks — the stage (the
 * Mate's face, its name and one line under it, on one axis) where no conversation is shown, the
 * one banner over the composer where one is — and nothing else says anything about the link.
 *
 * | the link                         | a conversation shown     | none shown                     |
 * | -------------------------------- | ------------------------ | ------------------------------ |
 * | up                               | nothing                  | (the conversation's own view)  |
 * | first connect, under 1.5 s       | nothing                  | the stage, no words            |
 * | first connect, past 1.5 s        | nothing                  | "Opening Quinn…" + processes   |
 * | lost, under 1.5 s                | nothing                  | the stage, no words            |
 * | lost, past 1.5 s                 | "Reconnecting to Quinn…" | the same words on the stage    |
 * | Zerops restarting it             | "Quinn is restarting."   | the same words on the stage    |
 * | updating it                      | "Quinn is updating."     | the same words on the stage    |
 * | anything else on its way         | its cause, in the banner | its cause, on the stage        |
 *
 * Its face is asleep on the stage until the link is up. A terminal verdict (gone, replaced) is the
 * route's own view, not the link's voice. Pure.
 */
import {
  reachabilityPhrase,
  type ContainerNotice,
  type Reachability,
  type ReachabilityAction,
} from "./reachability.ts";

/** How long a link state holds before it says anything: a blip says nothing. */
export const MATE_VOICE_QUIET_MS = 1_500;

/**
 * How long a first connect holds before it offers Try now — and, over a shown conversation,
 * before it speaks at all: a link that never comes up (a blocked socket, a 502 at the edge, a
 * session that never answers) is never silent for good.
 */
export const MATE_VOICE_SLOW_MS = 8_000;

export type MateVoice =
  | { readonly surface: "none" }
  | {
      readonly surface: "banner" | "stage";
      /** Its one line; null where the stage stands without words yet. */
      readonly text: string | null;
      readonly actions: ReadonlyArray<ReachabilityAction>;
      /** The stage lists the platform's processes under its line: a first connect that is slow. */
      readonly processes: boolean;
    };

const NONE: MateVoice = { surface: "none" };

export interface MateVoiceInput {
  /** The link's verdict; null while nothing names the route's target yet. */
  readonly reachability: Reachability | null;
  /** The route shows the conversation (its content is there), so the banner speaks, not a stage. */
  readonly conversationShown: boolean;
  /** How long the verdict's kind has held, ms. */
  readonly heldMs: number;
  readonly nowMs: number;
  readonly mateName: string;
}

/** A restart or an update, in the Mate's name. */
const containerWords = (notice: ContainerNotice, name: string): string =>
  notice.level === "updating" ? `${name} is updating.` : `${name} is restarting.`;

/** What the link says, and where (the module's table). */
export function mateVoice(input: MateVoiceInput): MateVoice {
  const { reachability, conversationShown, heldMs, nowMs, mateName } = input;
  const surface = conversationShown ? "banner" : "stage";
  const quiet = heldMs < MATE_VOICE_QUIET_MS;
  const speak = (
    text: string | null,
    actions: ReadonlyArray<ReachabilityAction> = [],
    processes = false,
  ): MateVoice => ({ surface, text, actions, processes });
  const slow = heldMs >= MATE_VOICE_SLOW_MS;
  // Opening it: on the stage, nothing for a blip, then its line and the platform's processes; over
  // a shown conversation, nothing until it is slow. Slow, it offers Try now wherever it speaks.
  const opening = (): MateVoice => {
    if (conversationShown) {
      return slow ? speak(`Opening ${mateName}…`, ["try-now"]) : NONE;
    }
    if (quiet) return speak(null);
    return speak(`Opening ${mateName}…`, slow ? ["try-now"] : [], true);
  };
  // Nothing names its target yet: it is being looked for, which is opening it.
  if (reachability === null) return opening();
  switch (reachability.kind) {
    case "ready":
      return reachability.notice === null
        ? NONE
        : speak(containerWords(reachability.notice, mateName));
    case "container": {
      const container = reachability.container;
      if (
        (container.level === "restarting" || container.level === "updating") &&
        !("overdue" in container && container.overdue === true)
      ) {
        return speak(containerWords(container, mateName));
      }
      const phrase = reachabilityPhrase(reachability, { nowMs, mateName });
      return speak(phrase.text, phrase.actions);
    }
    case "connecting":
    case "resolving": {
      // A wait with a cause of its own says it; the link itself being made says the Mate opens.
      const own =
        reachability.kind === "connecting" &&
        (reachability.waitingOn === "access" || reachability.waitingOn === "visible");
      if (!own) return opening();
      if (conversationShown ? !slow : quiet) return conversationShown ? NONE : speak(null);
      return speak(reachabilityPhrase(reachability, { nowMs, mateName }).text);
    }
    case "reconnecting":
      if (quiet) return conversationShown ? NONE : speak(null);
      // Where its link said when it tries again, the wait is its server not answering.
      return reachability.retryAtMs === undefined
        ? speak(`Reconnecting to ${mateName}…`, ["try-now"])
        : speak(
            `${mateName} isn't answering. Trying again in ${Math.max(1, Math.ceil((reachability.retryAtMs - nowMs) / 1_000))} s.`,
            ["try-now"],
          );
    default: {
      const phrase = reachabilityPhrase(reachability, { nowMs, mateName });
      return speak(phrase.text, phrase.actions);
    }
  }
}

/**
 * What a quiet is kept by: the family of what the voice would say, so a verdict that changes
 * under one line (nothing named yet, resolving, connecting — all "Opening Quinn…") never starts
 * the quiet again and the line never shows, goes and comes back.
 */
export function mateVoiceQuietKey(reachability: Reachability | null): string {
  if (reachability === null) return "opening";
  switch (reachability.kind) {
    case "resolving":
      return "opening";
    case "connecting":
      return reachability.waitingOn === "access" || reachability.waitingOn === "visible"
        ? `connecting:${reachability.waitingOn}`
        : "opening";
    case "container":
      return `container:${reachability.container.level}`;
    case "ready":
      return reachability.notice === null ? "ready" : `container:${reachability.notice.level}`;
    default:
      return reachability.kind;
  }
}

/** Whether the voice has words on the banner: a refused send is then already explained. */
export const mateVoiceSpeaks = (voice: MateVoice): boolean =>
  voice.surface === "banner" && voice.text !== null;
