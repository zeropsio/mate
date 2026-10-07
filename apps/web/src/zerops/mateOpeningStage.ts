/** Whether the link verdict has a state line for the Mate's conversation composition. */
import type { MateVoice } from "@t3tools/client-runtime/zerops/environments";

type Spoken = Exclude<MateVoice, { readonly surface: "none" }>;

export function stageSpeaks(voice: Spoken): boolean {
  // A diagnostic-only line does not supply the composition's headline.
  return voice.text !== null && !voice.processes;
}
