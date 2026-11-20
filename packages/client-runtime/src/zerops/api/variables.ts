import type { ZeropsDoor } from "../api.ts";

/** One record from `GET /service-stack/{id}/env` (or `GET /project/{id}/env`). */
export interface ZeropsServiceEnvVar {
  readonly id: string;
  readonly key: string;
  readonly content: string;
  readonly sensitive?: boolean;
}

/** One vault write's body: `sensitive` is always said (a write without it turns a value plain). */
export interface ZeropsVariableWrite {
  readonly key: string;
  readonly content: string;
  readonly sensitive: boolean;
}

/**
 * `POST /project/{id}/env` — a Shared value of the vault (`stack.updateProjectEnvs`). Answers
 * the write's process id. A key Shared holds already (case-insensitive) is `400
 * projectEnvDuplicateKey`; a key the platform does not take, `400 projectEnvKeyInvalid`.
 */
export async function addProjectVariable(
  door: ZeropsDoor,
  projectId: string,
  write: ZeropsVariableWrite,
  beforeWrite?: () => Promise<void>,
): Promise<{ readonly processId: string | undefined }> {
  return variableWrite(door, `/project/${projectId}/env`, "POST", write, beforeWrite);
}

/** `PUT /project-env/{id}` — a Shared value's new content; `sensitive` always sent. */
export async function updateProjectVariable(
  door: ZeropsDoor,
  id: string,
  write: ZeropsVariableWrite,
  beforeWrite?: () => Promise<void>,
): Promise<{ readonly processId: string | undefined }> {
  return variableWrite(door, `/project-env/${id}`, "PUT", write, beforeWrite);
}

/** `DELETE /project-env/{id}` — a Shared value removed. */
export async function removeProjectVariable(
  door: ZeropsDoor,
  id: string,
  beforeWrite?: () => Promise<void>,
): Promise<{ readonly processId: string | undefined }> {
  return variableWrite(door, `/project-env/${id}`, "DELETE", null, beforeWrite);
}

/**
 * `POST /service-stack/{id}/user-data` — a service's own value (`stack.updateUserData`). A key
 * equal to one of its values or of its deployed zerops.yml entries (case-insensitive) is `400
 * userDataDuplicateKey`.
 */
export async function addServiceVariable(
  door: ZeropsDoor,
  serviceId: string,
  write: ZeropsVariableWrite,
  beforeWrite?: () => Promise<void>,
): Promise<{ readonly processId: string | undefined }> {
  return variableWrite(door, `/service-stack/${serviceId}/user-data`, "POST", write, beforeWrite);
}

/** `PUT /user-data/{id}` — a service value's new content; `sensitive` always sent. */
export async function updateServiceVariable(
  door: ZeropsDoor,
  id: string,
  write: ZeropsVariableWrite,
  beforeWrite?: () => Promise<void>,
): Promise<{ readonly processId: string | undefined }> {
  return variableWrite(door, `/user-data/${id}`, "PUT", write, beforeWrite);
}

/** `DELETE /user-data/{id}` — a service's value removed. */
export async function removeServiceVariable(
  door: ZeropsDoor,
  id: string,
  beforeWrite?: () => Promise<void>,
): Promise<{ readonly processId: string | undefined }> {
  return variableWrite(door, `/user-data/${id}`, "DELETE", null, beforeWrite);
}

/**
 * `GET /project-env/{id}/reveal` — a sensitive Shared value, decrypted. Zerops reveals only in
 * sudo mode: this client's personal access token is always in it (its `sudoUntil` slides two
 * hours ahead with each call), a password session is not (`403 notInSudoMode`), and a member
 * who may not read secrets is refused (measured 2026-10-07).
 */
export async function revealProjectVariable(door: ZeropsDoor, id: string): Promise<string> {
  return reveal(door, `/project-env/${id}/reveal`);
}

/** `GET /user-data/{id}/reveal` — a sensitive service value (its own, or Zerops-made), decrypted. */
export async function revealServiceVariable(door: ZeropsDoor, id: string): Promise<string> {
  return reveal(door, `/user-data/${id}/reveal`);
}

async function reveal(door: ZeropsDoor, path: string): Promise<string> {
  const response = await door<{ readonly content?: unknown }>(
    path,
    { signal: null },
    { clearSessionOnUnauthorized: false, operationKind: "read" },
  );
  return typeof response?.content === "string" ? response.content : "";
}

/**
 * One vault write: `sensitive` is on the wire of every add and update, because a write that
 * leaves it out turns a sensitive value plain (measured 2026-10-07). Answers its process id.
 */
async function variableWrite(
  door: ZeropsDoor,
  path: string,
  method: "POST" | "PUT" | "DELETE",
  write: ZeropsVariableWrite | null,
  beforeWrite?: () => Promise<void>,
): Promise<{ readonly processId: string | undefined }> {
  const process = await door<{ readonly id?: unknown }>(
    path,
    {
      method,
      ...(write === null
        ? {}
        : {
            body: JSON.stringify({
              key: write.key,
              content: write.content,
              sensitive: write.sensitive,
            }),
          }),
    },
    {
      operationKind: "project-write",
      ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
    },
  );
  return { processId: typeof process?.id === "string" ? process.id : undefined };
}

export function setServiceVariable(
  door: ZeropsDoor,
  serviceId: string,
  current: ZeropsServiceEnvVar | undefined,
  write: ZeropsVariableWrite,
  beforeWrite?: () => Promise<void>,
): Promise<{ readonly processId: string | undefined }> {
  return current === undefined
    ? addServiceVariable(door, serviceId, write, beforeWrite)
    : updateServiceVariable(door, current.id, write, beforeWrite);
}

/**
 * The project admits its container, in the two values the platform inherits into every service,
 * those added after birth included (`zeropsio/zcp:docs/spec-mate.md` §2.8):
 * - `sshIsolation` becomes `vpn service@<container>` (C-13): people on the VPN and the container
 *   may SSH into every service, nothing else may — what the platform's own development-container
 *   import set and a plain service import does not;
 * - `envIsolation` becomes `service service@<container>` (the `envIsolation` row): every
 *   service's variables are its own and the container's, so the container reads what it works on
 *   and its own key stays its own. Never `none`.
 *
 * Each entry is the platform's own, made by the project's creation, so it is updated, never
 * added; read from `GET /project/{id}/env`, which lists them once the creation has run (measured
 * 2026-11-16; the search index trails it). A missing one refuses before anything is written.
 * Equal already, nothing is written, so a press tried again writes nothing twice.
 */
export async function admitContainer(
  door: ZeropsDoor,
  projectId: string,
  serviceName: string,
  signal: AbortSignal | undefined,
  beforeWrite: (() => Promise<void>) | undefined,
): Promise<void> {
  const wanted = [
    { key: "sshIsolation", content: `vpn service@${serviceName}` },
    { key: "envIsolation", content: `service service@${serviceName}` },
  ] as const;
  const body = await door<{ readonly items?: ReadonlyArray<ZeropsServiceEnvVar> }>(
    `/project/${projectId}/env`,
    { signal: signal ?? null },
  );
  const entries = wanted.map((value) => ({
    ...value,
    entry: body.items?.find((variable) => variable.key === value.key),
  }));
  if (entries.some(({ entry }) => entry === undefined))
    throw new Error("Its project is still being created. Try again in a minute.");
  for (const { key, content, entry } of entries) {
    if (entry === undefined || entry.content === content) continue;
    await updateProjectVariable(door, entry.id, { key, content, sensitive: false }, beforeWrite);
  }
}
