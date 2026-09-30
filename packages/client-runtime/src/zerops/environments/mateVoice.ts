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
  const opening = (): MateVoice => (quiet ? speak(null) : speak(`Opening ${mateName}…`, [], true));
  // Nothing names its target yet: it is being looked for, which is opening it.
  if (reachability === null) return conversationShown ? NONE : opening();
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
      if (conversationShown) return NONE;
      if (quiet) return opening();
      // A wait with a cause of its own says it; the link itself being made says the Mate opens.
      const own =
        reachability.kind === "connecting" &&
        (reachability.waitingOn === "access" || reachability.waitingOn === "visible");
      if (own) return speak(reachabilityPhrase(reachability, { nowMs, mateName }).text);
      return opening();
    }
    case "reconnecting":
      if (quiet) return conversationShown ? NONE : speak(null);
      return speak(`Reconnecting to ${mateName}…`, ["try-now"]);
    default: {
      const phrase = reachabilityPhrase(reachability, { nowMs, mateName });
      return speak(phrase.text, phrase.actions);
    }
  }
}
