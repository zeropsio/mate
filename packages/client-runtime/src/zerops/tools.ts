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

import { servicePortOrigin, type ZeropsProject, type ZeropsService } from "./api.ts";
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
 * Gitea's port, from `zeropsio/recipe-gitea`: `app.ini` serves HTTP on 3000
 * and the built-in SSH server on 2222.
 */
const GITEA_HTTP_PORT = 3000;

/** The service hostnames of the Gitea project (`zeropsio/gitea-mate`, `import/gitea-project.yaml`). */
const GITEA_WEB_SERVICE = "web";
const GITEA_BROKER_SERVICE = "broker";
/** The port the broker publishes (its `LISTEN_ADDR`). */
const GITEA_BROKER_PORT = 8080;

export interface ZeropsGiteaState {
  readonly project: ZeropsProject;
  /** `https://web-<subdomain>-3000.<region>.zerops.app`, once the platform has assigned one. */
  readonly url: string | undefined;
  /**
   * `https://broker-<subdomain>-8080.<region>.zerops.app`, once the platform
   * has assigned one — where Gitea's sign-in is completed (guide 1.5, 3.6).
   *
   * Derived exactly as the Gitea URL is, from the project and the service's
   * own port, so an account on a devel region or behind a custom domain is
   * read rather than guessed.
   */
  readonly brokerUrl: string | undefined;
}

/**
 * A service the user asked for, as opposed to one the platform made for
 * itself. Build and prepare containers show up in a project's service list
 * under generated names (`buildwebv1788602355`, `preparewebv11788602377`,
 * observed 2026-09-05) and would otherwise be read as part of the recipe.
 */
function userServices(services: ReadonlyArray<ZeropsService>): ReadonlyArray<ZeropsService> {
  return services.filter((service) => service.isSystem !== true);
}

function findService(
  services: ReadonlyArray<ZeropsService>,
  name: string,
): ZeropsService | undefined {
  return userServices(services).find((service) => service.name === name);
}

function servicePublicOrigin(
  project: ZeropsProject,
  service: ZeropsService | undefined,
  portNumber: number,
): string | undefined {
  if (service === undefined) return undefined;
  const port = service.ports?.find((candidate) => candidate.port === portNumber) ?? {
    port: portNumber,
    httpSupport: true,
    scheme: "http",
  };
  return servicePortOrigin(project, service, port);
}

/**
 * Where an account's Gitea and its broker answer, from one project read and one
 * service-stack read: what the release forge and the Gitea sign-in still read.
 */
export function deriveGiteaState(
  project: ZeropsProject,
  services: ReadonlyArray<ZeropsService>,
): ZeropsGiteaState {
  return {
    project,
    url: servicePublicOrigin(project, findService(services, GITEA_WEB_SERVICE), GITEA_HTTP_PORT),
    brokerUrl: servicePublicOrigin(
      project,
      findService(services, GITEA_BROKER_SERVICE),
      GITEA_BROKER_PORT,
    ),
  };
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
