/**
 * The TagWriter behind `updateProjectTags` (DESIGN §2.B B2, §6.5, §9 C12): the one writer of a
 * project's `tagList`.
 *
 * The platform has no conditional PUT and replaces the list wholesale, so every write is a
 * read-modify-write, and this is the only one:
 *
 * - **Serialized per project**, in this tab and — through Web Lock `mate:tags:<projectId>` — across
 *   the tabs of the browser. Two of our writers never interleave a read and a write.
 * - **Applied to a fresh read.** The patch meets the list as the platform holds it inside the
 *   lock, so every tag written since a caller last looked survives.
 * - **Verified by reading back.** The list is read again after the PUT; if another writer's whole
 *   list replaced ours in between, the patch no longer holds and is applied again to what is
 *   there now, a bounded number of times.
 *
 * What remains is the window between one read and its PUT, against a writer on another device
 * (C12): the same tag written by both is last-writer-wins, and a disjoint tag that writer added
 * in that window is lost with it.
 */
import type { ZeropsApiClient, ZeropsProject } from "../api.ts";
import {
  applyProjectTagPatch,
  sameProjectTags,
  type ProjectTagPatch,
  type ProjectTagRefusal,
} from "./tagPatch.ts";
import type { AdapterError } from "./types.ts";

/** The reads and the one PUT the writer makes. */
export type ProjectTagSource = Pick<ZeropsApiClient, "fetchProject" | "writeProjectTags">;

/** The page's exclusive locks (`navigator.locks`): `hold` runs once the lock is this tab's. */
export interface ProjectTagLocks {
  readonly request: <T>(name: string, hold: () => Promise<T>) => Promise<T>;
}

export const projectTagsLockName = (projectId: string): string => `mate:tags:${projectId}`;

export type ProjectTagWrite =
  /** The patch is on the project now; `project` is the read that confirmed it. */
  | { readonly kind: "written"; readonly project: ZeropsProject }
  /** The project already held it: nothing was written. */
  | { readonly kind: "unchanged"; readonly project: ZeropsProject }
  /** The list as read does not take the patch; nothing was written. */
  | {
      readonly kind: "refused";
      readonly refusal: ProjectTagRefusal;
      readonly project: ZeropsProject;
    };

export interface ProjectTagWriter {
  readonly write: (
    projectId: string,
    patch: ProjectTagPatch,
    options?: {
      readonly signal?: AbortSignal | undefined;
      /** Runs before each PUT: the write's admission, asked again at the moment it is sent. */
      readonly beforeWrite?: (() => Promise<void>) | undefined;
    },
  ) => Promise<ProjectTagWrite>;
}

/** PUTs one patch may make: the first, and a retry for each writer that replaced it. */
export const PROJECT_TAG_WRITE_ATTEMPTS = 3;

const replacedTooOften: AdapterError = {
  _tag: "ZeropsDataAdapterError",
  kind: "rejected",
  message: "This project's tags kept changing while they were being written. Try again.",
  retryable: true,
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
    write: (projectId, patch, writeOptions = {}) =>
      serialized(projectId, async () => {
        const { signal, beforeWrite } = writeOptions;
        let project = await source.fetchProject(projectId, signal);
        for (let written = 0; ; written += 1) {
          const current = project.tagList ?? [];
          const next = applyProjectTagPatch(current, patch);
          if (!next.ok) return { kind: "refused", refusal: next.refusal, project };
          if (sameProjectTags(next.tags, current))
            return { kind: written === 0 ? "unchanged" : "written", project };
          if (written === PROJECT_TAG_WRITE_ATTEMPTS) throw replacedTooOften;
          await source.writeProjectTags(project, next.tags, signal, beforeWrite);
          project = await source.fetchProject(projectId, signal);
        }
      }),
  };
}
