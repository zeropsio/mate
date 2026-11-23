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
 * Pure: the read is `api.ts`'s.
 *
 * @module projectCreation
 */

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

type ZeropsProjectCreationOutcome =
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
const GENERIC_PLATFORM_ERROR_MESSAGE = "unexpected internal server error";

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
