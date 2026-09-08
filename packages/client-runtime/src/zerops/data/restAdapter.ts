import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { DEFAULT_ZEROPS_DATA_POLICY, type ZeropsDataPolicy } from "./policy.ts";
import {
  decodeProjectCommandResponse,
  decodeEntityDirectResponse,
  decodeDirectListPage,
  decodeEntityQueryPages,
  decodeEntityQueryResponse,
  decodeMetricRead,
  decodeNativeFrame,
  decodeRegistrationResponse,
  decodeRestartServiceResponse,
  decodeSearchListPage,
} from "./platformProtocol.ts";
import type {
  AdapterError,
  EntityQueryDescriptor,
  PlatformCommand,
  PlatformCommandReceipt,
  PlatformObservation,
  ProcessRef,
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
import { ZeropsProcessId } from "./types.ts";
import { ZeropsApiError, type ZeropsApiClient } from "../api.ts";
import type { PlatformWatchSocket, PlatformWatchTimers } from "./platformSocket.ts";

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

function importProcessIds(value: unknown): ReadonlyArray<string> | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("serviceStacks" in value) ||
    !Array.isArray(value.serviceStacks)
  )
    return null;
  const processIds: string[] = [];
  for (const stack of value.serviceStacks) {
    if (typeof stack !== "object" || stack === null) return null;
    if (!("processes" in stack) || stack.processes === undefined) continue;
    if (!Array.isArray(stack.processes)) return null;
    for (const process of stack.processes) {
      if (
        typeof process !== "object" ||
        process === null ||
        !("id" in process) ||
        !nonEmptyString(process.id)
      )
        return null;
      processIds.push(process.id);
    }
  }
  return processIds;
}

function errorFrom(cause: unknown, fallback: AdapterError["kind"]): AdapterError {
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
                  : fallback;
    return adapterError(
      kind,
      fixedApiErrorMessage(kind),
      !["forbidden", "not-found", "rejected"].includes(kind),
    );
  }
  return adapterError(fallback, "Zerops adapter failed.");
}

/**
 * Never forwards the backend `ZeropsApiError.message` into a public reason:
 * that text is server-authored and may carry request-specific detail this
 * layer has not reviewed for exposure. Each adapter error kind gets a fixed,
 * reviewed sentence instead; the kind itself still distinguishes causes.
 */
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

function queryOrganizationId(query: EntityQueryDescriptor): string {
  return query.kind === "projects-of-organization"
    ? query.organization.organizationId
    : query.project.organization.organizationId;
}

function registrationOrganization(request: RegistrationRequest) {
  const descriptor = request.descriptor;
  return descriptor.kind === "entity-updates"
    ? descriptor.organization
    : descriptor.kind === "query-membership"
      ? descriptor.query.kind === "projects-of-organization"
        ? descriptor.query.organization
        : descriptor.query.project.organization
      : descriptor.query.project.organization;
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
  query: EntityQueryDescriptor,
): ReadonlyArray<Readonly<Record<string, unknown>>> {
  const terms: Array<Readonly<Record<string, unknown>>> = [
    { name: "clientId", operator: "eq", value: queryOrganizationId(query) },
  ];
  if (query.kind !== "projects-of-organization")
    terms.push({ name: "projectId", operator: "eq", value: query.project.projectId });
  if (query.kind === "projects-of-organization" && query.statuses.length)
    terms.push({ name: "status", operator: "in", value: query.statuses });
  if (query.kind === "running-processes-of-project") {
    terms.push({ name: "status", operator: "in", value: query.statuses });
    terms.push({ name: "executorTag", operator: "ne", value: "L7_MASTER" });
  }
  if (query.kind === "process-history-window")
    terms.push({ name: "executorTag", operator: "ne", value: "L7_MASTER" });
  return terms;
}

function registrationHttp(request: RegistrationRequest, receiver: ReceiverHandle) {
  const common = {
    receiverId: receiver.identity.receiverId,
    subscriptionName: request.subscriptionName,
  };
  const descriptor = request.descriptor;
  if (descriptor.kind === "entity-updates") {
    const entity = descriptor.entity === "service" ? "service-stack" : descriptor.entity;
    return {
      path: `/${entity}/search`,
      body: {
        search: [
          { name: "clientId", operator: "eq", value: descriptor.organization.organizationId },
          ...(descriptor.entity === "process"
            ? [{ name: "executorTag", operator: "ne", value: "L7_MASTER" }]
            : []),
        ],
        sort: [],
        ...common,
        wsOutputType: "updateStream",
        disableOutput: true,
      },
    };
  }
  if (descriptor.kind === "query-membership") {
    const entity =
      descriptor.query.kind === "projects-of-organization"
        ? "project"
        : descriptor.query.kind === "services-of-project"
          ? "service-stack"
          : "process";
    return {
      path: `/${entity}/search`,
      body: {
        search: searchTerms(descriptor.query),
        sort: [],
        limit: descriptor.query.kind === "process-history-window" ? descriptor.query.limit : 500,
        ...common,
        wsOutputType: "listStream",
      },
    };
  }
  const query = descriptor.query;
  const metricCommon = {
    search: [
      { name: "clientId", operator: "eq", value: query.project.organization.organizationId },
      { name: "projectId", operator: "eq", value: query.project.projectId },
    ],
    groupBy: query.groupBy,
    ...common,
  };
  if (descriptor.kind === "current-metrics")
    return { path: "/current-stats/group-by-search", body: metricCommon };
  const historyQuery = descriptor.query;
  return {
    path: "/stats-history/group-by-search",
    body: {
      ...metricCommon,
      timeGroupBy: historyQuery.window.timeGroupBy,
      limit: historyQuery.window.limit,
      timeZone: historyQuery.window.timeZone,
    },
  };
}

function readHttp(ticket: PlatformReadRequest, offset = 0) {
  const target = ticket.target;
  if (target.kind === "project")
    return { path: `/project/${target.ref.projectId}`, method: "GET" as const };
  if (target.kind === "service")
    return { path: `/service-stack/${target.ref.serviceId}`, method: "GET" as const };
  if (target.kind === "process")
    return { path: `/process/${target.ref.processId}`, method: "GET" as const };
  const query = target.descriptor;
  if (query.kind === "projects-of-organization")
    return {
      path: `/client/${query.organization.organizationId}/project?limit=500${offset ? `&offset=${offset}` : ""}`,
      method: "GET" as const,
    };
  if (query.kind === "services-of-project")
    return {
      path: `/project/${query.project.projectId}/service-stack?limit=500${offset ? `&offset=${offset}` : ""}`,
      method: "GET" as const,
    };
  if (query.kind === "running-processes-of-project" || query.kind === "process-history-window")
    return {
      path: `/project/${query.project.projectId}/process?limit=${query.kind === "process-history-window" ? query.limit : 500}${offset ? `&offset=${offset}` : ""}`,
      method: "GET" as const,
    };
  const body = {
    search: [
      { name: "clientId", operator: "eq", value: query.project.organization.organizationId },
      { name: "projectId", operator: "eq", value: query.project.projectId },
    ],
    groupBy: query.groupBy,
    ...(query.kind === "metric-history-of-project"
      ? {
          timeGroupBy: query.window.timeGroupBy,
          limit: query.window.limit,
          timeZone: query.window.timeZone,
        }
      : {}),
  };
  return {
    path:
      query.kind === "current-metrics-of-project"
        ? "/current-stats/group-by-search"
        : "/stats-history/group-by-search",
    method: "POST" as const,
    body,
  };
}

function decodeRead(ticket: PlatformReadRequest, body: unknown) {
  if (ticket.target.kind !== "query") return decodeEntityDirectResponse(ticket, body);
  switch (ticket.target.descriptor.kind) {
    case "projects-of-organization":
    case "services-of-project":
    case "running-processes-of-project":
    case "process-history-window":
      return decodeEntityQueryResponse(ticket.target.descriptor, ticket, body, "direct-read");
    case "current-metrics-of-project":
    case "metric-history-of-project":
      return decodeMetricRead(ticket, body);
  }
}

/**
 * Creates the low-level account transport. The runtime owns receiver replacement,
 * desired-interest leases, retries and ingestion ordering.
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
              ...(decoded.issues.length ? ([{ kind: "malformed" }] as const) : []),
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
      Effect.flatMap((body) => {
        const decoded = decodeRegistrationResponse(request, body);
        if (decoded.issues.length)
          return Effect.fail(adapterError("malformed", decoded.issues[0]!.message));
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
     * source-authority table, and is used solely to recover from a
     * forbidden direct read, never as the first attempt.
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
      if (
        descriptor !== null &&
        (descriptor.kind === "projects-of-organization" ||
          descriptor.kind === "services-of-project" ||
          descriptor.kind === "running-processes-of-project")
      ) {
        const direct = yield* traversePages(perform, decodeDirectListPage).pipe(Effect.result);
        let pages: Array<NonNullable<ReturnType<typeof decodeDirectListPage>>>;
        let source: "direct-read" | "indexed-search" = "direct-read";
        if (Result.isSuccess(direct)) pages = direct.success;
        else if (
          descriptor.kind === "projects-of-organization" &&
          direct.failure.kind === "forbidden"
        ) {
          source = "indexed-search";
          pages = yield* traversePages(
            performSearch(queryOrganizationId(descriptor)),
            decodeSearchListPage,
          );
        } else return yield* Effect.fail(direct.failure);
        const decoded = decodeEntityQueryPages(descriptor, ticket, pages, source);
        return { observations: decoded.observations } satisfies PlatformReadResult;
      }
      const body = yield* perform();
      const decoded = decodeRead(ticket, body);
      if (decoded.issues.length && decoded.observations.length === 0)
        return yield* Effect.fail(adapterError("malformed", decoded.issues[0]!.message));
      return { observations: decoded.observations } satisfies PlatformReadResult;
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
  ): Effect.Effect<Value, AdapterError> =>
    Effect.gen(function* () {
      const stage = stageSignal(
        context,
        policy.httpDeadlineMs,
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
        readonly kind:
          | "name-project-agent"
          | "update-project-group-tags"
          | "create-project"
          | "create-project-with-mate"
          | "create-tool-project";
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
          processRefs: [],
          observations: decoded.observations,
          result,
        });
  };

  const execute: ZeropsDataAdapter["execute"] = (command, context) => {
    if (command.kind === "restart-service") {
      const path = `/service-stack/${command.service.serviceId}/restart`;
      return requestEffect(
        options.client,
        {
          path,
          method: "PUT",
          operationKind: "project-write",
          background: false,
          ...(context.beforeProjectWrite === undefined
            ? {}
            : { beforeWrite: context.beforeProjectWrite }),
        },
        context,
        policy.httpDeadlineMs,
        options.timers,
        "uncertain",
      ).pipe(
        Effect.flatMap((body) => {
          const decoded = decodeRestartServiceResponse(command, body);
          if (decoded.issues.length > 0)
            return Effect.fail(
              adapterError(
                "uncertain",
                `Zerops accepted the restart but its Process response was malformed: ${decoded.issues[0]!.message}`,
                false,
              ),
            );
          return Effect.succeed<PlatformCommandReceipt>({
            processRefs: decoded.processRefs,
            observations: decoded.observations,
            result: { kind: command.kind, value: undefined },
          });
        }),
        Effect.mapError(uncertainCommandError),
      );
    }

    switch (command.kind) {
      case "name-project-agent":
        return executeApi(context, (signal) =>
          options.client.nameProjectAgent(
            command.project.projectId,
            command.name,
            signal,
            context.beforeProjectWrite,
          ),
        ).pipe(
          Effect.flatMap((value) =>
            projectCommandReceipt(command, value, { kind: command.kind, value }),
          ),
          Effect.mapError(uncertainCommandError),
        );
      case "update-project-group-tags":
        return executeApi(context, (signal) =>
          options.client.updateProjectGroupTags(
            command.project.projectId,
            command.next,
            signal,
            context.beforeProjectWrite,
          ),
        ).pipe(
          Effect.flatMap((value) =>
            projectCommandReceipt(command, value, { kind: command.kind, value }),
          ),
          Effect.mapError(uncertainCommandError),
        );
      case "import-development-container":
        return executeApi(context, (signal) =>
          options.client.importDevelopmentContainer(
            {
              projectId: command.project.projectId,
              ...(command.existingServiceNames === undefined
                ? {}
                : { existingServiceNames: command.existingServiceNames }),
              ...(command.zcpVersion === undefined ? {} : { zcpVersion: command.zcpVersion }),
              ...(command.agents === undefined ? {} : { agents: command.agents }),
            },
            signal,
            context.beforeProjectWrite,
          ),
        ).pipe(
          Effect.map((value): PlatformCommandReceipt => ({
            processRefs: [],
            observations: [],
            result: { kind: command.kind, value },
          })),
          Effect.mapError(uncertainCommandError),
        );
      case "enable-zerops-mate":
        return executeApi(context, (signal) =>
          options.client.enableZeropsMate(
            command.service.serviceId,
            signal,
            context.beforeProjectWrite,
          ),
        ).pipe(
          Effect.map((value): PlatformCommandReceipt => ({
            processRefs: [],
            observations: [],
            result: { kind: command.kind, value },
          })),
          Effect.mapError(uncertainCommandError),
        );
      case "enable-subdomain-access":
        return executeApi(context, (signal) =>
          options.client.enableSubdomainAccess(
            command.service.serviceId,
            signal,
            context.beforeProjectWrite,
          ),
        ).pipe(
          Effect.map((value): PlatformCommandReceipt => ({
            processRefs: [],
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
      case "create-project-with-mate":
        return executeApi(context, (signal) =>
          options.client.createProjectWithZeropsMate(
            {
              clientId: command.organization.organizationId,
              name: command.name,
              ...(command.existingServiceNames === undefined
                ? {}
                : { existingServiceNames: command.existingServiceNames }),
              ...(command.location === undefined ? {} : { location: command.location }),
              ...(command.zcpVersion === undefined ? {} : { zcpVersion: command.zcpVersion }),
              ...(command.agents === undefined ? {} : { agents: command.agents }),
              ...(command.group === undefined ? {} : { group: command.group }),
              ...(command.botName === undefined ? {} : { botName: command.botName }),
            },
            signal,
            context.beforeProjectWrite,
          ),
        ).pipe(
          Effect.flatMap((value) =>
            projectCommandReceipt(command, value.project, { kind: command.kind, value }),
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
                  processRefs: [],
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
            const processIds = importProcessIds(value);
            return processIds === null
              ? Effect.fail(
                  adapterError(
                    "uncertain",
                    "Zerops accepted import-services but its Process references were malformed.",
                    false,
                  ),
                )
              : Effect.succeed<PlatformCommandReceipt>({
                  processRefs: processIds.map((processId): ProcessRef => ({
                    kind: "process",
                    project: command.project,
                    processId: ZeropsProcessId.make(processId),
                  })),
                  observations: [],
                  result: { kind: command.kind, value: undefined },
                });
          }),
          Effect.mapError(uncertainCommandError),
        );
      case "create-tool-project":
        return executeApi(context, (signal) =>
          options.client.createToolProject(
            {
              clientId: command.organization.organizationId,
              kind: command.toolKind,
              name: command.name,
              ...(command.location === undefined ? {} : { location: command.location }),
            },
            signal,
            context.beforeProjectWrite,
          ),
        ).pipe(
          Effect.flatMap((value) =>
            projectCommandReceipt(command, value.project, { kind: command.kind, value }),
          ),
          Effect.mapError(uncertainCommandError),
        );
      case "set-integration-token-projects":
        return executeApi(context, (signal) =>
          options.client.setIntegrationTokenProjects(
            {
              clientId: command.organization.organizationId,
              tokenId: command.tokenId,
              name: command.name,
              projects: command.projects,
            },
            signal,
            context.beforeProjectWrite,
          ),
        ).pipe(
          Effect.map((value): PlatformCommandReceipt => ({
            processRefs: [],
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

  return { openReceiver, register, read, execute, closeReceiver };
}
