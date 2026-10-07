/**
 * The project renames Zerops has not taken after a Mate moved or left an application, by project:
 * HQ has the Mate where it is now, its project still carries the old name. One store for every
 * menu of the Mate, so each offers *Finish renaming in Zerops* with the targets planned before the
 * move, and none offers it once the entry is gone.
 */
import { create } from "zustand";
import { onAccountLifetimeClose } from "./accountLifetime";

import type { ProjectRename } from "./projectRenames.logic";

interface UnrenamedProjects {
  readonly left: ReadonlyMap<string, ProjectRename>;
  /** A write to the project's name or application is made: what was left of it is stale. */
  readonly drop: (projectId: string) => void;
  /** After a try at `tried`: the entries of the ones refused stay, the others are done. */
  readonly settle: (
    tried: ReadonlyArray<ProjectRename>,
    refused: ReadonlyArray<ProjectRename>,
  ) => void;
}

export const useUnrenamedProjects = create<UnrenamedProjects>((set) => ({
  left: new Map(),
  drop: (projectId) =>
    set(({ left }) => {
      if (!left.has(projectId)) return {};
      const next = new Map(left);
      next.delete(projectId);
      return { left: next };
    }),
  settle: (tried, refused) =>
    set(({ left }) => {
      const next = new Map(left);
      for (const { projectId } of tried) next.delete(projectId);
      for (const rename of refused) next.set(rename.projectId, rename);
      return { left: next };
    }),
}));

onAccountLifetimeClose(() => useUnrenamedProjects.setState({ left: new Map() }));
