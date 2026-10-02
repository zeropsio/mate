/**
 * Tools — the things an account runs *for itself* rather than as part of any
 * one application. That was main's Gitea: the git host its Mates pushed to,
 * with the broker beside it. A Mate account that ran main still has that
 * project, and it stays as it is — so the client keeps telling it apart and
 * never draws it as an application or writes to it.
 *
 * A tool is a Zerops project like any other, marked with `mate:tool:<kind>`.
 * That keeps it out of the group tree without inventing a second storage
 * mechanism — the same tag read that builds the left menu also finds the
 * tools, in one pass over one list.
 *
 * ## Why a tool is not a group environment
 *
 * A group's environments are copies of one application at different stages; a
 * tool is a singleton the whole account shares, and it has no dev/stage/prod
 * axis. So the two are disjoint by rule: a project carrying a tool tag is a
 * tool even if it also carries a group tag, and `deriveZeropsGroups` never
 * sees it.
 *
 * @module tools
 */

import type { ZeropsProject } from "./api.ts";
import { MATE_TAG_NAMESPACE } from "./groups.ts";

const TOOL_TAG_PREFIX = `${MATE_TAG_NAMESPACE}:tool:`;

/** The tools this product knows how to stand up. One, so far. */
export type ZeropsToolKind = "gitea";

const TOOL_KINDS: ReadonlySet<string> = new Set<ZeropsToolKind>(["gitea"]);

function isToolKind(value: string): value is ZeropsToolKind {
  return TOOL_KINDS.has(value);
}

/** The tool this project *is*, or `undefined` for an ordinary project. */
export function readZeropsToolKind(
  tagList: ReadonlyArray<string> | undefined,
): ZeropsToolKind | undefined {
  for (const tag of tagList ?? []) {
    if (!tag.startsWith(TOOL_TAG_PREFIX)) continue;
    const value = tag.slice(TOOL_TAG_PREFIX.length);
    if (isToolKind(value)) return value;
  }
  return undefined;
}

export interface ZeropsToolProject {
  readonly project: ZeropsProject;
  readonly kind: ZeropsToolKind;
}

/**
 * Splits the account's projects into the tools among them and the rest. The
 * remainder is what {@link deriveZeropsGroups} should be handed, so a tool
 * never appears as somebody's environment.
 */
export function partitionZeropsToolProjects(projects: ReadonlyArray<ZeropsProject>): {
  readonly tools: ReadonlyArray<ZeropsToolProject>;
  readonly rest: ReadonlyArray<ZeropsProject>;
} {
  const tools: Array<ZeropsToolProject> = [];
  const rest: Array<ZeropsProject> = [];

  for (const project of projects) {
    const kind = readZeropsToolKind(project.tagList);
    if (kind === undefined) rest.push(project);
    else tools.push({ project, kind });
  }

  tools.sort((left, right) => left.project.name.localeCompare(right.project.name, "en"));
  return { tools, rest };
}
