/**
 * The platform's verdict on a project's creation.
 *
 * `POST /client/{id}/project` answers 200 with the project before anything
 * is built: the building is a `project.create` process that runs after the
 * response, and it can fail — measured 2026-09-16, FAILED within a second
 * with `internalServerError`, the project left `NEW` and its zcp
 * `READY_TO_DEPLOY` for good, while the page read it as a boot that never
 * ended. So a 200 is an acceptance, not a creation; what says whether the
 * project exists is that process, found through `POST /process/search` by
 * project and picked by action name.
 *
 * Pure: the read is `api.ts`'s and the waiting is `runEnvironmentCreation`'s.
 *
 * @module projectCreation
 */

export const PROJECT_CREATE_ACTION = "project.create";

/** The platform's own words on a process that did not finish. */
export interface ZeropsProcessError {
  readonly code: string;
  readonly message: string;
}

/** The `project.create` process of one project, as much of it as a verdict needs. */
export interface ZeropsProjectCreation {
  readonly processId: string;
  /** The platform's raw status token: `FINISHED`, `FAILED`, `CANCELED`, or a running one. */
  readonly status: string;
  readonly error: ZeropsProcessError | null;
}

export type ZeropsProjectCreationOutcome =
  /** The process is still on its way, or has not appeared yet. */
  | { readonly kind: "running" }
  | { readonly kind: "finished" }
  | {
      readonly kind: "failed";
      readonly status: "FAILED" | "CANCELED";
      /** `error.message` when the platform gave one. */
      readonly message: string | undefined;
    };

/**
 * The sentence the platform gives when it has nothing to say: an internal
 * error with no cause. A row repeating it says nothing a person can act on.
 */
export const GENERIC_PLATFORM_ERROR_MESSAGE = "unexpected internal server error";

export function isGenericPlatformError(message: string): boolean {
  return message.trim().toLowerCase() === GENERIC_PLATFORM_ERROR_MESSAGE;
}

/**
 * What the process says. No process at all counts as running: the search
 * can answer before the platform has written the process it is about to run.
 */
export function projectCreationOutcome(
  creation: ZeropsProjectCreation | undefined,
): ZeropsProjectCreationOutcome {
  if (creation === undefined) return { kind: "running" };
  if (creation.status === "FINISHED") return { kind: "finished" };
  if (creation.status === "FAILED" || creation.status === "CANCELED") {
    const message = creation.error?.message.trim();
    return { kind: "failed", status: creation.status, message: message ? message : undefined };
  }
  return { kind: "running" };
}

/** A failed creation as the creation checklist's line: the platform's message, else its status. */
export function projectCreationFailureSentence(
  outcome: Extract<ZeropsProjectCreationOutcome, { readonly kind: "failed" }>,
): string {
  return outcome.message ?? `Zerops reported the project's creation as ${outcome.status}.`;
}

/** The `POST /process/search` body that finds one project's processes, newest first. */
export function projectProcessSearchBody(input: {
  readonly clientId: string;
  readonly projectId: string;
}): {
  readonly search: ReadonlyArray<{
    readonly name: string;
    readonly operator: "eq";
    readonly value: string;
  }>;
  readonly sort: ReadonlyArray<{ readonly name: string; readonly ascending: boolean }>;
  readonly limit: number;
} {
  return {
    search: [
      { name: "clientId", operator: "eq", value: input.clientId },
      { name: "projectId", operator: "eq", value: input.projectId },
    ],
    sort: [{ name: "created", ascending: false }],
    limit: 20,
  };
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function processError(value: unknown): ZeropsProcessError | null {
  if (typeof value !== "object" || value === null) return null;
  const code = "code" in value && nonEmptyString(value.code) ? value.code : "";
  const message = "message" in value && typeof value.message === "string" ? value.message : "";
  return code === "" && message === "" ? null : { code, message };
}

/**
 * The newest `project.create` of the given project among a search's items.
 * The search is sorted by the platform, but a process list is not trusted to
 * arrive that way: `created` decides, and an item that is not this project's
 * creation — another action, another project — is not a candidate at all.
 */
export function pickProjectCreation(
  items: ReadonlyArray<unknown>,
  projectId: string,
): ZeropsProjectCreation | undefined {
  let newest: { readonly createdAt: number; readonly creation: ZeropsProjectCreation } | undefined;
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    if (!("actionName" in item) || item.actionName !== PROJECT_CREATE_ACTION) continue;
    if ("projectId" in item && item.projectId !== undefined && item.projectId !== projectId) {
      continue;
    }
    if (!("id" in item) || !nonEmptyString(item.id)) continue;
    if (!("status" in item) || !nonEmptyString(item.status)) continue;
    const created = "created" in item && nonEmptyString(item.created) ? item.created : undefined;
    const createdAt = created === undefined ? Number.NEGATIVE_INFINITY : Date.parse(created);
    const at = Number.isNaN(createdAt) ? Number.NEGATIVE_INFINITY : createdAt;
    if (newest !== undefined && at <= newest.createdAt) continue;
    newest = {
      createdAt: at,
      creation: {
        processId: item.id,
        status: item.status,
        error: processError("error" in item ? item.error : null),
      },
    };
  }
  return newest?.creation;
}
