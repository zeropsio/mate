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
import {
  attachmentPath,
  ChangeDetailResponse,
  CommentListResponse,
  HqChangeComment,
  type AttachmentLink,
  type ChangeLink,
} from "@t3tools/shared/hqChanges";
import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import type { FetchImplementation } from "../api.ts";
import { hqRefusalWords } from "./refusals.ts";
import { structureEventOf, type HqStructureEvent } from "./stream.ts";

/** An organization's HQ: its project, and the address its anchor names. */
export interface HqEndpoint {
  readonly projectId: string;
  readonly address: string;
}

/** A Mate's record in HQ: its name, and its face in the grammar `readMateFace` reads. */
export interface HqMate {
  readonly name: string;
  readonly face: string;
}

/** What `GET /api/structure` answers: the applications as the reader sees them in Zerops. */
export interface HqStructure {
  /** The Mates HQ holds in no application: their project's name in Zerops, and their record. */
  readonly ungrouped: ReadonlyArray<{
    readonly projectId: string;
    readonly name: string;
    readonly mate: HqMate;
  }>;
  readonly apps: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly projects: ReadonlyArray<{
      readonly projectId: string;
      readonly name: string;
      readonly kind: string;
      readonly mate: HqMate | null;
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
  /**
   * The structure as it changes (`stream.ts`), over a socket opened with a ticket for the session:
   * every event to `onEvent`, every message — events and pings alike — to `onAlive`. Ends when HQ
   * hands the reader to another Core, or ends the session (the next call enters the door again);
   * fails when the socket breaks; runs until `signal` aborts.
   */
  readonly streamStructure: (
    handlers: {
      readonly onEvent: (event: HqStructureEvent) => void;
      readonly onAlive: () => void;
    },
    signal: AbortSignal,
  ) => Promise<void>;
  /** A Mate's name or face, as HQ records them (`PATCH /api/mates/{projectId}`). */
  readonly updateMate: (
    projectId: string,
    change: { readonly name?: string; readonly face?: string },
  ) => Promise<void>;
  /** An application's name (`PATCH /api/apps/{id}`). */
  readonly renameApp: (appId: string, name: string) => Promise<void>;
  /**
   * A project into an application as `kind`, or a Mate out of every one — `appId: null` (`PUT
   * /api/projects/{projectId}/app`).
   */
  readonly moveProject: (
    projectId: string,
    to: { readonly appId: string | null; readonly kind: RoleProjectKind },
  ) => Promise<void>;
  /** A Mate set up on a project of its own, in no application (`POST /api/mates`). */
  readonly createMate: (mate: { readonly projectId: string } & HqMate) => Promise<void>;
  readonly createApp: (name: string) => Promise<{ readonly id: string; readonly name: string }>;
  readonly attachProject: (appId: string, attach: HqAttach) => Promise<void>;
  /** A Mate's change with what its review reads (`GET /api/apps/:appId/changes/:repo/:n`). */
  readonly change: (link: ChangeLink, signal?: AbortSignal) => Promise<ChangeDetailResponse>;
  /** What was said on a change, oldest first. */
  readonly changeComments: (
    link: ChangeLink,
    signal?: AbortSignal,
  ) => Promise<ReadonlyArray<HqChangeComment>>;
  /** Says `body` on a change, as the person. */
  readonly commentOnChange: (link: ChangeLink, body: string) => Promise<HqChangeComment>;
  /** A picture of a change, read as the person (`attachmentPath`). */
  readonly changeAttachment: (link: AttachmentLink, signal?: AbortSignal) => Promise<Blob>;
}

/** A socket the structure stream reads, opened by the host (`WebSocket` in a browser). */
export interface HqSocket {
  readonly send: (data: string) => void;
  readonly close: () => void;
}

/** Opens `url`, telling `on` of every text message and of the close, with its code. */
export type OpenHqSocket = (
  url: string,
  on: { readonly message: (data: string) => void; readonly close: (code: number) => void },
) => HqSocket;

/** How HQ closes a structure socket (`apps/hq/src/stream.ts`). */
const SOCKET_CLOSE = {
  /** Another Core leads now, or this one is stopping: read again at once. */
  goingAway: 1001,
  /** The session ended: enter the door again. */
  sessionEnded: 4401,
} as const;

const PONG = JSON.stringify({ type: "pong" });

const CALL_TIMEOUT_MS = 20_000;

/** HQ's code and reason in an answer's body; a body that is not HQ's JSON names neither. */
function said(text: string): { readonly code?: unknown; readonly reason?: unknown } {
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
    message: hqRefusalWords({
      code,
      reason: typeof body.reason === "string" ? body.reason : undefined,
    }),
  });
}

/** A call stopped by its caller or by its own timeout: never one to try again. */
const stopped = (cause: unknown, signal: AbortSignal | null | undefined) =>
  signal?.aborted === true ||
  (cause instanceof DOMException && (cause.name === "AbortError" || cause.name === "TimeoutError"));

/**
 * One call to HQ: its answer, or an {@link HqError}. A connection that drops under the call is
 * tried once more — a kept-alive connection is cut as HQ's Core is redeployed (measured on the rig,
 * 2026-10-02) — and HQ's own answer never is.
 */
async function send(fetch: FetchImplementation, url: string, init: RequestInit): Promise<Response> {
  const signal = init.signal ?? AbortSignal.timeout(CALL_TIMEOUT_MS);
  const headers = {
    Accept: "application/json",
    ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    ...init.headers,
  };
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal, headers });
    } catch (cause) {
      if (attempt === 0 && !stopped(cause, signal)) continue;
      throw new HqError({
        kind: "unavailable",
        code: "network",
        message: "HQ could not be reached.",
      });
    }
    if (!response.ok) throw await errorOf(response);
    return response;
  }
}

const json = async <T>(response: Response): Promise<T> => (await response.json()) as T;

/**
 * An answer read through the contract's schema (`@t3tools/shared/hqChanges`): one this version of
 * Mate cannot read is refused, never drawn in part.
 */
const decoded =
  <S extends Schema.Decoder<unknown>>(schema: S) =>
  async (response: Response): Promise<S["Type"]> => {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw unreadable();
    }
    return Option.getOrThrowWith(Schema.decodeUnknownOption(schema)(body), unreadable);
  };

const unreadable = () =>
  new HqError({
    kind: "refused",
    code: "unreadable",
    message: "HQ answered in a form this version of Mate does not read.",
  });

const readChangeDetail = decoded(ChangeDetailResponse);
const readComments = decoded(CommentListResponse);
const readComment = decoded(HqChangeComment);

/** A change's own path at HQ's API. */
const changePath = ({ appId, repo, number }: ChangeLink): string =>
  `/api/apps/${encodeURIComponent(appId)}/changes/${encodeURIComponent(repo)}/${String(number)}`;

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
  readonly openSocket: OpenHqSocket;
}): HqApi {
  const origin = input.address.replace(/\/+$/u, "");
  /** The session HQ issued, or the door exchange under way that will issue it. */
  let session: Promise<string> | null = null;

  const enter = () => {
    const entering = input
      .throughDoor(async (token) =>
        json<{ readonly session: string }>(
          await send(input.fetch, `${origin}/api/door`, {
            method: "POST",
            body: JSON.stringify({ token }),
          }),
        ),
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
  const authorized = async (path: string, init: RequestInit = {}): Promise<Response> => {
    for (let attempt = 0; ; attempt += 1) {
      const held = session ?? enter();
      const token = await held;
      try {
        return await send(input.fetch, `${origin}${path}`, {
          ...init,
          headers: { ...init.headers, Authorization: `Bearer ${token}` },
        });
      } catch (cause) {
        const stale = cause instanceof HqError && cause.code === "session_required";
        if (!stale || attempt > 0) throw cause;
        if (session === held) session = null;
      }
    }
  };

  return {
    structure: async (signal) =>
      json<HqStructure>(await authorized("/api/structure", signal === undefined ? {} : { signal })),
    streamStructure: async (handlers, signal) => {
      const { ticket } = await json<{ readonly ticket: string }>(
        await authorized("/api/stream-ticket", { method: "POST", signal }),
      );
      /** The session the ticket was minted for. */
      const held = session;
      const url = `${origin.replace(/^http/u, "ws")}/api/structure/ws?ticket=${encodeURIComponent(ticket)}`;
      await new Promise<void>((resolve, reject) => {
        const socket = input.openSocket(url, {
          message: (data) => {
            handlers.onAlive();
            let message: unknown;
            try {
              message = JSON.parse(data);
            } catch {
              return;
            }
            if ((message as { readonly type?: unknown } | null)?.type === "ping") {
              socket.send(PONG);
              return;
            }
            const event = structureEventOf(message);
            if (event !== undefined) handlers.onEvent(event);
          },
          close: (code) => {
            signal.removeEventListener("abort", stop);
            if (code === SOCKET_CLOSE.sessionEnded) {
              // The next call enters the door again, the next socket with it.
              if (session === held) session = null;
              resolve();
            } else if (code === SOCKET_CLOSE.goingAway) {
              resolve();
            } else {
              reject(
                new HqError({
                  kind: "unavailable",
                  code: `socket_${code}`,
                  message: "HQ's stream broke.",
                }),
              );
            }
          },
        });
        const stop = () => socket.close();
        signal.addEventListener("abort", stop, { once: true });
      });
    },
    createApp: async (name) =>
      json(await authorized("/api/apps", { method: "POST", body: JSON.stringify({ name }) })),
    attachProject: async (appId, attach) => {
      await authorized(`/api/apps/${encodeURIComponent(appId)}/projects`, {
        method: "POST",
        body: JSON.stringify(attach),
      });
    },
    updateMate: async (projectId, change) => {
      await authorized(`/api/mates/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        body: JSON.stringify(change),
      });
    },
    renameApp: async (appId, name) => {
      await authorized(`/api/apps/${encodeURIComponent(appId)}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      });
    },
    moveProject: async (projectId, to) => {
      await authorized(`/api/projects/${encodeURIComponent(projectId)}/app`, {
        method: "PUT",
        body: JSON.stringify(to),
      });
    },
    createMate: async (mate) => {
      await authorized("/api/mates", { method: "POST", body: JSON.stringify(mate) });
    },
    change: async (link, signal) =>
      readChangeDetail(await authorized(changePath(link), signal === undefined ? {} : { signal })),
    changeComments: async (link, signal) =>
      (
        await readComments(
          await authorized(`${changePath(link)}/comments`, signal === undefined ? {} : { signal }),
        )
      ).comments,
    commentOnChange: async (link, body) =>
      readComment(
        await authorized(`${changePath(link)}/comments`, {
          method: "POST",
          body: JSON.stringify({ body }),
        }),
      ),
    changeAttachment: async (link, signal) =>
      (
        await authorized(attachmentPath(link.appId, link.repo, link.number, link.id), {
          headers: { Accept: "image/png" },
          ...(signal === undefined ? {} : { signal }),
        })
      ).blob(),
  };
}

/**
 * Attaches a project to an application. HQ refuses a project attached already (`409 conflict`):
 * one attached there as asked is the same write run twice — a press tried again — and stands;
 * any other conflict is the refusal it is.
 */
export async function attachToApp(
  api: Pick<HqApi, "attachProject" | "structure">,
  appId: string,
  attach: HqAttach,
): Promise<void> {
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
