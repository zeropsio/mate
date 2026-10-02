/**
 * Whether a Mate's stage has words of its own while its conversation cannot show (a reload before
 * the catalog names its thread, a link being made): a restart, a reconnect, a container that is
 * not running — then the stage says them with the Mate's face asleep over its name. Opening it has
 * none of its own: the page waits quietly under its header with its one line
 * (`openingConversationLine`), and the link's "Opening Quinn…" is that line — with the platform's
 * processes and Try now under it once it is slow. Pure.
 */
import type { MateVoice } from "@t3tools/client-runtime/zerops/environments";

type Spoken = Exclude<MateVoice, { readonly surface: "none" }>;

export function stageSpeaks(voice: Spoken): boolean {
  // Only opening a link lists the platform's processes (`mateVoice`).
  return voice.text !== null && !voice.processes;
}
