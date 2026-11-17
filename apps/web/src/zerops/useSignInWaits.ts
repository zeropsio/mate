/**
 * The Mates whose agent waits for the viewer's own sign-in: what waits on the viewer counts it
 * (`useViewerWaits`), and *Add a Mate* says it is why the project takes no other Mate yet
 * (`useNewMateGate`).
 */
import { useAtomValue } from "@effect/atom-react";
import {
  accountReadsAtom,
  hqProjectPersonAtom,
  mateAdmissionSummary,
} from "@t3tools/client-runtime/data";
import { hasMate, projectNameInApp, readZeropsMembership } from "@t3tools/client-runtime/zerops";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { Atom } from "effect/reactivity";
import { useCallback, useMemo } from "react";

import { signInAwaitedBy } from "~/components/zerops/SidebarMateRow.logic";
import { sameValue } from "~/lib/sameValue";

import { mateDeleting, useDeletingMates } from "./deletingMates";
import { useZeropsSessionOptional } from "./sessionContext";

const NO_SIGN_INS: Readonly<Record<string, string>> = {};

/**
 * The Mates whose agent waits for the viewer's own sign-in, by project, in its composer's words
 * (`mateAdmissionSummary`): its link is made, so its page can show the sign-in; no login of its
 * agent can run; and the sign-in is the viewer's to make (`signInAwaitedBy`). A Mate this tab is
 * deleting waits on nobody.
 */
function signInWaitsAtom(
  candidates: ReadonlyArray<ZeropsCandidate>,
  viewer: string | undefined,
  deleting: ReadonlySet<string>,
) {
  return Atom.make((get): Readonly<Record<string, string>> => {
    const account = get(accountReadsAtom);
    const orgId = account?.orgId;
    if (account == null || orgId == null || viewer === undefined) return NO_SIGN_INS;
    const waits: Record<string, string> = {};
    for (const candidate of candidates) {
      const projectId = candidate.project.id;
      if (!hasMate(candidate) || candidate.group !== "connected") continue;
      if (mateDeleting(candidate.project, deleting)) continue;
      const tags = readZeropsMembership(candidate.project);
      const awaited = signInAwaitedBy({
        ownerUserId: get(hqProjectPersonAtom(projectId))?.owner?.userId,
        madeBy: tags.madeBy,
        standUpBy: tags.standUp?.by,
      });
      if (awaited !== viewer) continue;
      const admission = get(
        account.data.project(mateAdmissionSummary, {
          orgId,
          projectId,
          mateName: projectNameInApp(candidate.project),
          viewerSubject: undefined,
        }),
      );
      if (admission !== null) waits[projectId] = admission.text;
    }
    return Object.keys(waits).length === 0 ? NO_SIGN_INS : waits;
  }).pipe(Atom.withEquality(sameValue));
}

/** `signInWaitsAtom`, for the candidates a surface holds. */
export function useSignInWaits(
  candidates: ReadonlyArray<ZeropsCandidate>,
): (candidate: ZeropsCandidate) => string | undefined {
  const viewer = useZeropsSessionOptional()?.user?.id;
  const deleting = useDeletingMates();
  const waits = useAtomValue(
    useMemo(() => signInWaitsAtom(candidates, viewer, deleting), [candidates, deleting, viewer]),
  );
  return useCallback((candidate: ZeropsCandidate) => waits[candidate.project.id], [waits]);
}
