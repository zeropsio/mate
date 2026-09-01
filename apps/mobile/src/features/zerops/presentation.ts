import type { ZeropsCandidateGroup } from "@t3tools/client-runtime/zerops/candidates";

export function zeropsCandidatePresentation(group: ZeropsCandidateGroup) {
  switch (group) {
    case "connected":
      return { label: "Connected", tone: "ok", action: "Open" } as const;
    case "ready":
      return { label: "Ready", tone: "busy", action: "Connect" } as const;
    case "provisioning":
      return { label: "Starting", tone: "attention", action: null } as const;
    case "unavailable":
      return { label: "Unavailable", tone: "off", action: null } as const;
  }
}
