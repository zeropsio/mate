/**
 * Forgets a registered environment whose project no longer exists.
 *
 * A registration outlives its container: delete the project on the platform
 * and the client keeps a target that reconnects forever, its cached projects
 * and drafts still on disk. Nothing in the account can explain that row, and
 * a person should not have to find the Devices screen to make it stop. So
 * once the account has been read cleanly, an environment that came in through
 * the Zerops door, cannot connect, and resolves to a project the account no
 * longer has, is removed — with the project it remembered.
 *
 * Deliberately narrow: only a failing socket, only a project this
 * organization knew about, only after a load with no error, once per session.
 * A live environment is never touched, and neither is one whose project we
 * simply have not learned.
 */

import { useEffect, useRef } from "react";

import {
  forgetEnvironmentProjectRef,
  lookupEnvironmentProjectRef,
} from "@t3tools/client-runtime/zerops/environmentProjectRef";

import { environmentCatalog } from "~/connection/catalog";
import { useEnvironments } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";

import { connectionOriginFor } from "./firstPromptStorage";
import { browserZeropsStorage } from "./storage";
import type { ZeropsCandidatePresentation } from "./useZeropsCandidates";

export function useZeropsDeadEnvironmentReaper(input: {
  readonly candidates: ReadonlyArray<ZeropsCandidatePresentation>;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly activeOrgId: string | null;
  readonly enabled: boolean;
}): void {
  const { environments } = useEnvironments();
  const remove = useAtomCommand(environmentCatalog.remove, { reportFailure: false });
  const attemptedRef = useRef(new Set<string>());
  const { activeOrgId, candidates, enabled, error, isLoading } = input;

  useEffect(() => {
    if (!enabled || isLoading || error !== null || activeOrgId === null) return;
    const knownProjectIds = new Set(candidates.map((candidate) => candidate.project.id));
    let cancelled = false;

    for (const environment of environments) {
      const id = String(environment.environmentId);
      const phase = environment.connection.phase;
      if (phase !== "reconnecting" && phase !== "error") continue;
      if (connectionOriginFor(id) !== "zerops-identity") continue;
      if (attemptedRef.current.has(id)) continue;
      attemptedRef.current.add(id);

      void lookupEnvironmentProjectRef(browserZeropsStorage, environment.environmentId).then(
        async (ref) => {
          if (cancelled || ref === undefined) return;
          if (ref.orgId !== activeOrgId || knownProjectIds.has(ref.projectId)) return;
          await remove(environment.environmentId);
          await forgetEnvironmentProjectRef(browserZeropsStorage, environment.environmentId);
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [activeOrgId, candidates, enabled, environments, error, isLoading, remove]);
}
