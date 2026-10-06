/**
 * The sole project-record writer: serialized per project across this browser's tabs, based on
 * a fresh platform read. Zerops owns the name; only the Mate marker is written to tags, beside the
 * project's own.
 * One PUT and one read-back: a concurrent replacement fails visibly for a manual Again.
 */
import type { ZeropsApiClient, ZeropsProject } from "../api.ts";
import { applyProjectTagPatch, sameProjectTags, type ProjectTagPatch } from "./tagPatch.ts";
import type { AdapterError } from "./types.ts";

/** The reads and the one PUT the writer makes. */
export type ProjectTagSource = Pick<ZeropsApiClient, "fetchProject" | "writeProject">;

/** The page's exclusive locks (`navigator.locks`): `hold` runs once the lock is this tab's. */
export interface ProjectTagLocks {
  readonly request: <T>(name: string, hold: () => Promise<T>) => Promise<T>;
}

export const projectTagsLockName = (projectId: string): string => `mate:tags:${projectId}`;

export type ProjectTagWrite =
  /** The change is on the project now; `project` is the read that confirmed it. */
  | { readonly kind: "written"; readonly project: ZeropsProject }
  /** The project already held it: nothing was written. */
  | { readonly kind: "unchanged"; readonly project: ZeropsProject };

export interface ProjectTagWriter {
  readonly write: (projectId: string, patch: ProjectTagPatch) => Promise<ProjectTagWrite>;
  /**
   * Names the project `name`, its tags put back as a fresh read holds them. With `from`, only a
   * project that is still named so: one renamed since is refused before anything is written.
   */
  readonly rename: (
    projectId: string,
    name: string,
    options?: { readonly from?: string | undefined },
  ) => Promise<ProjectTagWrite>;
}

const replacedTooOften = (what: "tags" | "name"): AdapterError => ({
  _tag: "ZeropsDataAdapterError",
  kind: "rejected",
  message:
    what === "tags"
      ? "This project's tags changed after the write. Try again."
      : "This project's name changed after the write. Try again.",
  retryable: true,
  accountRevocationEvidence: false,
});

const renamedSince: AdapterError = {
  _tag: "ZeropsDataAdapterError",
  kind: "rejected",
  message: "This project was renamed since. Nothing was changed.",
  retryable: false,
  accountRevocationEvidence: false,
};

export function makeProjectTagWriter(options: {
  readonly source: ProjectTagSource;
  /** Absent where the platform has none: one page, serialized in memory. */
  readonly locks?: ProjectTagLocks | undefined;
}): ProjectTagWriter {
  const { source, locks } = options;
  const queues = new Map<string, Promise<void>>();

  const serialized = <T>(projectId: string, run: () => Promise<T>): Promise<T> => {
    const held = () =>
      locks === undefined ? run() : locks.request(projectTagsLockName(projectId), run);
    const next = (queues.get(projectId) ?? Promise.resolve()).then(held);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    queues.set(projectId, settled);
    void settled.then(() => {
      if (queues.get(projectId) === settled) queues.delete(projectId);
    });
    return next;
  };

  return {
    write: (projectId, patch) =>
      serialized(projectId, async () => {
        const project = await source.fetchProject(projectId);
        const next = applyProjectTagPatch(project.tagList ?? [], patch);
        if (sameProjectTags(next, project.tagList ?? [])) return { kind: "unchanged", project };
        await source.writeProject(project, { name: project.name, tagList: next });
        const confirmed = await source.fetchProject(projectId);
        if (!sameProjectTags(confirmed.tagList ?? [], next)) throw replacedTooOften("tags");
        return { kind: "written", project: confirmed };
      }),
    rename: (projectId, name, writeOptions = {}) =>
      serialized(projectId, async () => {
        const { from } = writeOptions;
        const project = await source.fetchProject(projectId);
        if (project.name === name) return { kind: "unchanged", project };
        if (from !== undefined && project.name.trim() !== from.trim()) throw renamedSince;
        // Every tag the fresh read — under the lock, just before the PUT — holds goes back as it
        // is: a rename writes no tag.
        await source.writeProject(project, { name, tagList: project.tagList ?? [] });
        const confirmed = await source.fetchProject(projectId);
        if (confirmed.name !== name) throw replacedTooOften("name");
        // Another record written over ours may have dropped the Mate's marker: said, never kept.
        const marked = (tags: ReadonlyArray<string> | undefined) => tags?.includes("mate") === true;
        if (marked(project.tagList) && !marked(confirmed.tagList)) throw replacedTooOften("tags");
        return { kind: "written", project: confirmed };
      }),
  };
}
