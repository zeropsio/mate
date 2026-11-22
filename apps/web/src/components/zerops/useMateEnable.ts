import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useState } from "react";
import { captureAccountLifetime } from "~/zerops/accountLifetime";
import { useCreateMateBirth } from "~/zerops/useCreateMateBirth";
import { useProjectsInventory } from "~/zerops/projectsInventory";
import { useSharedBirths } from "~/zerops/sharedBirths";
import { useMateWriteAccess } from "./useMateRecoveryAction";

/**
 * One press of Enable: its Create sent and not yet seen as HQ's open birth (`sent`), followed while
 * that birth is open (`following`), or refused with Zerops' or HQ's words.
 */
type Press =
  | { readonly project: string; readonly kind: "sent" | "following" }
  | { readonly project: string; readonly kind: "refused"; readonly message: string };

/**
 * *Enable Zerops Mate* on a Mate's page, where its container's flag reads off: the projects
 * screen's own Create (`useCreateMateBirth`), in the group the projects screen groups it by
 * (`inventoryGroups`). Offered only to a viewer whose role writes its project. Only the Mate's page
 * carries it, so no conversation subscribes to the inventory for it.
 */
export function useMateEnable(projectId: string | null): {
  readonly enable: (() => void) | undefined;
  readonly enabling: boolean;
  readonly refusal: string | null;
} {
  const { rows, candidate, writes } = useMateWriteAccess(projectId);
  const { groups } = useProjectsInventory(rows, BY_NAME);
  const createBirth = useCreateMateBirth({ candidates: rows, groups });
  const births = useSharedBirths();
  const [press, setPress] = useState<Press | null>(null);
  // The press holds until HQ's birth of it has opened and closed again, so a second press never
  // sends a second Create; once it closes, the page's verdict says what follows (its Mate, or
  // Enable again where the flag still reads off).
  if (press !== null && press.kind !== "refused") {
    const open = births.some((birth) => birth.projectId === press.project);
    if (press.kind === "sent" && open) setPress({ project: press.project, kind: "following" });
    if (press.kind === "following" && !open) setPress(null);
  }
  const enable =
    !writes || candidate === undefined
      ? undefined
      : () => {
          const isCurrent = captureAccountLifetime();
          const pressed = candidate.project.id;
          setPress({ project: pressed, kind: "sent" });
          const release = (next: Press | null) => {
            setPress((held) => (held?.project === pressed && held.kind === "sent" ? next : held));
          };
          void createBirth(candidate, isCurrent).then(
            (sent) => {
              if (!sent) release(null);
            },
            (cause: unknown) => {
              release(
                isCurrent()
                  ? { project: pressed, kind: "refused", message: zeropsErrorMessage(cause) }
                  : null,
              );
            },
          );
        };
  const ours = press !== null && press.project === projectId ? press : null;
  return {
    enable,
    enabling: ours !== null && ours.kind !== "refused",
    refusal: ours?.kind === "refused" ? ours.message : null,
  };
}

const BY_NAME = { order: "name" } as const;
