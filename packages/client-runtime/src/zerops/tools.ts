/**
 * Tools — the things an account runs *for itself* rather than as part of any
 * one application. Today that means Gitea: the git host the agent pushes to,
 * and the CI runners that deploy from it.
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
 * axis. Putting Gitea in a group would make one group own the account's git
 * host, which is the master problem again in a different costume. So the two
 * are disjoint by rule: a project carrying a tool tag is a tool even if it
 * also carries a group tag, and `deriveZeropsGroups` never sees it.
 *
 * ## What can and cannot be observed
 *
 * The platform's own project and service reads — the two calls the picker
 * already makes — say that Gitea's services exist and are `ACTIVE`, and give
 * the public URL. They say nothing about Gitea itself.
 *
 * Gitea, though, answers two useful questions **unauthenticated** on that same
 * URL (measured 2026-09-05 against a real import, with curl):
 *
 * - `GET /api/v1/version` → `{"version":"1.27.2"}`, which turns "the platform
 *   says `ACTIVE`" into "Gitea is actually answering";
 * - `GET /api/v1/users/search?q=` → `{"ok":true,"data":[]}`, an empty list on a
 *   fresh instance, which is how the "create the admin user" step can be
 *   ticked honestly instead of nagging forever.
 *
 * **Neither is readable from a browser** until the instance answers
 * cross-origin: the same `GET /api/v1/version` from a page on another origin
 * fails with `Failed to fetch` before any request is made (measured 2026-09-06
 * against a live import). `zeropsio/recipe-gitea` enables `[cors]` for exactly
 * this; an instance built before that lands can only ever be probed
 * server-side, and this module says `"unknown"` rather than guessing.
 *
 * So {@link deriveGiteaState} takes an optional {@link ZeropsGiteaProbe} beside
 * the platform reads. Without one it says `"unknown"` for what only Gitea
 * knows, rather than guessing; the fetching shell lives with the caller,
 * because this module reaches no network of its own (rule R1).
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

export function formatToolTag(kind: ZeropsToolKind): string {
  return `${TOOL_TAG_PREFIX}${kind}`;
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
export const GITEA_HTTP_PORT = 3000;

/** The service hostnames the recipe creates. */
export const GITEA_WEB_SERVICE = "web";
export const GITEA_RUNNER_SERVICE = "runner";

/**
 * How far along Gitea is, stated only as far as the platform can actually see.
 *
 * Deliberately three values and a raw status beside them: the platform's
 * service statuses observed on a real import were `NEW`, `CREATING`,
 * `READY_TO_DEPLOY`, `ACTIVE` and `DELETING` (2026-09-05), and inventing a
 * richer taxonomy from five samples would be guessing. `webStatus` carries the
 * truth for anything the UI wants to say precisely.
 */
export type ZeropsGiteaPhase = "provisioning" | "running" | "unavailable";

export type ZeropsGiteaStepState = "done" | "pending" | "needs-you" | "optional" | "unknown";

/**
 * What Gitea itself said, from its two public endpoints. The caller fetches;
 * this module only reasons.
 */
export interface ZeropsGiteaProbe {
  /** `GET /api/v1/version` answered. */
  readonly reachable: boolean;
  readonly version?: string;
  /**
   * How many users `GET /api/v1/users/search?q=` returned. `0` on a fresh
   * instance — that is the signal that no admin has been created yet. Omit
   * when the call failed, so a network blip never reads as "no admin".
   */
  readonly userCount?: number;
}

export interface ZeropsGiteaSetupStep {
  readonly id: "import" | "running" | "admin" | "runners" | "domain";
  readonly title: string;
  readonly state: ZeropsGiteaStepState;
  /** What the user has to do, when it is theirs to do. */
  readonly detail?: string;
}

export interface ZeropsGiteaState {
  readonly project: ZeropsProject;
  readonly phase: ZeropsGiteaPhase;
  /** `https://web-<subdomain>-3000.<region>.zerops.app`, once the platform has assigned one. */
  readonly url: string | undefined;
  /** The `web` service's own status, verbatim — `undefined` before it exists. */
  readonly webStatus: string | undefined;
  /** Whether the CI runner addon has been imported. Registration itself is invisible from here. */
  readonly runnersImported: boolean;
  /**
   * Whether the recipe's `GITEA_ADMIN_TOKEN` is on the `web` service — i.e.
   * whether mate can act as Gitea's admin without asking anyone for anything.
   * False on an instance whose admin was made by hand: it has an admin, but
   * nobody published a credential for it.
   */
  readonly adminCredentialPublished: boolean;
  readonly steps: ReadonlyArray<ZeropsGiteaSetupStep>;
}

/**
 * The env keys `recipe-gitea`'s `admin-init.sh` publishes on the `web` service
 * once it has minted the first admin (merged 2026-09-06). The token and the
 * password are written `sensitive: true`, and the platform hands both back in
 * clear to a token with the owner's role — which is how mate reads them without
 * ever asking Gitea, and without a human in a terminal.
 */
export const GITEA_ADMIN_USER_ENV_KEY = "GITEA_ADMIN_USERNAME";
export const GITEA_ADMIN_TOKEN_ENV_KEY = "GITEA_ADMIN_TOKEN";
export const GITEA_ADMIN_PASSWORD_ENV_KEY = "GITEA_ADMIN_PASSWORD";

/**
 * The command that creates Gitea's first admin user **by hand** — the fallback
 * for an instance built before the recipe minted its own, since a Gitea that
 * already has an admin cannot be given one twice.
 *
 * It has to run inside the `web` service — over the project's SSH, or the
 * Remote Web Terminal in the Zerops GUI — because registration is disabled and
 * Gitea has no bootstrap endpoint. Mate cannot run it: the container is in
 * another project, and mate reaches no container but its own.
 */
export const GITEA_ADMIN_USER_COMMAND =
  "gitea admin user create --config /etc/gitea/app.ini --admin --username admin --email you@example.com --password '<choose-one>' --must-change-password=false";

/** Prints the registration token the runner addon needs, from inside `web`. */
export const GITEA_RUNNER_TOKEN_COMMAND =
  "gitea actions generate-runner-token --config /etc/gitea/app.ini";

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

function giteaUrl(project: ZeropsProject, web: ZeropsService | undefined): string | undefined {
  if (web === undefined) return undefined;
  const port = web.ports?.find((candidate) => candidate.port === GITEA_HTTP_PORT) ?? {
    port: GITEA_HTTP_PORT,
    httpSupport: true,
    scheme: "http",
  };
  return servicePortOrigin(project, web, port);
}

/**
 * Everything mate can honestly say about an account's Gitea, from one project
 * read and one service-stack read.
 */
export function deriveGiteaState(
  project: ZeropsProject,
  services: ReadonlyArray<ZeropsService>,
  probe?: ZeropsGiteaProbe,
  /**
   * The `web` service's env keys, from the platform read the caller already
   * makes. Values are never needed here — presence is the whole signal.
   */
  webEnvKeys?: ReadonlyArray<string>,
): ZeropsGiteaState {
  const web = findService(services, GITEA_WEB_SERVICE);
  const runner = findService(services, GITEA_RUNNER_SERVICE);
  const webStatus = web?.status;

  // The platform's status is necessary but not sufficient: `ACTIVE` means the
  // container runs, not that Gitea answers. A probe that came back
  // unreachable demotes it.
  const platformRunning = webStatus === "ACTIVE";
  const phase: ZeropsGiteaPhase =
    platformRunning && probe?.reachable !== false
      ? "running"
      : webStatus === undefined || webStatus === "DELETING"
        ? "unavailable"
        : "provisioning";

  const running = phase === "running";
  const url = giteaUrl(project, web);

  // A published token outranks the user count: it is proof the recipe finished
  // its own bootstrap, it needs no probe, and it is the thing every later step
  // actually consumes. The count only decides the case where no token exists.
  const adminCredentialPublished = (webEnvKeys ?? []).includes(GITEA_ADMIN_TOKEN_ENV_KEY);
  const adminState: ZeropsGiteaStepState = adminCredentialPublished
    ? "done"
    : probe?.userCount === undefined
      ? "unknown"
      : probe.userCount > 0
        ? "done"
        : "needs-you";

  const steps: ReadonlyArray<ZeropsGiteaSetupStep> = [
    { id: "import", title: "Gitea imported", state: "done" },
    {
      id: "running",
      title: "Gitea running",
      state: running ? "done" : "pending",
      ...(running
        ? {}
        : { detail: `Waiting for the web service (${webStatus ?? "not created"}).` }),
    },
    {
      id: "admin",
      title: "Admin user created",
      state: adminState,
      ...(adminState === "done"
        ? {}
        : {
            detail: `Run in the web service (SSH or the Remote Web Terminal): ${GITEA_ADMIN_USER_COMMAND}`,
          }),
    },
    {
      id: "runners",
      title: "CI runners",
      state: runner === undefined ? "optional" : "done",
      ...(runner === undefined
        ? {
            detail: `Needs a registration token from the web service: ${GITEA_RUNNER_TOKEN_COMMAND}`,
          }
        : {}),
    },
    { id: "domain", title: "Custom domain and SSH port", state: "optional" },
  ];

  return {
    project,
    phase,
    url,
    webStatus,
    runnersImported: runner !== undefined,
    adminCredentialPublished,
    steps,
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
