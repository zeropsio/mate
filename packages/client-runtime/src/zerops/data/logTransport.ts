import {
  buildLogUrls,
  buildOlderLogUrl,
  decodeBuildLogItems,
  withStreamFrom,
  type BuildLogLine,
  type BuildLogQuery,
} from "../activity/buildLog.ts";
import type { AccountScope, ProjectRef } from "./types.ts";

export type BuildLogTransportErrorKind =
  | "account-fence"
  | "closed"
  | "grant"
  | "http"
  | "decode"
  | "socket";

/** A deliberately sanitized error: signed URLs and transport causes never cross this boundary. */
export class BuildLogTransportError extends Error {
  readonly kind: BuildLogTransportErrorKind;

  constructor(kind: BuildLogTransportErrorKind) {
    super(`Build log transport failed (${kind}).`);
    this.name = "BuildLogTransportError";
    this.kind = kind;
  }
}

export interface BuildLogGrant {
  /** Bearer-like signed URL. It must remain inside the transport. */
  readonly url: string;
}

interface MinimalFetchResponse {
  readonly ok: boolean;
  json(): Promise<unknown>;
}

export type BuildLogFetch = (url: string, signal: AbortSignal) => Promise<MinimalFetchResponse>;

export interface BuildLogSocket {
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(type: "error" | "close", listener: () => void): void;
  close(): void;
}

export type BuildLogSocketConstructor = new (url: string) => BuildLogSocket;

export interface BuildLogPageRequest {
  readonly project: ProjectRef;
  readonly query: BuildLogQuery;
  readonly limit: number;
  readonly beforeLineId?: string;
  /** Cancels grant acquisition or page transport when the owning lease ends. */
  readonly signal?: AbortSignal;
}

export interface BuildLogTransportPage {
  readonly lines: ReadonlyArray<BuildLogLine>;
  readonly rejectedItems: number;
}

export interface BuildLogFollowCallbacks {
  readonly onLines: (lines: ReadonlyArray<BuildLogLine>, rejectedItems: number) => void;
  readonly onMalformedFrame: () => void;
  readonly onError: () => void;
  readonly onClose: () => void;
}

export interface BuildLogFollowRequest {
  readonly project: ProjectRef;
  readonly query: BuildLogQuery;
  readonly fromLineId?: string;
  readonly callbacks: BuildLogFollowCallbacks;
  /** Fences a pending socket open when the owning lease ends. */
  readonly signal?: AbortSignal;
}

export interface BuildLogFollowHandle {
  close(): void;
}

export interface BuildLogTransport {
  loadPage(request: BuildLogPageRequest): Promise<BuildLogTransportPage>;
  openFollow(request: BuildLogFollowRequest): Promise<BuildLogFollowHandle>;
  /** Idempotently fences late grants/callbacks, erases retained state and closes every socket. */
  shutdown(): void;
  diagnostics(): { readonly activeFollowers: number; readonly closed: boolean };
}

export interface BuildLogTransportOptions {
  readonly scope: AccountScope;
  /** `GET /project/{id}/log`; the endpoint only proves access to that project's log URL. */
  readonly acquireGrant: (project: ProjectRef, signal: AbortSignal) => Promise<BuildLogGrant>;
  readonly fetchImpl: BuildLogFetch;
  readonly WebSocketCtor: BuildLogSocketConstructor;
}

const belongsToScope = (scope: AccountScope, project: ProjectRef): boolean => {
  const account = project.organization.account;
  return (
    account.apiOrigin === scope.account.apiOrigin && account.accountId === scope.account.accountId
  );
};

const parseFrame = (data: unknown): unknown => {
  if (typeof data !== "string") return data;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
};

/**
 * Owns all signed URL use. A fresh grant is acquired for every page and socket
 * open because the platform response exposes no expiry contract that this
 * client can safely cache or interpret.
 */
export function makeBuildLogTransport(options: BuildLogTransportOptions): BuildLogTransport {
  const fetchImpl = options.fetchImpl;
  const WebSocketCtor = options.WebSocketCtor;
  const followers = new Set<BuildLogFollowHandle>();
  const requests = new Set<AbortController>();
  let generation = 0;
  let closed = false;

  const guard = (project: ProjectRef): number => {
    if (closed) throw new BuildLogTransportError("closed");
    if (!belongsToScope(options.scope, project)) {
      throw new BuildLogTransportError("account-fence");
    }
    return generation;
  };

  const acquire = async (
    project: ProjectRef,
    expectedGeneration: number,
    signal: AbortSignal,
  ): Promise<string> => {
    let grant: BuildLogGrant;
    try {
      grant = await options.acquireGrant(project, signal);
    } catch {
      if (closed || generation !== expectedGeneration || signal.aborted) {
        throw new BuildLogTransportError("closed");
      }
      throw new BuildLogTransportError("grant");
    }
    if (closed || generation !== expectedGeneration || signal.aborted) {
      grant = { url: "" };
      throw new BuildLogTransportError("closed");
    }
    const url = grant.url;
    grant = { url: "" };
    return url;
  };

  const loadPage = async (request: BuildLogPageRequest): Promise<BuildLogTransportPage> => {
    const expectedGeneration = guard(request.project);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal?.addEventListener("abort", abort, { once: true });
    if (request.signal?.aborted) controller.abort();
    requests.add(controller);
    let grantUrl = "";
    let requestUrl = "";
    try {
      if (controller.signal.aborted) throw new BuildLogTransportError("closed");
      grantUrl = await acquire(request.project, expectedGeneration, controller.signal);
      requestUrl =
        request.beforeLineId === undefined
          ? buildLogUrls({ url: grantUrl }, request.query, request.limit).http
          : buildOlderLogUrl({ url: grantUrl }, request.query, request.beforeLineId, request.limit);
      grantUrl = "";
      let response: MinimalFetchResponse;
      try {
        response = await fetchImpl(requestUrl, controller.signal);
        requestUrl = "";
      } catch {
        if (closed || generation !== expectedGeneration || controller.signal.aborted) {
          throw new BuildLogTransportError("closed");
        }
        throw new BuildLogTransportError("http");
      }
      if (closed || generation !== expectedGeneration) {
        throw new BuildLogTransportError("closed");
      }
      if (!response.ok) throw new BuildLogTransportError("http");
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new BuildLogTransportError("decode");
      }
      if (closed || generation !== expectedGeneration) {
        throw new BuildLogTransportError("closed");
      }
      const decoded = decodeBuildLogItems(body);
      if (decoded.malformedEnvelope) throw new BuildLogTransportError("decode");
      return { lines: decoded.lines, rejectedItems: decoded.rejectedItems };
    } catch (error) {
      if (error instanceof BuildLogTransportError) throw error;
      throw new BuildLogTransportError("http");
    } finally {
      requests.delete(controller);
      request.signal?.removeEventListener("abort", abort);
      grantUrl = "";
      requestUrl = "";
    }
  };

  const openFollow = async (request: BuildLogFollowRequest): Promise<BuildLogFollowHandle> => {
    const expectedGeneration = guard(request.project);
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal?.addEventListener("abort", abort, { once: true });
    if (request.signal?.aborted) controller.abort();
    requests.add(controller);
    let grantUrl = "";
    let baseUrl = "";
    let socketUrl = "";
    try {
      if (controller.signal.aborted) throw new BuildLogTransportError("closed");
      grantUrl = await acquire(request.project, expectedGeneration, controller.signal);
      baseUrl = buildLogUrls({ url: grantUrl }, request.query).ws;
      grantUrl = "";
      socketUrl =
        request.fromLineId === undefined ? baseUrl : withStreamFrom(baseUrl, request.fromLineId);
      baseUrl = "";
      let socket: BuildLogSocket | undefined;
      try {
        socket = new WebSocketCtor(socketUrl);
      } catch {
        throw new BuildLogTransportError("socket");
      } finally {
        socketUrl = "";
      }

      if (controller.signal.aborted) {
        socket.close();
        throw new BuildLogTransportError("closed");
      }

      let locallyClosed = false;
      const handle: BuildLogFollowHandle = {
        close: () => {
          if (locallyClosed) return;
          locallyClosed = true;
          followers.delete(handle);
          const openSocket = socket;
          socket = undefined;
          openSocket?.close();
        },
      };
      followers.add(handle);

      socket.addEventListener("message", (event) => {
        if (locallyClosed || closed || generation !== expectedGeneration) return;
        const decoded = decodeBuildLogItems(parseFrame(event.data));
        if (decoded.malformedEnvelope) {
          request.callbacks.onMalformedFrame();
          return;
        }
        if (decoded.lines.length > 0 || decoded.rejectedItems > 0) {
          request.callbacks.onLines(decoded.lines, decoded.rejectedItems);
        }
      });
      socket.addEventListener("error", () => {
        if (!locallyClosed && !closed && generation === expectedGeneration) {
          request.callbacks.onError();
        }
      });
      socket.addEventListener("close", () => {
        followers.delete(handle);
        socket = undefined;
        if (!locallyClosed && !closed && generation === expectedGeneration) {
          request.callbacks.onClose();
        }
      });

      if (closed || generation !== expectedGeneration) {
        handle.close();
        throw new BuildLogTransportError("closed");
      }
      return handle;
    } catch (error) {
      if (error instanceof BuildLogTransportError) throw error;
      throw new BuildLogTransportError("socket");
    } finally {
      requests.delete(controller);
      request.signal?.removeEventListener("abort", abort);
      grantUrl = "";
      baseUrl = "";
      socketUrl = "";
    }
  };

  const shutdown = (): void => {
    if (closed) return;
    closed = true;
    generation += 1;
    for (const request of requests) request.abort();
    requests.clear();
    for (const follower of followers) follower.close();
    followers.clear();
  };

  return {
    loadPage,
    openFollow,
    shutdown,
    diagnostics: () => ({ activeFollowers: followers.size, closed }),
  };
}
