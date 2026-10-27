/** Account tools are HQ records, keyed by Zerops project id. */
import type { ZeropsProject } from "./api.ts";
export type ZeropsToolKind = "gitea";

export function readZeropsToolKind(
  project: Pick<ZeropsProject, "hqTool" | "tagList">,
): ZeropsToolKind | undefined {
  return project.hqTool;
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
    const kind = readZeropsToolKind(project);
    if (kind === undefined) rest.push(project);
    else tools.push({ project, kind });
  }

  tools.sort((left, right) => left.project.name.localeCompare(right.project.name, "en"));
  return { tools, rest };
}
