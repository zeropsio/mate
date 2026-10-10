/**
 * The closed menu on a desktop: a 64 px rail of faces. From the top the mark, the waiting count,
 * Overview, then the Mates' faces grouped by project — a hairline between projects — and at the
 * foot the viewer's photo and the open button. A face wears a small dot when its Mate waits on
 * the viewer, failed, or has a result not yet seen.
 */

/** The dot on a rail face: amber waits on you, red failed, blue a result not yet seen. */
export type RailDot = "attention" | "failed" | "unread";

export function railDot(input: {
  readonly waits: boolean;
  readonly failed: boolean;
  readonly unread: boolean;
}): RailDot | undefined {
  if (input.waits) return "attention";
  if (input.failed) return "failed";
  if (input.unread) return "unread";
  return undefined;
}

/**
 * The faces in the menu's order, one group per project in the order the projects come; a Mate the
 * menu has not drawn yet goes with its project, or last.
 */
export function railGroups<M extends { readonly projectId: string; readonly groupId: string }>(
  mates: ReadonlyArray<M>,
  order: ReadonlyArray<string>,
): ReadonlyArray<ReadonlyArray<M>> {
  const place = (projectId: string) => {
    const at = order.indexOf(projectId);
    return at === -1 ? Number.MAX_SAFE_INTEGER : at;
  };
  const groups = new Map<string, M[]>();
  for (const mate of mates.toSorted(
    (left, right) => place(left.projectId) - place(right.projectId),
  )) {
    const group = groups.get(mate.groupId);
    if (group === undefined) groups.set(mate.groupId, [mate]);
    else group.push(mate);
  }
  return [...groups.values()];
}
