import * as Schema from "effect/Schema";
import { derivePublicAccess } from "../publicRoutes.ts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { commandDeadlineMs, DEFAULT_ZEROPS_DATA_POLICY, type ZeropsDataPolicy } from "./policy.ts";
import {
  decodeProjectCommandResponse,
  decodeEntityDirectResponse,
  decodeDirectListPage,
  decodeEntityQueryPages,
  decodeEntityQueryResponse,
  decodeNativeFrame,
  decodeRegistrationResponse,
  decodeSearchListPage,
  isRowIssue,
  type ProtocolDecodeIssue,
} from "./platformProtocol.ts";
import { mateDiagnostics } from "../diagnostics.ts";
import type {
  AdapterError,
  MembershipQueryDescriptor,
  PlatformCommand,
  PlatformCommandReceipt,
  PlatformObservation,
  PlatformReadRequest,
  PlatformReadResult,
  ReceiverEvent,
  ReceiverHandle,
  RegistrationRequest,
  RegistrationReceipt,
  RequestContext,
  ZeropsDataAdapter,
  ZeropsWireSubscriptionName,
} from "./types.ts";
import type { TableQueryDescriptor } from "./types.ts";
import { decodeTableSearch } from "./tableProtocol.ts";
import { ZeropsApiError, ZeropsWriteNotSent, type ZeropsApiClient } from "../api.ts";
import type { ZeropsIntegrationToken } from "../groupReach.ts";
import type { PlatformWatchSocket, PlatformWatchTimers } from "./platformSocket.ts";
import type {
  ZeropsCellAdapter,
  ZeropsCellSourceError,
  ZeropsIntegrationTokenMetadata,
} from "./cells.ts";

const PUBLIC_WS_PATH = "/api/rest/public/web-socket";

export interface ZeropsDataAdapterOptions {
  readonly client: ZeropsApiClient;
  readonly makeSocket: (url: string) => PlatformWatchSocket;
  /** Injected so tests and the runtime own all handshake deadlines. */
  readonly timers: PlatformWatchTimers;
  readonly policy?: ZeropsDataPolicy;
}

type BufferedReceiverItem =
  | {
      readonly kind: "event";
      readonly event: ReceiverEvent;
      readonly bytes: number;
    }
  | { readonly kind: "failure"; readonly error: AdapterError };

interface OpenReceiverInternals {
  readonly handle: ReceiverHandle;
  readonly socket: PlatformWatchSocket;
  readonly registrations: Map<ZeropsWireSubscriptionName, RegistrationRequest>;
  readonly isClosed: () => boolean;
  readonly close: Effect.Effect<void>;
}

const adapterError = (
  kind: AdapterError["kind"],
  message: string,
  retryable = true,
): AdapterError => ({
  _tag: "ZeropsDataAdapterError",
  kind,
  message,
  retryable,
  accountRevocationEvidence: false,
});

const nonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

function importProjectId(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("projectId" in value)) return null;
  return nonEmptyString(value.projectId) ? value.projectId : null;
}

/** Whether an import's answer names its services and each one's processes well. */
function importProcessesWellFormed(value: unknown): boolean {
  if (
    typeof value !== "object" ||
    value === null ||
    !("serviceStacks" in value) ||
    !Array.isArray(value.serviceStacks)
  )
    return false;
  for (const stack of value.serviceStacks) {
    if (typeof stack !== "object" || stack === null) return false;
    if (!("processes" in stack) || stack.processes === undefined) continue;
    if (!Array.isArray(stack.processes)) return false;
    for (const process of stack.processes) {
      if (
        typeof process !== "object" ||
        process === null ||
        !("id" in process) ||
        !nonEmptyString(process.id)
      )
        return false;
    }
  }
  return true;
}

function errorFrom(cause: unknown, fallback: AdapterError["kind"]): AdapterError {
  // Refused before it was sent: classified as the admission's own refusal.
  if (cause instanceof ZeropsWriteNotSent) return errorFrom(cause.refusal, fallback);
  if (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    cause._tag === "ZeropsDataAdapterError"
  )
    return cause as AdapterError;
  if (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    cause._tag === "ZeropsCommandAdmissionError" &&
    "message" in cause &&
    typeof cause.message === "string"
  )
    return adapterError("rejected", cause.message, false);
  if (cause instanceof ZeropsApiError) {
    const kind =
      cause.kind === "expired-session"
        ? "unauthorized"
        : cause.kind === "forbidden"
          ? "forbidden"
          : cause.kind === "not-found"
            ? "not-found"
            : cause.kind === "server"
              ? "server"
              : cause.kind === "network"
                ? "network"
                : cause.kind === "uncertain"
                  ? "uncertain"
                  : cause.kind === "invalid-input"
                    ? "rejected"
                    : fallback;
    const error = adapterError(
      kind,
      kind === "rejected" ? refusedMessage(cause.detail) : fixedApiErrorMessage(kind),
      !["forbidden", "not-found", "rejected"].includes(kind),
    );
    return {
      ...error,
      ...(cause.status === null ? {} : { status: cause.status }),
      ...(cause.retryAfterMs === null ? {} : { retryAfterMs: cause.retryAfterMs }),
    };
  }
  return adapterError(fallback, "Zerops adapter failed.");
}

/**
 * Never forwards the backend `ZeropsApiError.message` into a public reason:
 * that text is server-authored and may carry request-specific detail this
 * layer has not reviewed for exposure. Each adapter error kind gets a fixed,
 * reviewed sentence instead; the kind itself still distinguishes causes.
 */
/**
 * The one exception: a refusal the platform clearly gave — `400`, with its
 * own validation words — is forwarded as it came. It describes the person's
 * own request and is what they need to fix it; a fixed sentence left a
 * two-name project block reading as "uncertain" (the rehearsal, 2026-09-17).
 */
function refusedMessage(detail: string | null): string {
  return detail === null ? "Zerops refused the request." : `Zerops refused the request: ${detail}`;
}

function fixedApiErrorMessage(kind: AdapterError["kind"]): string {
  switch (kind) {
    case "unauthorized":
      return "Zerops rejected the request (unauthorized).";
    case "forbidden":
      return "Zerops rejected the request (forbidden).";
    case "not-found":
      return "Zerops rejected the request (not found).";
    case "server":
      return "Zerops rejected the request (server error).";
    case "network":
      return "Zerops request failed (network error).";
    case "uncertain":
      return "Zerops request result is uncertain.";
    default:
      return "Zerops adapter failed.";
  }
}

function wsUrl(apiBase: string, receiverId: string, webSocketToken: string): string {
  const wsBase = apiBase.replace(/\/+$/, "").replace(/^http/i, "ws");
  return `${wsBase}${PUBLIC_WS_PATH}/${receiverId}/${webSocketToken}`;
}

function stageSignal(
  context: RequestContext,
  timeoutMs: number,
  timers: PlatformWatchTimers,
  nowMs: number,
): { readonly signal: AbortSignal; readonly expired: boolean; readonly dispose: () => void } {
  const controller = new AbortController();
  const remainingMs = context.deadlineMs - nowMs;
  const expired = remainingMs <= 0;
  const handle = expired
    ? undefined
    : timers.setTimer(() => controller.abort(), Math.min(timeoutMs, remainingMs));
  const onAbort = () => controller.abort();
  context.abortSignal.addEventListener("abort", onAbort, { once: true });
  if (expired || context.abortSignal.aborted) controller.abort();
  return {
    signal: controller.signal,
    expired,
    dispose: () => {
      if (handle !== undefined) timers.clearTimer(handle);
      context.abortSignal.removeEventListener("abort", onAbort);
    },
  };
}

function requestEffect(
  client: ZeropsApiClient,
  input: Omit<Parameters<ZeropsApiClient["requestData"]>[0], "signal">,
  context: RequestContext,
  timeoutMs: number,
  timers: PlatformWatchTimers,
  failureKind: AdapterError["kind"],
): Effect.Effect<unknown, AdapterError> {
  return Effect.acquireUseRelease(
    Clock.currentTimeMillis.pipe(Effect.map((now) => stageSignal(context, timeoutMs, timers, now))),
    ({ signal, expired }) =>
      expired
        ? Effect.fail(adapterError("timeout", "Zerops request context already expired.", false))
        : context.abortSignal.aborted
          ? Effect.fail(adapterError("cancelled", "Zerops request was cancelled.", false))
          : Effect.tryPromise({
              try: () => client.requestData({ ...input, signal }),
              catch: (cause) =>
                context.abortSignal.aborted
                  ? adapterError("cancelled", "Zerops request was cancelled.", false)
                  : signal.aborted
                    ? adapterError("timeout", "Zerops request exceeded its deadline.")
                    : errorFrom(cause, failureKind),
            }),
    ({ dispose }) => Effect.sync(dispose),
  );
}

/** A row the platform sent malformed is dropped and noted, once per kind of fault. */
function reportDroppedRows(issues: ReadonlyArray<ProtocolDecodeIssue>): void {
  for (const issue of issues) {
    if (isRowIssue(issue))
      mateDiagnostics.recordOnce({ kind: "dropped-row", message: issue.message });
  }
}

function queryOrganizationId(query: MembershipQueryDescriptor): string {
  return "project" in query
    ? query.project.organization.organizationId
    : query.organization.organizationId;
}

function registrationOrganization(request: RegistrationRequest) {
  const descriptor = request.descriptor;
  if (descriptor.kind === "table-list") return descriptor.query.organization;
  return descriptor.kind === "entity-updates" || descriptor.kind === "table-updates"
    ? descriptor.organization
    : "project" in descriptor.query
      ? descriptor.query.project.organization
      : descriptor.query.organization;
}

function sameReceiverIdentity(
  left: RegistrationRequest["identity"]["receiver"],
  right: ReceiverHandle["identity"],
): boolean {
  return (
    left.accountEpoch === right.accountEpoch &&
    left.receiverEpoch === right.receiverEpoch &&
    left.receiverId === right.receiverId
  );
}

function searchTerms(
  query: MembershipQueryDescriptor,
): ReadonlyArray<Readonly<Record<string, unknown>>> {
  const terms: Array<Readonly<Record<string, unknown>>> = [
    { name: "clientId", operator: "eq", value: queryOrganizationId(query) },
  ];
  if ("project" in query)
    terms.push({ name: "projectId", operator: "eq", value: query.project.projectId });
  if (query.kind === "projects-of-organization" && query.statuses.length)
    terms.push({ name: "status", operator: "in", value: query.statuses });
  return terms;
}

/**
 * The rows one organization-wide search answers with: its projects, its services or its running
 * processes. The platform accepts far more than its usual 500 (measured 2026-10-01: a limit of
 * 2000 answered all 244 services of the test organization in one page), and an organization's
 * whole inventory is one page of it.
 */
const ORGANIZATION_SEARCH_LIMIT = 2000;

/** The search a table list is: its organization's rows its kind holds (`entityTable.ts`). */
function tableSearch(query: TableQueryDescriptor) {
  return {
    path: "/user-data/search",
    body: {
      search: [
        { name: "clientId", operator: "eq", value: query.organization.organizationId },
        { name: "serviceStackId", operator: "in", value: query.serviceIds },
        { name: "key", operator: "in", value: query.keys },
        ...(query.ids === undefined ? [] : [{ name: "id", operator: "in", value: query.ids }]),
      ],
      sort: [],
      limit: query.ids === undefined ? ORGANIZATION_SEARCH_LIMIT : Math.max(1, query.ids.length),
    },
  };
}

function registrationHttp(request: RegistrationRequest, receiver: ReceiverHandle) {
  const common = {
    receiverId: receiver.identity.receiverId,
    subscriptionName: request.subscriptionName,
  };
  const descriptor = request.descriptor;
  if (descriptor.kind === "table-updates") {
    return {
      path: `/${descriptor.entity}/search`,
      body: {
        search: [
          { name: "clientId", operator: "eq", value: descriptor.organization.organizationId },
          { name: "serviceStackId", operator: "in", value: descriptor.serviceIds },
        ],
        sort: [],
        ...common,
        wsOutputType: "updateStream",
        disableOutput: true,
      },
    };
  }
  if (descriptor.kind === "table-list") {
    const search = tableSearch(descriptor.query);
    return { path: search.path, body: { ...search.body, ...common, wsOutputType: "listStream" } };
  }
  if (descriptor.kind === "entity-updates") {
    const entity = descriptor.entity === "service" ? "service-stack" : descriptor.entity;
    return {
      path: `/${entity}/search`,
      body: {
        search: [
          { name: "clientId", operator: "eq", value: descriptor.organization.organizationId },
          ...("project" in descriptor
            ? [{ name: "projectId", operator: "eq", value: descriptor.project.projectId }]
            : []),
        ],
        sort: [],
        ...common,
        wsOutputType: "updateStream",
        disableOutput: true,
      },
    };
  }
  const entity = descriptor.query.kind === "projects-of-organization" ? "project" : "service-stack";
  return {
    path: `/${entity}/search`,
    body: {
      search: searchTerms(descriptor.query),
      sort: [],
      limit: ORGANIZATION_SEARCH_LIMIT,
      ...common,
      wsOutputType: "listStream",
    },
  };
}

function readHttp(ticket: PlatformReadRequest, offset = 0) {
  const target = ticket.target;
  if (target.kind === "project")
    return { path: `/project/${target.ref.projectId}`, method: "GET" as const };
  if (target.kind === "service")
    return { path: `/service-stack/${target.ref.serviceId}`, method: "GET" as const };
  const query = target.descriptor;
  if (query.kind === "service-variables-of-services") {
    const search = tableSearch(query);
    return {
      path: search.path,
      method: "POST" as const,
      body: { ...search.body, ...(offset ? { offset } : {}) },
    };
  }
  if (query.kind === "projects-of-organization")
    return {
      path: `/client/${query.organization.organizationId}/project?limit=500${offset ? `&offset=${offset}` : ""}`,
      method: "GET" as const,
    };
  return {
    path: `/project/${query.project.projectId}/service-stack?limit=500${offset ? `&offset=${offset}` : ""}`,
    method: "GET" as const,
  };
}

function decodeRead(ticket: PlatformReadRequest, body: unknown) {
  if (ticket.target.kind !== "query") return decodeEntityDirectResponse(ticket, body);
  switch (ticket.target.descriptor.kind) {
    case "projects-of-organization":
    case "services-of-project":
      return decodeEntityQueryResponse(ticket.target.descriptor, ticket, body, "direct-read");
    case "service-variables-of-services":
      return decodeTableSearch(ticket, body);
  }
}

/**
 * Creates the low-level account transport. The runtime owns receiver replacement,
 * desired-interest leases, manual attempts and ingestion ordering.
 */
export function makeZeropsDataAdapter(options: ZeropsDataAdapterOptions): ZeropsDataAdapter {
  const policy = options.policy ?? DEFAULT_ZEROPS_DATA_POLICY;
  const openReceivers = new WeakMap<ReceiverHandle, OpenReceiverInternals>();
  let accountBufferedEvents = 0;
  let accountBufferedBytes = 0;

  const openReceiver: ZeropsDataAdapter["openReceiver"] = (
    scope,
    organization,
    identity,
    context,
  ) =>
    Effect.gen(function* () {
      if (
        organization.account.apiOrigin !== scope.account.apiOrigin ||
        organization.account.accountId !== scope.account.accountId ||
        identity.accountEpoch !== scope.epoch
      )
        return yield* Effect.fail(
          adapterError("rejected", "Receiver scope does not match its account.", false),
        );

      const tokenStage = stageSignal(
        context,
        policy.socketTokenDeadlineMs,
        options.timers,
        yield* Clock.currentTimeMillis,
      );
      const token = yield* (
        tokenStage.expired
          ? Effect.fail(
              adapterError("timeout", "WebSocket token request context already expired.", false),
            )
          : context.abortSignal.aborted
            ? Effect.fail(
                adapterError("cancelled", "WebSocket token request was cancelled.", false),
              )
            : Effect.tryPromise({
                try: () => options.client.exchangeWebSocketToken(tokenStage.signal),
                catch: (cause) =>
                  context.abortSignal.aborted
                    ? adapterError("cancelled", "WebSocket token request was cancelled.", false)
                    : tokenStage.signal.aborted
                      ? adapterError("timeout", "WebSocket token exchange exceeded its deadline.")
                      : errorFrom(cause, "unauthorized"),
              })
      ).pipe(Effect.ensuring(Effect.sync(tokenStage.dispose)));

      const queue = yield* Queue.bounded<BufferedReceiverItem>(
        policy.ingressMaxEventsPerAccount + 1,
      );
      const registrations = new Map<ZeropsWireSubscriptionName, RegistrationRequest>();
      let socket: PlatformWatchSocket;
      let closed = false;
      let disposed = false;
      let greeted = false;
      let receiverBufferedEvents = 0;
      let receiverBufferedBytes = 0;
      let resolveOpen: (() => void) | undefined;
      let rejectOpen: ((error: AdapterError) => void) | undefined;
      let resolveGreeting: (() => void) | undefined;
      let rejectGreeting: ((error: AdapterError) => void) | undefined;
      let pingHandle: unknown;
      let pongHandle: unknown;

      const fail = (error: AdapterError): void => {
        Queue.offerUnsafe(queue, { kind: "failure", error });
      };
      const enqueueFrame = (events: ReadonlyArray<ReceiverEvent>, bytes: number): void => {
        if (closed) return;
        if (events.length === 0) return;
        if (
          bytes > policy.ingressMaxFrameBytes ||
          accountBufferedEvents + events.length > policy.ingressMaxEventsPerAccount ||
          accountBufferedBytes + bytes > policy.ingressMaxBytesPerAccount
        ) {
          closed = true;
          fail(adapterError("overflow", "Platform receiver ingress budget was exceeded."));
          closeSocketNow();
          return;
        }
        accountBufferedEvents += events.length;
        accountBufferedBytes += bytes;
        receiverBufferedEvents += events.length;
        receiverBufferedBytes += bytes;
        events.forEach((event, index) =>
          Queue.offerUnsafe(queue, { kind: "event", event, bytes: index === 0 ? bytes : 0 }),
        );
      };

      const releaseBuffered = (): void => {
        accountBufferedEvents = Math.max(0, accountBufferedEvents - receiverBufferedEvents);
        accountBufferedBytes = Math.max(0, accountBufferedBytes - receiverBufferedBytes);
        receiverBufferedEvents = 0;
        receiverBufferedBytes = 0;
      };

      const openPromise = new Promise<void>((resolve, reject) => {
        resolveOpen = resolve;
        rejectOpen = reject;
      });
      const greetingPromise = new Promise<void>((resolve, reject) => {
        resolveGreeting = resolve;
        rejectGreeting = reject;
      });

      socket = options.makeSocket(
        wsUrl(options.client.baseUrl, identity.receiverId, token.webSocketToken),
      );
      socket.onopen = () => resolveOpen?.();
      socket.onerror = () => {
        const error = adapterError("socket-open", "Platform receiver socket failed.");
        rejectOpen?.(error);
        rejectGreeting?.(error);
        if (greeted) {
          fail(error);
          closed = true;
          closeSocketNow();
        }
      };
      socket.onclose = () => {
        const error = adapterError("socket-closed", "Platform receiver socket closed.");
        rejectOpen?.(error);
        rejectGreeting?.(error);
        if (greeted) {
          enqueueFrame([{ kind: "closed", reason: error.message }], 0);
          closed = true;
          closeSocketNow();
        }
      };
      socket.onmessage = ({ data }) => {
        const bytes = new TextEncoder().encode(data).byteLength;
        if (!greeted) {
          try {
            const parsed: unknown = JSON.parse(data);
            if (
              typeof parsed === "object" &&
              parsed !== null &&
              "type" in parsed &&
              parsed.type === "SocketSuccess"
            ) {
              greeted = true;
              resolveGreeting?.();
              return;
            }
          } catch {
            rejectGreeting?.(adapterError("socket-greeting", "Socket greeting was not JSON."));
            return;
          }
          rejectGreeting?.(
            adapterError("socket-greeting", "Socket greeting was not SocketSuccess."),
          );
          return;
        }
        const decoded = decodeNativeFrame(data, registrations);
        if (decoded.kind === "observations") {
          reportDroppedRows(decoded.issues);
        }
        if (decoded.kind === "pong") {
          if (pongHandle !== undefined) {
            options.timers.clearTimer(pongHandle);
            pongHandle = undefined;
          }
          enqueueFrame([{ kind: "pong" }], bytes);
        } else if (decoded.kind === "malformed")
          enqueueFrame(
            [
              {
                kind: "malformed",
                ...(decoded.subscriptionName === undefined
                  ? {}
                  : { subscriptionName: decoded.subscriptionName }),
              },
            ],
            bytes,
          );
        else {
          enqueueFrame(
            [
              ...decoded.observations.map((observation, index): ReceiverEvent => ({
                kind: "observation",
                input: observation,
                bytes: index === 0 ? bytes : 0,
              })),
              ...(decoded.issues.some((issue) => !isRowIssue(issue))
                ? ([{ kind: "malformed" }] as const)
                : []),
            ],
            bytes,
          );
        }
      };

      const awaitStage = (
        promise: Promise<void>,
        timeoutMs: number,
        kind: "socket-open" | "socket-greeting",
      ) =>
        Effect.gen(function* () {
          const stage = stageSignal(
            context,
            timeoutMs,
            options.timers,
            yield* Clock.currentTimeMillis,
          );
          if (stage.expired)
            return yield* Effect.fail(
              adapterError(kind, `Platform ${kind} request context already expired.`, false),
            ).pipe(Effect.ensuring(Effect.sync(stage.dispose)));
          if (context.abortSignal.aborted)
            return yield* Effect.fail(
              adapterError("cancelled", `Platform ${kind} was cancelled.`, false),
            ).pipe(Effect.ensuring(Effect.sync(stage.dispose)));
          return yield* Effect.tryPromise({
            try: () =>
              new Promise<void>((resolve, reject) => {
                const onAbort = () =>
                  reject(adapterError(kind, `Platform ${kind} exceeded its deadline.`));
                stage.signal.addEventListener("abort", onAbort, { once: true });
                promise.then(resolve, reject);
              }),
            catch: (cause) => errorFrom(cause, kind),
          }).pipe(Effect.ensuring(Effect.sync(stage.dispose)));
        });

      const closeSocketNow = (): void => {
        if (pingHandle !== undefined) options.timers.clearTimer(pingHandle);
        if (pongHandle !== undefined) options.timers.clearTimer(pongHandle);
        pingHandle = undefined;
        pongHandle = undefined;
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.close();
      };
      const abortOpen = Effect.sync(() => {
        releaseBuffered();
        closeSocketNow();
      }).pipe(Effect.andThen(Queue.shutdown(queue)), Effect.asVoid);
      yield* awaitStage(openPromise, policy.socketOpenDeadlineMs, "socket-open").pipe(
        Effect.onError(() => abortOpen),
      );
      yield* awaitStage(greetingPromise, policy.socketGreetingDeadlineMs, "socket-greeting").pipe(
        Effect.onError(() => abortOpen),
      );

      const heartbeat = (): void => {
        if (closed) return;
        socket.send(JSON.stringify({ type: "ping" }));
        if (pongHandle !== undefined) options.timers.clearTimer(pongHandle);
        pongHandle = options.timers.setTimer(() => {
          if (closed) return;
          fail(adapterError("socket-closed", "Platform receiver missed its pong deadline."));
          closed = true;
          closeSocketNow();
        }, policy.pongDeadlineMs);
        pingHandle = options.timers.setTimer(heartbeat, policy.heartbeatIntervalMs);
      };
      heartbeat();

      const events = Stream.fromQueue(queue).pipe(
        Stream.mapEffect((item) => {
          if (item.kind === "failure") return Effect.fail(item.error);
          accountBufferedEvents = Math.max(0, accountBufferedEvents - 1);
          accountBufferedBytes = Math.max(0, accountBufferedBytes - item.bytes);
          receiverBufferedEvents = Math.max(0, receiverBufferedEvents - 1);
          receiverBufferedBytes = Math.max(0, receiverBufferedBytes - item.bytes);
          return Effect.succeed(item.event);
        }),
      );
      const handle: ReceiverHandle = {
        identity,
        organization,
        delivery: "hot-single-consumer-buffered-before-open-resolves",
        events,
      };
      const closeNow = () => {
        if (disposed) return;
        disposed = true;
        closed = true;
        releaseBuffered();
        closeSocketNow();
        registrations.clear();
      };
      const close = Effect.sync(closeNow).pipe(
        Effect.andThen(Queue.shutdown(queue)),
        Effect.asVoid,
      );
      const internals = { handle, socket, registrations, isClosed: () => closed, close };
      openReceivers.set(handle, internals);
      yield* Effect.addFinalizer(() => close);
      return handle;
    });

  /**
   * An organization-wide registration answers one page of ORGANIZATION_SEARCH_LIMIT rows. When
   * the organization holds more, the rest is read with the same search, page by page, without
   * registering again, and the registration's baseline is every page: an array of pages, or the
   * registration's own body when it was the whole.
   */
  const restOfOrganizationSearch = (
    request: RegistrationRequest,
    http: ReturnType<typeof registrationHttp>,
    body: unknown,
    context: RequestContext,
  ): Effect.Effect<unknown, AdapterError> =>
    Effect.gen(function* () {
      const limit = (http.body as { readonly limit?: number }).limit;
      if (request.descriptor.kind !== "query-membership" || limit !== ORGANIZATION_SEARCH_LIMIT)
        return body;
      const first = decodeSearchListPage(body);
      if (
        first === null ||
        first.rows.length < limit ||
        first.totalCount === null ||
        first.totalCount <= first.rows.length
      )
        return body;
      const { search, sort } = http.body as { readonly search: unknown; readonly sort: unknown };
      const pages = [first];
      let offset = first.rows.length;
      while (offset < first.totalCount && pages.length < 100) {
        const next = decodeSearchListPage(
          yield* requestEffect(
            options.client,
            {
              path: http.path,
              method: "POST",
              body: { search, sort, limit, offset },
              operationKind: "read",
              background: true,
            },
            context,
            policy.httpDeadlineMs,
            options.timers,
            "network",
          ),
        );
        if (next === null)
          return yield* Effect.fail(
            adapterError("malformed", "Entity traversal returned a malformed page."),
          );
        pages.push(next);
        if (next.rows.length === 0) break;
        offset += next.rows.length;
      }
      return pages;
    });

  const register: ZeropsDataAdapter["register"] = (receiver, request, context) => {
    const internals = openReceivers.get(receiver);
    if (!internals) return Effect.fail(adapterError("socket-closed", "Receiver is not open."));
    if (internals.isClosed())
      return Effect.fail(adapterError("socket-closed", "Receiver is closed."));
    const organization = registrationOrganization(request);
    if (
      organization.organizationId !== receiver.organization.organizationId ||
      organization.account.apiOrigin !== receiver.organization.account.apiOrigin ||
      organization.account.accountId !== receiver.organization.account.accountId
    )
      return Effect.fail(
        adapterError("registration", "Registration belongs to another organization.", false),
      );
    if (!sameReceiverIdentity(request.identity.receiver, receiver.identity))
      return Effect.fail(
        adapterError("registration", "Registration belongs to another receiver generation.", false),
      );
    if (internals.registrations.has(request.subscriptionName))
      return Effect.fail(
        adapterError(
          "registration",
          "Subscription name is already registered on this receiver.",
          false,
        ),
      );

    internals.registrations.set(request.subscriptionName, request);
    const http = registrationHttp(request, receiver);
    return requestEffect(
      options.client,
      { path: http.path, method: "POST", body: http.body, operationKind: "read", background: true },
      context,
      policy.registrationDeadlineMs,
      options.timers,
      "registration",
    ).pipe(
      Effect.flatMap((body) => restOfOrganizationSearch(request, http, body, context)),
      Effect.flatMap((body) => {
        const decoded =
          Array.isArray(body) &&
          request.descriptor.kind === "query-membership" &&
          request.baselineTicket !== null
            ? decodeEntityQueryPages(
                request.descriptor.query,
                request.baselineTicket,
                body,
                "indexed-search",
              )
            : decodeRegistrationResponse(request, body);
        reportDroppedRows(decoded.issues);
        const fatal = decoded.issues.find((issue) => !isRowIssue(issue));
        if (fatal !== undefined) return Effect.fail(adapterError("malformed", fatal.message));
        return Effect.succeed<RegistrationReceipt>({ responseObservations: decoded.observations });
      }),
      Effect.tapError(() =>
        Effect.sync(() => internals.registrations.delete(request.subscriptionName)),
      ),
    );
  };

  const read: ZeropsDataAdapter["read"] = (ticket, context) => {
    const perform = (offset = 0) => {
      const http = readHttp(ticket, offset);
      return requestEffect(
        options.client,
        { ...http, operationKind: "read", background: true },
        context,
        policy.httpDeadlineMs,
        options.timers,
        "network",
      );
    };
    /**
     * `GET /client/{id}/project` is lag-free but Zerops rejects it outright
     * for Developer/Guest memberships, whose access is expressed by
     * per-project roles instead of client-level ones. The same
     * `POST /project/search` query the platform GUI uses for those
     * memberships applies that authorization server-side, at the cost of
     * Elasticsearch's indexing lag — so it seeds only unknown fields per the
     * source-authority table, and is used only once the direct read
     * refused this account (`ZeropsApiClient.projectListRefused`), never
     * before.
     */
    const performSearch =
      (organizationId: string) =>
      (offset = 0) =>
        requestEffect(
          options.client,
          {
            path: "/project/search",
            method: "POST",
            body: {
              limit: 500,
              ...(offset ? { offset } : {}),
              search: [{ name: "clientId", operator: "eq", value: organizationId }],
            },
            operationKind: "read",
            background: true,
          },
          context,
          policy.httpDeadlineMs,
          options.timers,
          "network",
        );
    const traversePages = (
      fetchPage: (offset: number) => Effect.Effect<unknown, AdapterError>,
      decodePage: (body: unknown) => ReturnType<typeof decodeDirectListPage>,
    ) =>
      Effect.gen(function* () {
        const pages: Array<NonNullable<ReturnType<typeof decodeDirectListPage>>> = [];
        let offset = 0;
        for (let pageIndex = 0; pageIndex < 100; pageIndex += 1) {
          const body = yield* fetchPage(offset);
          const page = decodePage(body);
          if (page === null)
            return yield* Effect.fail(
              adapterError("malformed", "Entity traversal returned a malformed page."),
            );
          pages.push(page);
          offset += page.rows.length;
          if (
            page.rows.length < 500 ||
            (page.totalCount !== null && offset >= page.totalCount) ||
            page.rows.length === 0
          )
            break;
        }
        return pages;
      });
    const result = Effect.gen(function* () {
      const descriptor = ticket.target.kind === "query" ? ticket.target.descriptor : null;
      if (descriptor !== null && descriptor.kind === "services-of-project") {
        // The lag-free list of one project's services: the confirming read (§9 C19).
        const pages = yield* traversePages(perform, decodeDirectListPage);
        const decoded = decodeEntityQueryPages(descriptor, ticket, pages, "direct-read");
        return { observations: decoded.observations } satisfies PlatformReadResult;
      }
      if (descriptor !== null && descriptor.kind === "projects-of-organization") {
        const organizationId = queryOrganizationId(descriptor);
        const search = traversePages(performSearch(organizationId), decodeSearchListPage);
        // A refusal is the person's for the account epoch (`projectListRefused`): asked once.
        const direct = options.client.projectListRefused(organizationId)
          ? null
          : yield* traversePages(perform, decodeDirectListPage).pipe(Effect.result);
        let pages: Array<NonNullable<ReturnType<typeof decodeDirectListPage>>>;
        let source: "direct-read" | "indexed-search" = "direct-read";
        if (direct !== null && Result.isSuccess(direct)) pages = direct.success;
        else if (direct === null || direct.failure.kind === "forbidden") {
          if (direct !== null) options.client.noteProjectListRefused(organizationId);
          source = "indexed-search";
          pages = yield* search;
        } else return yield* Effect.fail(direct.failure);
        const decoded = decodeEntityQueryPages(descriptor, ticket, pages, source);
        return { observations: decoded.observations } satisfies PlatformReadResult;
      }
      const body = yield* perform();
      const decoded = decodeRead(ticket, body);
      if (decoded.issues.length && decoded.observations.length === 0)
        return yield* Effect.fail(adapterError("malformed", decoded.issues[0]!.message));
      return {
        observations: decoded.observations,
        ...(decoded.project === undefined ? {} : { project: decoded.project }),
      } satisfies PlatformReadResult;
    });
    return result.pipe(
      Effect.catch((error) => {
        if (
          ticket.target.kind !== "query" &&
          (error.kind === "forbidden" || error.kind === "not-found")
        ) {
          const observation: PlatformObservation = {
            kind: "entity-unavailable",
            ref: ticket.target.ref,
            reason: error.kind,
            ticket,
          } as never;
          return Effect.succeed({ observations: [observation] });
        }
        return Effect.fail(error);
      }),
    );
  };

  const executeApi = <Value>(
    context: RequestContext,
    use: (signal: AbortSignal) => Promise<Value>,
    deadlineMs: number = policy.httpDeadlineMs,
  ): Effect.Effect<Value, AdapterError> =>
    Effect.gen(function* () {
      const stage = stageSignal(
        context,
        deadlineMs,
        options.timers,
        yield* Clock.currentTimeMillis,
      );
      if (stage.expired)
        return yield* Effect.fail(
          adapterError("timeout", "Zerops command context already expired.", false),
        );
      if (context.abortSignal.aborted)
        return yield* Effect.fail(
          adapterError("cancelled", "Zerops command was cancelled.", false),
        ).pipe(Effect.ensuring(Effect.sync(stage.dispose)));
      return yield* Effect.tryPromise({
        try: () => use(stage.signal),
        catch: (cause) =>
          context.abortSignal.aborted
            ? adapterError("cancelled", "Zerops command was cancelled.", false)
            : stage.signal.aborted
              ? adapterError("timeout", "Zerops command exceeded its deadline.", false)
              : errorFrom(cause, "uncertain"),
      }).pipe(Effect.ensuring(Effect.sync(stage.dispose)));
    });

  const uncertainCommandError = (error: AdapterError): AdapterError =>
    error.kind === "server" || error.kind === "network" || error.kind === "timeout"
      ? adapterError("uncertain", error.message, false)
      : error;

  const projectCommandReceipt = (
    command: Extract<
      PlatformCommand,
      {
        readonly kind: "create-project";
      }
    >,
    project: unknown,
    result: NonNullable<PlatformCommandReceipt["result"]>,
  ): Effect.Effect<PlatformCommandReceipt, AdapterError> => {
    const decoded = decodeProjectCommandResponse(command, project);
    return decoded.issues.length > 0
      ? Effect.fail(
          adapterError(
            "uncertain",
            `Zerops accepted ${command.kind} but its Project response was malformed: ${decoded.issues[0]!.message}`,
            false,
          ),
        )
      : Effect.succeed({
          observations: decoded.observations,
          result,
        });
  };

  const execute: ZeropsDataAdapter["execute"] = (command, context) => {
    switch (command.kind) {
      case "import-development-container":
        return executeApi(
          context,
          (signal) =>
            options.client.importDevelopmentContainer(
              {
                clientId: command.project.organization.organizationId,
                projectId: command.project.projectId,
                projectName: command.projectName,
                ...(command.zcpVersion === undefined ? {} : { zcpVersion: command.zcpVersion }),
                ...(command.agents === undefined ? {} : { agents: command.agents }),
                ...(command.setupRuntimesYaml === undefined
                  ? {}
                  : { setupRuntimesYaml: command.setupRuntimesYaml }),
              },
              signal,
              context.beforeProjectWrite,
            ),
          commandDeadlineMs(command.kind, policy),
        ).pipe(
          Effect.map((value): PlatformCommandReceipt => ({
            observations: [],
            result: { kind: command.kind, value },
          })),
          Effect.mapError(uncertainCommandError),
        );
      case "create-project":
        return executeApi(context, (signal) =>
          options.client.createProject(
            {
              clientId: command.organization.organizationId,
              name: command.name,
              tagList: command.tagList,
              ...(command.location === undefined ? {} : { location: command.location }),
            },
            signal,
            context.beforeProjectWrite,
          ),
        ).pipe(
          Effect.flatMap((value) =>
            projectCommandReceipt(command, value, { kind: command.kind, value }),
          ),
          Effect.mapError(uncertainCommandError),
        );
      case "import-project":
        return executeApi(context, (signal) =>
          options.client.importProject(
            command.organization.organizationId,
            command.yaml,
            signal,
            context.beforeProjectWrite,
          ),
        ).pipe(
          Effect.flatMap((value) => {
            const projectId = importProjectId(value);
            return projectId === null
              ? Effect.fail(
                  adapterError(
                    "uncertain",
                    "Zerops accepted import-project but its project identity was malformed.",
                    false,
                  ),
                )
              : Effect.succeed<PlatformCommandReceipt>({
                  observations: [],
                  result: { kind: command.kind, value: { projectId } },
                });
          }),
          Effect.mapError(uncertainCommandError),
        );
      case "import-services":
        return executeApi(context, (signal) =>
          options.client.importServicesIntoProject(
            command.project.projectId,
            command.yaml,
            signal,
            context.beforeProjectWrite,
          ),
        ).pipe(
          Effect.flatMap((value) => {
            return !importProcessesWellFormed(value)
              ? Effect.fail(
                  adapterError(
                    "uncertain",
                    "Zerops accepted import-services but its Process references were malformed.",
                    false,
                  ),
                )
              : Effect.succeed<PlatformCommandReceipt>({
                  observations: [],
                  result: { kind: command.kind, value: undefined },
                });
          }),
          Effect.mapError(uncertainCommandError),
        );
      case "harden-mate":
        // The birth's hardening, whole — the token half and the isolation
        // half together (`ZeropsApiClient.hardenMate`). The kind keeps its
        // old name; see the intent's doc comment in `types.ts`.
        return executeApi(context, (signal) =>
          options.client.hardenMate(
            command.project.organization.organizationId,
            command.project.projectId,
            signal,
            context.beforeProjectWrite,
            command.keyTokenId,
          ),
        ).pipe(
          Effect.map((value): PlatformCommandReceipt => ({
            observations: [],
            result: { kind: command.kind, value },
          })),
          Effect.mapError(uncertainCommandError),
        );
    }
  };

  const closeReceiver: ZeropsDataAdapter["closeReceiver"] = (receiver) =>
    Effect.gen(function* () {
      const internals = openReceivers.get(receiver);
      openReceivers.delete(receiver);
      if (internals) yield* internals.close;
    });

  return {
    openReceiver,
    register,
    read,
    execute,
    closeReceiver,
    cells: makeZeropsCellReads(options.client),
    onTokensWritten: (listener) => options.client.onIntegrationTokensWritten(listener),
  };
}

/** A token as metadata: its value never leaves the API client, its grants are not read here. */
const tokenMetadata = (token: ZeropsIntegrationToken): ZeropsIntegrationTokenMetadata => ({
  tokenId: token.id,
  name: token.name,
  ...(token.created === undefined ? {} : { created: token.created }),
  ...(token.createdByUser === undefined ? {} : { createdByUser: token.createdByUser }),
});

const cellReadError = (cause: unknown): ZeropsCellSourceError => {
  if (cause instanceof ZeropsApiError) {
    // A 429 is Zerops asking for patience: retried, and not before its Retry-After.
    if (cause.status === 429)
      return {
        _tag: "ZeropsCellSourceError",
        kind: "transport",
        retryable: true,
        ...(cause.retryAfterMs === null ? {} : { retryAfterMs: cause.retryAfterMs }),
      };
    switch (cause.kind) {
      case "forbidden":
      case "expired-session":
        return { _tag: "ZeropsCellSourceError", kind: "permission", retryable: false };
      case "not-found":
        return { _tag: "ZeropsCellSourceError", kind: "unavailable", retryable: false };
      case "network":
      case "server":
        return { _tag: "ZeropsCellSourceError", kind: "transport", retryable: true };
      default:
        return { _tag: "ZeropsCellSourceError", kind: "decode", retryable: false };
    }
  }
  return { _tag: "ZeropsCellSourceError", kind: "transport", retryable: true };
};

const cellRead = <Value>(run: () => Promise<Value>): Effect.Effect<Value, ZeropsCellSourceError> =>
  Effect.tryPromise({ try: run, catch: cellReadError });

/**
 * The reads no stream carries, one per cell kind, over the REST API; secret-bearing source rows
 * are stripped at this boundary.
 */
const PublicAccessProject = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  publicZone: Schema.NullOr(Schema.String),
  zeropsSubdomainHost: Schema.NullOr(Schema.String),
});
const PublicAccessServices = Schema.Struct({
  list: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      status: Schema.String,
      isSystem: Schema.optionalKey(Schema.Boolean),
      subdomainAccess: Schema.Boolean,
      ports: Schema.Array(
        Schema.Struct({
          port: Schema.Finite,
          scheme: Schema.optionalKey(Schema.String),
        }),
      ),
      serviceStackTypeInfo: Schema.optionalKey(
        Schema.NullOr(
          Schema.Struct({
            serviceStackTypeVersionName: Schema.optionalKey(Schema.String),
            serviceStackTypeCategory: Schema.optionalKey(Schema.NullOr(Schema.String)),
          }),
        ),
      ),
    }),
  ),
});
const PublicAccessRoutings = Schema.Struct({
  list: Schema.Array(
    Schema.Struct({
      isSynced: Schema.Boolean,
      sslEnabled: Schema.Boolean,
      domains: Schema.Array(Schema.Struct({ domainName: Schema.String })),
      locations: Schema.Array(
        Schema.Struct({ path: Schema.String, port: Schema.Finite, serviceStackId: Schema.String }),
      ),
    }),
  ),
});

const decodePublicAccessProject = Schema.decodeUnknownEffect(PublicAccessProject);
const decodePublicAccessServices = Schema.decodeUnknownEffect(PublicAccessServices);
const decodePublicAccessRoutings = Schema.decodeUnknownEffect(PublicAccessRoutings);

export function makeZeropsCellReads(client: ZeropsApiClient): ZeropsCellAdapter {
  return {
    readProjectPublicAccess: (input, context) =>
      Effect.gen(function* () {
        const id = input.project.projectId;
        const read = (path: string) =>
          cellRead(() =>
            client.requestData({
              path,
              operationKind: "read",
              signal: context.abortSignal,
              background: true,
            }),
          );
        const project = yield* read(`/project/${id}`);
        const services = yield* read(`/project/${id}/service-stack?limit=500`);
        const routings = yield* read(`/project/${id}/public-http-routing`);
        const decodeFailure = () => ({
          _tag: "ZeropsCellSourceError" as const,
          kind: "decode" as const,
          retryable: false,
        });
        const decoded = yield* decodePublicAccessProject(project).pipe(
          Effect.mapError(decodeFailure),
        );
        const serviceRows = yield* decodePublicAccessServices(services).pipe(
          Effect.mapError(decodeFailure),
        );
        const routingRows = yield* decodePublicAccessRoutings(routings).pipe(
          Effect.mapError(decodeFailure),
        );
        if (decoded.id !== id) return yield* Effect.fail(decodeFailure());
        return derivePublicAccess(
          {
            id: decoded.id,
            name: decoded.name,
            status: "UNKNOWN",
            ...(decoded.publicZone === null ? {} : { publicZone: decoded.publicZone }),
            ...(decoded.zeropsSubdomainHost === null
              ? {}
              : { zeropsSubdomainHost: decoded.zeropsSubdomainHost }),
          },
          serviceRows.list.map(({ serviceStackTypeInfo, ...service }) => ({
            ...service,
            ...(serviceStackTypeInfo === null || serviceStackTypeInfo === undefined
              ? {}
              : {
                  serviceStackTypeInfo: {
                    ...(serviceStackTypeInfo.serviceStackTypeVersionName === undefined
                      ? {}
                      : {
                          serviceStackTypeVersionName:
                            serviceStackTypeInfo.serviceStackTypeVersionName,
                        }),
                    ...(serviceStackTypeInfo.serviceStackTypeCategory == null
                      ? {}
                      : {
                          serviceStackTypeCategory: serviceStackTypeInfo.serviceStackTypeCategory,
                        }),
                  },
                }),
          })),
          routingRows.list,
        );
      }),
    readOrganizationLocations: (input, context) =>
      cellRead(() =>
        client.listClientLocations(input.organization.organizationId, context.abortSignal),
      ),
    readServiceAuthorizedAgents: (input, context) =>
      cellRead(() => client.readAuthorizedAgents(input.service.serviceId, context.abortSignal)),
    // A failed read is folded into `"unknown"` here, not left to fail the
    // resource: this flag exists to replace an inference (H9), and a read
    // that could not be made is exactly the case a caller must not treat as
    // a fact either way.
    readServiceMateFlag: (input, context) =>
      cellRead(async () => {
        try {
          return {
            enabled: await client.isZeropsMateEnabled(input.service.serviceId, context.abortSignal),
          };
        } catch {
          return { enabled: "unknown" as const };
        }
      }),
    readOrganizationIntegrationTokens: (input, context) =>
      cellRead(async () =>
        (
          await client.listIntegrationTokens(input.organization.organizationId, context.abortSignal)
        ).map(tokenMetadata),
      ),
    readOrganizationMembers: (input, context) =>
      cellRead(() =>
        client.listOrganizationMembers(input.organization.organizationId, context.abortSignal),
      ),
  };
}
