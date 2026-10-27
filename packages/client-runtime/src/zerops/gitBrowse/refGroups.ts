/**
 * A page of refs as the picker groups them: Mate's own branches, its changes' branches, and what
 * HQ follows from GitHub; tags, and GitHub's. Each group keeps HQ's order.
 *
 * @module zerops/gitBrowse/refGroups
 */
import type { GitRefItem } from "@t3tools/shared/hqGitBrowse/refs";

export type GitRefGroupName = "Branches" | "Changes" | "Tags" | "From GitHub";

export interface GitRefGroup {
  readonly name: GitRefGroupName;
  readonly items: ReadonlyArray<GitRefItem>;
}

const GROUP: Record<GitRefItem["kind"], GitRefGroupName> = {
  branch: "Branches",
  change: "Changes",
  tag: "Tags",
  "github-branch": "From GitHub",
  "github-tag": "From GitHub",
  commit: "Branches",
};
const ORDER: ReadonlyArray<GitRefGroupName> = ["Branches", "Changes", "Tags", "From GitHub"];

export const refGroups = (items: ReadonlyArray<GitRefItem>): ReadonlyArray<GitRefGroup> =>
  ORDER.flatMap((name) => {
    const grouped = items.filter((item) => GROUP[item.kind] === name);
    return grouped.length === 0 ? [] : [{ name, items: grouped }];
  });
