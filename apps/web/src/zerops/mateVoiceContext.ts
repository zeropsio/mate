/**
 * The route's Mate link voice (`mateVoice`), for the one banner over the composer that speaks it:
 * the route gate reads the link once and hands its words down to the conversation it mounts.
 */
import type { WebMateVoice as MateVoice } from "./mateNoticeVoice";
import { createContext, useContext } from "react";

const SILENT: MateVoice = { surface: "none" };

export const MateVoiceContext = createContext<MateVoice>(SILENT);

export function useMateVoice(): MateVoice {
  return useContext(MateVoiceContext);
}
