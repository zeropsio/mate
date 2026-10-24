/** The menu's top and the Chief page read the organisation's Chief from the shared account data layer. */
import { useAtomValue } from "@effect/atom-react";
import { shownHqMateDirectoryAtom } from "@t3tools/client-runtime/data";
import { Atom } from "effect/reactivity";
import { useMemo } from "react";

import { mayRemoveChief } from "../components/zerops/chief/chiefTop.logic";
import { HQ_UNFOLLOWED, useAccountOperationsOptional } from "./accountOperations";
import type { OrgChief } from "./chief";
import { usePlatformCapabilities } from "./usePlatformCapabilities";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

export const orgChiefAtom = Atom.make((get): OrgChief => {
  const { chief } = get(shownHqMateDirectoryAtom);
  return chief.kind === "present" ? chief.projectId : chief.kind === "absent" ? null : undefined;
});

export function useOrgChief(): OrgChief {
  return useAtomValue(orgChiefAtom);
}

/**
 * Removing the organisation's mark (`remove-chief`), for the Chief row's *Remove as Chief*: absent
 * where there is no mark, or this viewer is not known as an Owner or Admin (`mayRemoveChief`).
 */
export function useChiefRemoval(): (() => void) | undefined {
  const capabilities = usePlatformCapabilities(null);
  const operations = useAccountOperationsOptional();
  const orgId = useZeropsSessionOptional()?.activeOrganization?.id ?? null;
  const chief = useOrgChief();
  const offered = mayRemoveChief(capabilities);
  return useMemo(
    () =>
      !offered || operations === null || orgId === null || chief == null
        ? undefined
        : () => {
            void operations.run(
              { kind: "remove-chief", orgId },
              { orgId, unobserved: HQ_UNFOLLOWED },
            );
          },
    [chief, offered, operations, orgId],
  );
}
