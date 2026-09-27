/**
 * The crew on a sidebar Mate row (PRD §4.2, seam S8): while a crew is applied,
 * a small stack of its crewmates' faces after the Mate — at most three, the
 * lead first, then "+2" — each wearing its thread's face and opening that
 * crewmate's chat. Nothing at all while there is no crew, so a Mate without
 * one keeps its row exactly as it was.
 */
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { buildThreadRouteParams } from "../../../threadRoutes";
import { useCrew } from "../../../zerops/crew/useCrew";
import { MateFace } from "../primitives";
import { crewFaceStack } from "./CrewSection.logic";

export function SidebarCrewFaces({ environmentId }: { readonly environmentId: EnvironmentId }) {
  const { status, view } = useCrew(environmentId);
  const navigate = useNavigate();
  if (status !== "applied" || view === null || view.crewmates.length === 0) return null;
  const { faces, more } = crewFaceStack(view.crewmates);
  return (
    <span className="flex shrink-0 items-center pe-2.5" data-zerops-surface="sidebar-mate-crew">
      <span className="flex -space-x-1.5">
        {faces.map((face) =>
          face.threadId === null ? (
            <span className="flex rounded-full ring-2 ring-sidebar" key={face.handle}>
              <MateFace size="sm" state={face.state} tint={face.tint} />
            </span>
          ) : (
            <button
              aria-label={`Open ${face.displayName}`}
              className="flex cursor-pointer rounded-full ring-2 ring-sidebar outline-none focus-visible:ring-ring"
              key={face.handle}
              onClick={() => {
                const threadId = face.threadId;
                if (threadId === null) return;
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: buildThreadRouteParams(scopeThreadRef(environmentId, threadId)),
                });
              }}
              type="button"
            >
              <MateFace size="sm" state={face.state} tint={face.tint} />
            </button>
          ),
        )}
      </span>
      {more === 0 ? null : (
        <span className="ms-1 text-xs text-sidebar-muted-foreground tabular-nums">{`+${more}`}</span>
      )}
    </span>
  );
}
