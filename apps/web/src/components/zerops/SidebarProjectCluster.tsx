/**
 * A group's faces, as the menu's group row and the closed menu's group tile wear them.
 */
import type { MateMarkState, MateShapeId, MateTintId } from "@t3tools/shared/brand";

import { MateOwnerMark } from "./MateOwnerMark";
import { MateFace } from "./primitives";
import type { BadgeSeat } from "./SidebarMateRow.logic";

/** One face in a group's avatar, as its own row would wear it. */
export interface ClusterFace {
  readonly projectId: string;
  readonly name: string;
  readonly tint: MateTintId;
  readonly shape: MateShapeId;
  readonly state: MateMarkState;
  /** Its state was read, not remembered: only then does it greet a change. */
  readonly known: boolean;
  /** A colleague's: their mark on its corner, its face paler. */
  readonly badge: BadgeSeat | null;
}

/**
 * A group's faces in the face's column (the owner, 2026-10-12: "when more it would be project"):
 * two on the diagonal, three as a triangle, the lead in front — the one that asks the viewer, else
 * the one at work, else the newest words — and past three, how many more. Each wears its row's
 * state and its owner's mark, ringed in the menu's ground where they overlap. When the lead
 * changes, the faces travel to their new places.
 */
export function ProjectCluster({
  faces,
  more,
}: {
  readonly faces: ReadonlyArray<ClusterFace>;
  readonly more: number;
}) {
  const place = new Map(faces.map((face, index) => [face.projectId, index]));
  // Drawn in one order whoever leads, so a new lead travels rather than being drawn anew.
  const drawn = faces.toSorted((left, right) => left.projectId.localeCompare(right.projectId));
  return (
    <span
      aria-hidden="true"
      className="menu-cluster"
      data-count={String(Math.min(faces.length, 3))}
      data-zerops-surface="sidebar-project-faces"
    >
      {drawn.map((face) => (
        <span
          className="menu-cluster-face"
          data-place={String(place.get(face.projectId) ?? 0)}
          key={face.projectId}
        >
          <MateFace
            className="size-full"
            greets
            known={face.known}
            shape={face.shape}
            size={24}
            state={face.state}
            tint={face.tint}
          />
          {face.badge === null ? null : (
            <MateOwnerMark className="menu-cluster-owner" seat={face.badge} />
          )}
        </span>
      ))}
      {more > 0 ? <span className="menu-cluster-more">{`+${String(more)}`}</span> : null}
    </span>
  );
}
