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
  const count = Math.min(faces.length, 3);
  return (
    <span
      aria-hidden="true"
      className="relative block size-9"
      data-zerops-surface="sidebar-project-faces"
    >
      {drawn.map((face) => {
        const at = place.get(face.projectId) ?? 0;
        // A person stands only on the cluster's outer corner, the seat a lone Mate's wears: the
        // face there carries its owner, and a face in front would set its owner in the cluster's
        // middle (the owner, 2026-10-12). With a "+N" in that corner, none does.
        const outer = count === 2 ? at === 1 : count === 3 ? at === 2 : true;
        return (
          <span className={clusterPlace(count, at)} key={face.projectId}>
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
              <MateOwnerMark
                className={
                  outer && more === 0
                    ? "top-auto -right-0.5 -bottom-0.5 left-auto size-3.5 text-4xs ring-2 ring-(--menu-ground) transition-opacity duration-200 ease-out-strong"
                    : "top-auto -right-0.5 -bottom-0.5 left-auto size-3.5 text-4xs opacity-0 ring-2 ring-(--menu-ground) transition-opacity duration-200 ease-out-strong"
                }
                seat={face.badge}
              />
            )}
          </span>
        );
      })}
      {more > 0 ? (
        <span className="absolute -right-2.75 -bottom-1.5 z-4 grid h-4 min-w-5.5 place-items-center rounded-full bg-sidebar-row-active px-1 text-3xs leading-4 font-semibold text-sidebar-foreground tabular-nums ring-2 ring-(--menu-ground)">{`+${String(more)}`}</span>
      ) : null}
    </span>
  );
}

/**
 * A face's place: two at 24 px on the diagonal, three at 21 px as a triangle, the lead in front;
 * each ringed in the ground (`--menu-ground`) where they overlap, travelling to its new place when
 * the lead changes.
 */
const CLUSTER_FACE =
  "absolute top-0 left-0 block motion-safe:transition-[translate] motion-safe:duration-200 motion-safe:ease-out-strong [&_[data-mate-face-body]_path]:stroke-(--menu-ground) [&_[data-mate-face-body]_path]:stroke-3 [&_[data-mate-face-body]_path]:[paint-order:stroke] [&_[data-mate-face-body]_path]:[stroke-linejoin:round] [&_[data-mate-face-body]_path]:[vector-effect:non-scaling-stroke] [&_[data-mate-face-body]_svg]:overflow-visible";

const PLACES: Readonly<Record<number, ReadonlyArray<string>>> = {
  2: [`${CLUSTER_FACE} z-3 size-6`, `${CLUSTER_FACE} z-2 size-6 translate-3`],
  3: [
    `${CLUSTER_FACE} z-3 size-5.25 translate-x-[7.5px]`,
    `${CLUSTER_FACE} z-2 size-5.25 translate-y-3.75`,
    `${CLUSTER_FACE} z-1 size-5.25 translate-3.75`,
  ],
};

function clusterPlace(count: number, at: number): string {
  return PLACES[count]?.[at] ?? `${CLUSTER_FACE} size-6`;
}
