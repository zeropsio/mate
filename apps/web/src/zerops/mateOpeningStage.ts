/**
 * What a Mate's stage says while its conversation's route cannot draw the conversation yet (a
 * reload, before the catalog names its thread): the route's own link voice where it has words — a
 * restart, a reconnect — moved onto the stage, since no conversation is shown to carry a banner;
 * else nothing for a blip and "Opening Quinn…" past it (`mateVoice`'s first connect). Pure.
 */
import type { MateVoice } from "@t3tools/client-runtime/zerops/environments";

type Spoken = Exclude<MateVoice, { readonly surface: "none" }>;

export function mateOpeningStage(input: {
  /** The route's link voice (`useMateVoice`). */
  readonly voice: MateVoice;
  /** The route has waited past the quiet (`MATE_VOICE_QUIET_MS`). */
  readonly pastQuiet: boolean;
  readonly mateName: string;
}): Spoken {
  const { voice } = input;
  if (voice.surface !== "none" && voice.text !== null) return { ...voice, surface: "stage" };
  return input.pastQuiet
    ? { surface: "stage", text: `Opening ${input.mateName}…`, actions: [], processes: false }
    : { surface: "stage", text: null, actions: [], processes: false };
}
