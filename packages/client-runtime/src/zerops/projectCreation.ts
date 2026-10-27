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

const UNDER_WAY = new Set(["PENDING", "RUNNING"]);
const ZCP_SERVICE_NAME = /^zcp\d*$/u;

/**
 * Whether the platform is still creating a zcp in the project — a `stack.create` pending or
 * running for a service named as `nextZcpServiceName` names one — out of its processes as
 * `POST /process/search` answers them. A container being created holds the Mate's key though the
 * services listing may not show it yet: its key is not regenerated under it.
 */
export function zcpCreationUnderWay(items: ReadonlyArray<unknown>): boolean {
  return items.some((item) => {
    if (typeof item !== "object" || item === null) return false;
    const { actionName, status, serviceStacks } = item as {
      readonly actionName?: unknown;
      readonly status?: unknown;
      readonly serviceStacks?: unknown;
    };
    if (actionName !== "stack.create" || typeof status !== "string" || !UNDER_WAY.has(status)) {
      return false;
    }
    return (
      Array.isArray(serviceStacks) &&
      serviceStacks.some(
        (service: unknown) =>
          typeof service === "object" &&
          service !== null &&
          "name" in service &&
          typeof service.name === "string" &&
          ZCP_SERVICE_NAME.test(service.name),
      )
    );
  });
}
