/**
 * A Mate's project stops handing its container's key to everything in it.
 *
 * ## What it is today
 *
 * Every Mate project on the live account runs `envIsolation: none` — the
 * platform's development-container recipe sets it — and carries `ZCP_API_KEY`
 * as a **project** variable, `sensitive: false`, readable in clear (measured
 * 2026-09-16, ledger *What a container sees of its project-mates* and
 * *Isolation flipped live…*). Two consequences, and they compound:
 *
 * - under `none`, every container in the project — each app container, each
 *   build — reads every sibling's fully resolved variables as
 *   `{hostname}_{key}`: `zcp_GITEA_TOKEN`, `zcp_VSCODE_PASSWORD` and
 *   `zcp_ZCP_AGENT_OAUTH_CLAUDE_CODE`, the agent's own login, among them;
 * - project-level variables ignore isolation entirely, so `ZCP_API_KEY`
 *   reaches every container whatever the setting.
 *
 * So the app's own dependencies, and any build it runs, hold the Mate's
 * platform key and its agent's credentials. zcp needs none of that: every
 * sibling read it makes goes through the API.
 *
 * ## What this plans
 *
 * `envIsolation` to `service`, the key moved onto the one service that needs
 * it as a sensitive **service** variable, the project-level entry deleted, and
 * then every OTHER service restarted — never the container. The restart is
 * not housekeeping: the store is rewritten within seconds of the flip, but a
 * running process keeps the sibling variables it captured at start until it
 * restarts (measured), and the app's own containers are the ones that matter.
 * The Mate itself is left running: it reads its own key live from the
 * platform store, with a retry on 401/403, and zcp's tools already read the
 * store live too (server commit 7d544119b) — restarting it would only be
 * this step ending the very session watching it. A Mate on a server older
 * than that release keeps its boot snapshot until its own next restart;
 * that is the release's job, not this plan's.
 *
 * A project with no control plane — a stage or production project made the old
 * way, which carries the same `none` and the same key — has nothing to move
 * the key to, so the key is simply deleted. The presence of a container is the
 * input, not the project's `mate:role:` tag: a tag is a label somebody wrote,
 * and what decides where a key can live is whether there is a container to put
 * it in.
 *
 * `sshIsolation` is never touched. zcp's SSH into the app containers is the
 * one cross-service path it needs, and it is not what leaks a sibling's
 * variables.
 *
 * ## Two platform shapes the plan's ordering encodes
 *
 * Measured 2026-09-16, both for an owner and for a `BASIC_USER` project token:
 *
 * 1. `PUT /project-env/{id}` needs `{key, content}`. A body carrying `content`
 *    alone is `400 invalidUserInput` — `{"key": ["field is required"]}` — so
 *    an update step carries the key beside the value.
 * 2. The entry's id only ever comes from `POST /project/search` →
 *    `items[0].envList[].id`, and that index trails the write path. A project
 *    made a moment ago answers without the variables it was born with, so a
 *    read that is missing `envIsolation` is refused rather than planned from
 *    (measured 2026-09-20).
 *
 * Together they mean a delete cannot use an id the plan was built from. So the
 * plan names the **key** to delete and puts a re-read in front of it; the
 * caller resolves the id from the fresh list. A step type that carried an id
 * there would be a plan that looks right and deletes the wrong row.
 *
 * ## Credential-free
 *
 * The plan never carries the key's value: a plan is progress a UI renders. It
 * names the entry the value comes from, and the caller — which already read
 * that entry — moves it across.
 *
 * Nothing here reaches a network or a clock (rule R1).
 *
 * @module projectIsolation
 */

/** The project variable that decides what a container reads of its siblings. */
export const PROJECT_ENV_ISOLATION_KEY = "envIsolation";
/** The platform's own default, and the only value a Mate's project may hold. */
export const PROJECT_ENV_ISOLATION_SERVICE = "service";
/** The Mate's platform key, written by the recipe as a project variable in clear. */
export const ZCP_API_KEY_ENV_KEY = "ZCP_API_KEY";

/** One entry of `POST /project/search` → `items[0].envList`. */
export interface ProjectEnvEntry {
  readonly id: string;
  readonly key: string;
  readonly content?: string | undefined;
  readonly sensitive?: boolean | undefined;
}

export interface ProjectIsolationService {
  readonly name: string;
  /**
   * The zcp container. Decided by the service's **type**
   * (`isZcpService`), never by its hostname: a hostname is editable, and a
   * project whose container was renamed would otherwise have its key deleted
   * instead of moved.
   */
  readonly isControlPlane: boolean;
}

export type ProjectIsolationStep =
  /** `PUT /project-env/{entryId}` `{key, content}` — the key is required beside the value. */
  | {
      readonly kind: "update-project-env";
      readonly entryId: string;
      readonly key: string;
      readonly content: string;
    }
  /**
   * The key onto the one service that needs it, as a sensitive service
   * variable. `fromEntryId` names where the caller takes the value from; the
   * value itself never travels in the plan.
   */
  | {
      readonly kind: "move-key-to-service";
      readonly serviceName: string;
      readonly key: string;
      readonly fromEntryId: string;
    }
  /** `POST /project/search` again: the only place an entry's id comes from. */
  | { readonly kind: "reread-project-env" }
  /** `DELETE /project-env/{id}`, with the id resolved from the re-read by this key. */
  | { readonly kind: "delete-project-env"; readonly key: string }
  /** `PUT /service-stack/{id}/restart` — the only thing that clears a running process. */
  | { readonly kind: "restart-service"; readonly serviceName: string };

export interface ProjectIsolationInput {
  /** `POST /project/search` → `items[0].envList`, read as someone who sees it in clear. */
  readonly envList: ReadonlyArray<ProjectEnvEntry>;
  /** The project's own services, system ones already filtered out by the caller. */
  readonly services: ReadonlyArray<ProjectIsolationService>;
}

/**
 * A plan, or a refusal to make one from a read that cannot be complete.
 *
 * `read-incomplete` is not a project in a bad state: the platform writes
 * `envIsolation` onto every project it makes, so a list without it is a read
 * that has not caught up. The caller retries; it never writes.
 */
export type ProjectIsolationPlan =
  | { readonly ok: true; readonly steps: ReadonlyArray<ProjectIsolationStep> }
  | { readonly ok: false; readonly reason: "read-incomplete" };

/**
 * The ordered platform calls that close one project, or an empty list when it
 * is already closed and holds no project-wide key.
 *
 * An empty plan is the point: this is meant to run on every read of the
 * projects screen as well as once at creation, and a project that has already
 * been through it must produce no writes and no restarts.
 */
export function planProjectIsolation(input: ProjectIsolationInput): ProjectIsolationPlan {
  const steps: Array<ProjectIsolationStep> = [];

  const isolation = input.envList.find((entry) => entry.key === PROJECT_ENV_ISOLATION_KEY);
  // Absent means the read trails, never that the project is missing it: the
  // platform gives every project the setting at birth. Writing one from here
  // asked the platform to create a duplicate, which it refused with
  // `is not unique`, which failed the creation that called it
  // (measured 2026-09-20).
  if (isolation === undefined) return { ok: false, reason: "read-incomplete" };
  if (isolation.content !== PROJECT_ENV_ISOLATION_SERVICE) {
    steps.push({
      kind: "update-project-env",
      entryId: isolation.id,
      key: PROJECT_ENV_ISOLATION_KEY,
      content: PROJECT_ENV_ISOLATION_SERVICE,
    });
  }

  const key = input.envList.find((entry) => entry.key === ZCP_API_KEY_ENV_KEY);
  if (key !== undefined) {
    const container = input.services.find((service) => service.isControlPlane);
    if (container !== undefined) {
      steps.push({
        kind: "move-key-to-service",
        serviceName: container.name,
        key: ZCP_API_KEY_ENV_KEY,
        fromEntryId: key.id,
      });
    }
    // Never by the id above: it came from a read that trails the writes just
    // planned, and a creation hands back no entry id at all.
    steps.push({ kind: "reread-project-env" });
    steps.push({ kind: "delete-project-env", key: ZCP_API_KEY_ENV_KEY });
  }

  if (steps.length === 0) return { ok: true, steps: [] };

  // Every OTHER service, never the container: the app's own containers
  // captured their siblings' variables at start and only a restart clears
  // that, but the Mate itself no longer needs one (server commit
  // 7d544119b) — it reads its own key live from the platform store, with a
  // retry on 401/403, and zcp's tools already read the store live too. A
  // Mate on an older release keeps its boot snapshot until its own next
  // restart; that is the release's job, not this plan's.
  for (const service of input.services.filter((candidate) => !candidate.isControlPlane)) {
    steps.push({ kind: "restart-service", serviceName: service.name });
  }

  return { ok: true, steps };
}

/** A short, human label per step. Never prints a value (`planProjectIsolation`). */
export function projectIsolationStepLabel(step: ProjectIsolationStep): string {
  switch (step.kind) {
    case "update-project-env":
      return "Closing the project's shared variables";
    case "move-key-to-service":
      return "Moving the container's key onto the container";
    case "reread-project-env":
      return "Re-reading the project's variables";
    case "delete-project-env":
      return "Removing the project-wide key";
    case "restart-service":
      return `Restarting ${step.serviceName}`;
  }
}
