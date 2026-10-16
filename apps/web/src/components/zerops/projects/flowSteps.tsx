/**
 * The pieces the overview's cards draw from: a Mate being created, a group's Mates paired with
 * their environments, and the group's name.
 */

import type { GroupFlowComing, GroupFlowMate } from "@t3tools/client-runtime/zerops";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import { mateBirthFace } from "~/zerops/agentActivity";
import { MateFace, type MateFaceSize } from "../primitives";
import type { ProjectsFlowGroup } from "./ZeropsProjectsFlow";

/** Whether a node would draw anything — a slot may answer `null` for "nothing here". */
export function drawn(node: ReactNode): boolean {
  return node !== null && node !== undefined && node !== false;
}

/**
 * A Mate being created wears the face its person picked in the New Mate
 * dialog — slate where it was given none — waking, as every Mate's is while it
 * comes up (`mateBirthFace`), asleep once its birth stopped: the face is where
 * that is read.
 */
export function ComingMateFace({
  size,
  coming,
}: {
  readonly size: MateFaceSize;
  readonly coming: GroupFlowComing;
}) {
  return (
    <MateFace
      shape={coming.face?.shape}
      size={size}
      state={mateBirthFace(coming.failed === true)}
      tint={coming.face?.tint ?? "slate"}
    />
  );
}

/**
 * One of a group's Mates as a surface draws it: a listed one with its
 * environment, or one being created — no environment yet, only how far its
 * birth has got.
 */
export type FlowMateEntry<T> =
  | { readonly kind: "listed"; readonly item: T; readonly mate: GroupFlowMate }
  | { readonly kind: "coming"; readonly mate: GroupFlowMate; readonly coming: GroupFlowComing };

/**
 * A group's Mates in the flow's order — the listed ones, then the ones being
 * created — each listed one paired with its environment by project.
 */
export function matesOf<T>(entry: ProjectsFlowGroup<T>): ReadonlyArray<FlowMateEntry<T>> {
  return entry.flow.mates.flatMap((mate): ReadonlyArray<FlowMateEntry<T>> => {
    const item = entry.mates.get(mate.projectId);
    if (item !== undefined) return [{ kind: "listed", item, mate }];
    return mate.coming === undefined ? [] : [{ kind: "coming", mate, coming: mate.coming }];
  });
}

export function GroupName<T>({
  entry,
  className,
}: {
  readonly entry: ProjectsFlowGroup<T>;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "min-w-0 truncate font-semibold tracking-tight text-foreground",
        entry.placeholder && "font-normal text-muted-foreground italic",
        className,
      )}
    >
      {entry.group.name}
    </span>
  );
}
