import {
  applyProjectTagPatch,
  sameProjectTags,
  type ProjectTagPatch,
  type ProjectTagWrite,
} from "@t3tools/client-runtime/zerops/data";
import { vi } from "vite-plus/test";

import type { ProjectTagsWrite } from "../brokerGrant";

/**
 * `updateProjectTags` over one project's tags held here: each patch meets the list as it is now,
 * the way the TagWriter applies it to a fresh read.
 */
export function tagsFake(initial: ReadonlyArray<string>) {
  let tags = initial;
  const writeTags = vi.fn<ProjectTagsWrite>(
    async (projectId: string, patch: ProjectTagPatch): Promise<ProjectTagWrite> => {
      const project = { id: projectId, name: "Gitea", status: "ACTIVE", tagList: tags };
      const next = applyProjectTagPatch(tags, patch);
      if (!next.ok) return { kind: "refused", refusal: next.refusal, project };
      if (sameProjectTags(next.tags, tags)) return { kind: "unchanged", project };
      tags = next.tags;
      return { kind: "written", project: { ...project, tagList: tags } };
    },
  );
  return { writeTags, tags: () => tags };
}
