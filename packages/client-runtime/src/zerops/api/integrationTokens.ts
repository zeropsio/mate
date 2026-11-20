import { ZeropsApiError } from "../errors.ts";
import type { ZeropsDoor } from "../api.ts";
import type {
  ZeropsIntegrationToken,
  ZeropsProjectGrant,
  ZeropsProjectRole,
  ZeropsTokenDelegation,
} from "../groupReach.ts";

/** The Zerops REST API's integration-token calls: one resource of `../api.ts`'s client. */

/** The platform's answer for an integration token it no longer has (`deleteIntegrationToken`), at `400` or `404`. */
const isTokenGone = (cause: unknown): boolean =>
  cause instanceof ZeropsApiError &&
  (cause.status === 400 || cause.status === 404) &&
  cause.code === "clientUserConnectionNotFound";

/**
 * Whether a mint carries no rights at all: `NO_ACCESS` and an empty project
 * list, with the flags every mint here sends as false (spec-mate C6). Such a
 * mint is an `account-write`; one that names no project list is left to the
 * platform's default and stays a `project-write`, as does every grant.
 */
function grantsNothing(mint: {
  readonly roleCode: ZeropsProjectRole;
  readonly projects?: ReadonlyArray<ZeropsProjectGrant>;
}): boolean {
  return mint.roleCode === "NO_ACCESS" && mint.projects?.length === 0;
}

/**
 * `POST /client/{id}/integration-token` — mints a token and returns its
 * value, which the platform shows exactly once.
 *
 * No flags, ever: `canCreateProjects` and the finance flags are what turn a
 * token into something that can name a person at a door (3.2), and nothing
 * this client mints needs them.
 *
 * A mint that grants anything is a `project-write`, admitted by the account
 * window and `beforeWrite`; one that grants nothing is an `account-write`,
 * which neither holds up.
 */
export async function mintIntegrationToken(
  door: ZeropsDoor,
  input: {
    readonly clientId: string;
    readonly name: string;
    readonly roleCode: ZeropsProjectRole;
    readonly projects?: ReadonlyArray<ZeropsProjectGrant>;
  },
  signal?: AbortSignal,
  beforeWrite?: () => Promise<void>,
): Promise<{ readonly id: string; readonly token: string }> {
  const response = await door<{ readonly id?: string; readonly token?: string }>(
    `/client/${input.clientId}/integration-token`,
    {
      method: "POST",
      signal: signal ?? null,
      body: JSON.stringify({
        name: input.name,
        roleCode: input.roleCode,
        canCreateProjects: false,
        canViewFinances: false,
        canEditFinances: false,
        ...(input.projects === undefined ? {} : { projects: input.projects }),
      }),
    },
    {
      operationKind: grantsNothing(input) ? "account-write" : "project-write",
      ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
      // A token exists whether or not its answer arrives.
      mayHaveWritten: true,
    },
  );
  if (!response.token || !response.id) {
    throw new ZeropsApiError(
      "Zerops accepted the token but did not return it in full, so it can neither be used nor taken back.",
      "uncertain",
    );
  }
  return { id: response.id, token: response.token };
}

/**
 * `DELETE /client/{id}/integration-token/{tokenId}` — takes a token back.
 *
 * A deletion is immediate at the platform (the value answers `401` within about 0.6 s, measured
 * 2026-09-15).
 *
 * A token the platform no longer has is deleted already: it answers `clientUserConnectionNotFound`
 * for one, at `400` (measured live, 2026-10-05) or `404`, as a Mate's key is once the project it
 * alone reached is deleted. That answer, and only that one, is the delete done.
 */
export async function deleteIntegrationToken(
  door: ZeropsDoor,
  input: { readonly clientId: string; readonly tokenId: string },
  signal?: AbortSignal,
  beforeWrite?: () => Promise<void>,
): Promise<void> {
  try {
    await door(
      `/client/${input.clientId}/integration-token/${input.tokenId}`,
      { method: "DELETE", signal: signal ?? null },
      {
        operationKind: "project-write",
        ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
      },
    );
  } catch (cause) {
    if (!isTokenGone(cause)) throw cause;
  }
}

/**
 * `PUT /client/{id}/integration-token/{tokenId}/regenerate` — a new value for
 * a token nobody holds the value of any more.
 *
 * The old value dies at once and whoever regenerates becomes the token's
 * creator (measured 2026-09-15), so this is only ever right where nothing is
 * using the old value yet.
 */
export async function regenerateIntegrationToken(
  door: ZeropsDoor,
  input: { readonly clientId: string; readonly tokenId: string },
  signal?: AbortSignal,
  beforeWrite?: () => Promise<void>,
): Promise<string> {
  const response = await door<{ readonly token?: string }>(
    `/client/${input.clientId}/integration-token/${input.tokenId}/regenerate`,
    { method: "PUT", signal: signal ?? null },
    {
      operationKind: "project-write",
      ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
    },
  );
  if (!response.token) {
    throw new ZeropsApiError(
      "Zerops regenerated the token but did not return its value, so it cannot be used.",
      "uncertain",
    );
  }
  return response.token;
}

/**
 * `GET /client/{id}/integration-token/list` — every token on the account,
 * with the project grants each one carries.
 *
 * The bare `…/integration-token` GET answers 405; the listing is under
 * `/list` (measured 2026-09-06). `groupReach.ts` picks a Mate's own token
 * out of this. The platform answers the whole list: `limit` and `offset`
 * are ignored (measured 2026-10-03).
 */
export async function listIntegrationTokens(
  door: ZeropsDoor,
  clientId: string,
  signal?: AbortSignal,
): Promise<ReadonlyArray<ZeropsIntegrationToken>> {
  const body = await door<{ readonly list?: ReadonlyArray<ZeropsIntegrationToken> }>(
    `/client/${clientId}/integration-token/list`,
    { signal: signal ?? null },
  );
  return body.list ?? [];
}

/**
 * `GET /client/{id}/integration-token/{tokenId}` — one token, with the project grants it
 * carries, in the shape the list gives each (HQ and the Mate's door read a token this way): one
 * small answer where the list is every token on the account, whole. `undefined` once the token
 * is gone.
 */
export async function readIntegrationToken(
  door: ZeropsDoor,
  clientId: string,
  tokenId: string,
  signal?: AbortSignal,
): Promise<ZeropsIntegrationToken | undefined> {
  try {
    return await door<ZeropsIntegrationToken>(`/client/${clientId}/integration-token/${tokenId}`, {
      signal: signal ?? null,
    });
  } catch (cause) {
    if (cause instanceof ZeropsApiError && cause.kind === "not-found") return undefined;
    throw cause;
  }
}

/**
 * `PUT /client/{id}/integration-token/{tokenId}` — rewrites what a token
 * reaches, in place.
 *
 * The token **string does not change**, so a container already holding it
 * gains or loses sight of a project immediately, with nothing written into
 * its environment and no restart (measured 2026-09-06: a read of a sibling
 * went 200 → 403 → 200 across two of these calls, on one unchanged token).
 * That is what lets a Mate's key be lowered where it runs.
 *
 * The whole body is sent because the platform replaces the record: omitting
 * a field is not "leave it alone", it is "set it to nothing".
 */
export async function setIntegrationTokenProjects(
  door: ZeropsDoor,
  input: {
    readonly clientId: string;
    readonly tokenId: string;
    readonly name: string;
    readonly projects: ReadonlyArray<ZeropsProjectGrant>;
    /**
     * The token's own org role, round-tripped. `PUT` replaces the record, so
     * omitting it would change the token's org role.
     */
    readonly roleCode?: string | undefined;
  },
  signal?: AbortSignal,
  beforeWrite?: () => Promise<void>,
): Promise<void> {
  await door(
    `/client/${input.clientId}/integration-token/${input.tokenId}`,
    {
      method: "PUT",
      signal: signal ?? null,
      body: JSON.stringify({
        name: input.name,
        roleCode: input.roleCode ?? "NO_ACCESS",
        canCreateProjects: false,
        canViewFinances: false,
        canEditFinances: false,
        projects: input.projects,
      }),
    },
    {
      operationKind: "project-write",
      ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
    },
  );
}

/**
 * `GET /client/{id}/integration-token/{tokenId}/delegation` — the one-time
 * mint permissions attached to a token.
 *
 * A person's call, not a token's: an integration token reading or deleting
 * a delegation is refused (`notAllowedForIntegrationToken`, measured
 * 2026-09-15), which is why this runs from the app with the owner's session
 * and never inside a Mate.
 *
 * The body is `{ list: [...] }` — the same hand-rolled shape zcp decodes
 * (`internal/platform/zerops_delegation.go`); the SDK does not cover it.
 */
export async function listIntegrationTokenDelegations(
  door: ZeropsDoor,
  input: { readonly clientId: string; readonly tokenId: string },
  signal?: AbortSignal,
): Promise<ReadonlyArray<ZeropsTokenDelegation>> {
  const body = await door<{ readonly list?: ReadonlyArray<ZeropsTokenDelegation> }>(
    `/client/${input.clientId}/integration-token/${input.tokenId}/delegation`,
    { signal: signal ?? null },
  );
  return body.list ?? [];
}

/**
 * `DELETE /client/{id}/integration-token/{tokenId}/delegation/{delegationId}`
 * — takes back the one-time mint a Mate never asked for.
 */
export async function deleteIntegrationTokenDelegation(
  door: ZeropsDoor,
  input: {
    readonly clientId: string;
    readonly tokenId: string;
    readonly delegationId: string;
  },
  signal?: AbortSignal,
  beforeWrite?: () => Promise<void>,
): Promise<void> {
  await door(
    `/client/${input.clientId}/integration-token/${input.tokenId}/delegation/${input.delegationId}`,
    { method: "DELETE", signal: signal ?? null },
    {
      operationKind: "project-write",
      ...(beforeWrite === undefined ? {} : { beforeProjectWrite: beforeWrite }),
    },
  );
}
