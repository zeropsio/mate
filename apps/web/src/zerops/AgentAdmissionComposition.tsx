import { createContext, useContext, type ReactNode } from "react";
import type { AgentAdmissionAttention } from "@t3tools/client-runtime/data";

/** The signed-in shell delegates this subject to the conversation's existing input region. */
const AdmissionRegion = createContext<"composer" | null>(null);
export function AgentAdmissionComposition({ children }: { readonly children: ReactNode }) {
  return <AdmissionRegion.Provider value="composer">{children}</AdmissionRegion.Provider>;
}
export function useAgentAdmissionPlacement(attention: AgentAdmissionAttention | null) {
  const region = useContext(AdmissionRegion);
  return {
    composer: region === "composer" ? attention : null,
  };
}
