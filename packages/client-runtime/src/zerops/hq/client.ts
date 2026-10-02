/**
 * HQ's API as the client calls it (`apps/hq/src/api.ts`), through HQ's door.
 *
 * A person enters HQ as they enter a Mate: the app mints a throwaway named for HQ's project
 * (`mate-door:<hqProjectId>:<nonce>`), presents it once at `POST /api/door`, and deletes it
 * (`withThrowaway`). HQ answers a session of its own, which this client keeps in memory and sends
 * as `Authorization: Bearer` until HQ stops taking it; then it comes through the door once more.
 * Nothing of it is stored anywhere else.
 *
 * Every failure is an {@link HqError}: `unavailable` when HQ could not be reached or is not
 * serving (`503 not_active`, a standby or an HQ that is not the official one), `refused` when it
 * answered no — with HQ's own code and words.
 *
 * @module hq/client
 */
import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";

import type { FetchImplementation } from "../api.ts";

/** An organization's HQ: its project, and the address its anchor names. */
export interface HqEndpoint {
  readonly projectId: string;
  readonly address: string;
}

/** What `GET /api/structure` answers: the applications as the reader sees them in Zerops. */
export interface HqStructure {
  readonly apps: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly projects: ReadonlyArray<{
      readonly projectId: string;
      readonly name: string;
      readonly kind: string;
      readonly mate: { readonly name: string; readonly face: string } | null;
    }>;
  }>;
}

export interface HqAttach {
  readonly projectId: string;
  readonly kind: RoleProjectKind;
  /** The Mate's name and face; with kind `mate`, and only with it. */
  readonly mate?: { readonly name: string; readonly face: string };
}

export class HqError extends Error {
  readonly kind: "unavailable" | "refused";
  /** HQ's code (`forbidden`, `conflict`, `not_active`, …), or `network`. */
  readonly code: string;
  readonly status: number | undefined;
  constructor(input: {
    readonly kind: HqError["kind"];
    readonly code: string;
    readonly status?: number | undefined;
    readonly message: string;
  }) {
    super(input.message);
    this.name = "HqError";
    this.kind = input.kind;
    this.code = input.code;
    this.status = input.status;
  }
}

export interface HqApi {
  readonly structure: (signal?: AbortSignal) => Promise<HqStructure>;
  readonly createApp: (name: string) => Promise<{ readonly id: string; readonly name: string }>;
  readonly attachProject: (appId: string, attach: HqAttach) => Promise<void>;
}

const CALL_TIMEOUT_MS = 20_000;

/** HQ's code and words in an answer's body; a body that is not HQ's JSON names neither. */
function said(text: string): { readonly code?: unknown; readonly message?: unknown } {
  try {
    const body: unknown = JSON.parse(text);
    return typeof body === "object" && body !== null ? body : { code: undefined };
  } catch {
    return { code: undefined };
  }
}

async function errorOf(response: Response): Promise<HqError> {
  const body = said(await response.text());
  const code = typeof body.code === "string" ? body.code : `http_${response.status}`;
  const words = typeof body.message === "string" ? body.message : undefined;
  if (response.status >= 500 || response.status === 429) {
    return new HqError({
      kind: "unavailable",
      code,
      status: response.status,
      message: "HQ is not answering right now.",
    });
  }
  return new HqError({
    kind: "refused",
    code,
    status: response.status,
    message: words ?? `HQ refused this (${code}).`,
  });
}

/** One call to HQ: its JSON answer, or an {@link HqError}. */
async function call<T>(fetch: FetchImplementation, url: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(CALL_TIMEOUT_MS),
      headers: {
        Accept: "application/json",
        ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...init.headers,
      },
    });
  } catch {
    throw new HqError({
      kind: "unavailable",
      code: "network",
      message: "HQ could not be reached.",
    });
  }
  if (!response.ok) throw await errorOf(response);
  return (await response.json()) as T;
}

/**
 * What HQ's `/health` says (`apps/hq/src/health.ts`): `healthy` while it leads as the official
 * HQ; `not-ready` while it answers as anything else — a standby, an HQ whose anchor is missing;
 * `unreachable` while nothing answers as Core does.
 */
export type HqHealth =
  | { readonly kind: "healthy"; readonly build: string }
  | { readonly kind: "not-ready"; readonly state: string; readonly official: string }
  | { readonly kind: "unreachable" };

export async function readHqHealth(
  fetch: FetchImplementation,
  address: string,
  signal?: AbortSignal,
): Promise<HqHealth> {
  try {
    const response = await fetch(`${address.replace(/\/+$/u, "")}/health`, {
      cache: "no-store",
      signal: signal ?? AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    const body = (await response.json()) as {
      readonly state?: unknown;
      readonly official?: unknown;
      readonly build?: unknown;
    };
    if (typeof body.state !== "string" || typeof body.official !== "string") {
      return { kind: "unreachable" };
    }
    return response.ok && body.state === "active" && body.official === "ok"
      ? { kind: "healthy", build: typeof body.build === "string" ? body.build : "" }
      : { kind: "not-ready", state: body.state, official: body.official };
  } catch {
    return { kind: "unreachable" };
  }
}

export function makeHqApi(input: {
  /** HQ's origin, as its anchor names it. */
  readonly address: string;
  readonly fetch: FetchImplementation;
  /** Mints a throwaway for HQ's door, hands its value to `use` alone, and deletes it. */
  readonly throughDoor: <T>(use: (token: string) => Promise<T>) => Promise<T>;
}): HqApi {
  const origin = input.address.replace(/\/+$/u, "");
  /** The session HQ issued, or the door exchange under way that will issue it. */
  let session: Promise<string> | null = null;

  const enter = () => {
    const entering = input
      .throughDoor((token) =>
        call<{ readonly session: string }>(input.fetch, `${origin}/api/door`, {
          method: "POST",
          body: JSON.stringify({ token }),
        }),
      )
      .then((answer) => answer.session);
    // A door that refused is not a session: the next call asks again.
    entering.catch(() => {
      if (session === entering) session = null;
    });
    session = entering;
    return entering;
  };

  /** A call as the session's holder; a session HQ no longer takes is replaced once. */
  const authorized = async <T>(path: string, init: RequestInit = {}): Promise<T> => {
    for (let attempt = 0; ; attempt += 1) {
      const held = session ?? enter();
      const token = await held;
      try {
        return await call<T>(input.fetch, `${origin}${path}`, {
          ...init,
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (cause) {
        const stale = cause instanceof HqError && cause.code === "session_required";
        if (!stale || attempt > 0) throw cause;
        if (session === held) session = null;
      }
    }
  };

  return {
    structure: (signal) =>
      authorized<HqStructure>("/api/structure", signal === undefined ? {} : { signal }),
    createApp: (name) =>
      authorized("/api/apps", { method: "POST", body: JSON.stringify({ name }) }),
    attachProject: async (appId, attach) => {
      await authorized(`/api/apps/${encodeURIComponent(appId)}/projects`, {
        method: "POST",
        body: JSON.stringify(attach),
      });
    },
  };
}

/**
 * Attaches a project to an application. HQ refuses a project attached already (`409 conflict`):
 * one attached there as asked is the same write run twice — a press tried again — and stands;
 * any other conflict is the refusal it is.
 */
export async function attachToApp(api: HqApi, appId: string, attach: HqAttach): Promise<void> {
  try {
    await api.attachProject(appId, attach);
  } catch (cause) {
    if (!(cause instanceof HqError && cause.code === "conflict")) throw cause;
    const { apps } = await api.structure();
    const there = apps
      .find((app) => app.id === appId)
      ?.projects.some(
        (project) => project.projectId === attach.projectId && project.kind === attach.kind,
      );
    if (there !== true) throw cause;
  }
}
