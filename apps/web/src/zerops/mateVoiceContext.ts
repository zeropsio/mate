/**
 * The route's Mate link voice (`mateVoice`), for the one banner over the composer that speaks it:
 * the route gate reads the link once and hands its words down to the conversation it mounts.
 */
import type { WebMateVoice as MateVoice } from "./mateNoticeVoice";
import { createContext, useContext, useState } from "react";

import { sameValue } from "../lib/sameValue";

const SILENT: MateVoice = { surface: "none" };

export const MateVoiceContext = createContext<MateVoice>(SILENT);

export function useMateVoice(): MateVoice {
  return useContext(MateVoiceContext);
}

/**
 * The voice as it last stood, for as long as it says the same. The root reads the link again
 * whenever the route moves and hands down a new object with the same words: a switch between two
 * conversations rendered everything that hears the voice, the conversation's view among it, once
 * more before the conversation changed.
 */
export function useStandingVoice(voice: MateVoice): MateVoice {
  const [standing, setStanding] = useState(voice);
  if (standing === voice || sameValue(standing, voice)) return standing;
  setStanding(voice);
  return voice;
}
