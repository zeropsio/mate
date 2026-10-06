// @effect-diagnostics globalTimers:off -- the adapter requires an injected timer port; these tests own it.
import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Fiber from "effect/Fiber";
import * as Result from "effect/Result";
import * as Stream from "effect/Stream";

import { ZeropsApiClient } from "../api.ts";
import type { PlatformWatchSocket, PlatformWatchTimers } from "./platformSocket.ts";
import { makeZeropsDataPolicy } from "./policy.ts";
import { makeZeropsDataAdapter } from "./restAdapter.ts";
import {
  AccountEpoch,
  DispatchOrdinal,
  InterestEpoch,
  InterestKey,
  ReadStartOrdinal,
  ReceiptOrdinal,
  ReceiverEpoch,
  ZeropsAccountId,
  ZeropsCommandAttemptId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  ZeropsReceiverId,
  ZeropsRequestId,
  ZeropsServiceId,
  ZeropsWireSubscriptionName,
  makeZeropsApiOrigin,
  type AccountRef,
  type AccountScope,
  type InterestIdentity,
  type OrganizationRef,
  type PlatformCommand,
  type ReadTicket,
  type RegistrationRequest,
  type RequestContext,
} from "./types.ts";

const decodeBody = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ search: Schema.Array(Schema.Unknown) })),
);

const timers: PlatformWatchTimers = {
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

class ManualTimers implements PlatformWatchTimers {
  readonly #entries = new Map<
    object,
    { readonly callback: () => void; readonly delayMs: number }
  >();

  setTimer(callback: () => void, delayMs: number): unknown {
    const handle = {};
    this.#entries.set(handle, { callback, delayMs });
    return handle;
  }

  clearTimer(handle: unknown): void {
    if (typeof handle === "object" && handle !== null) this.#entries.delete(handle);
  }

  has(delayMs: number): boolean {
    return [...this.#entries.values()].some((entry) => entry.delayMs === delayMs);
  }

  delays(): ReadonlyArray<number> {
    return [...this.#entries.values()].map((entry) => entry.delayMs);
  }

  fire(delayMs: number): void {
    const entry = [...this.#entries].find(([, candidate]) => candidate.delayMs === delayMs);
    if (!entry) throw new Error(`No pending ${delayMs}ms timer.`);
    this.#entries.delete(entry[0]);
    entry[1].callback();
  }
}

const waitForTimer = (timers: ManualTimers, delayMs: number) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 20 && !timers.has(delayMs); attempt += 1)
      yield* Effect.yieldNow;
  });

class FakeSocket implements PlatformWatchSocket {
  readonly sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { readonly data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
  openAndGreet(): void {
    this.onopen?.();
    this.onmessage?.({ data: JSON.stringify({ type: "SocketSuccess", data: { Success: true } }) });
  }
  receive(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  serverClose(): void {
    this.onclose?.();
  }
}

const account: AccountRef = {
  apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
  accountId: ZeropsAccountId.make("account"),
};
const scope: AccountScope = { account, epoch: AccountEpoch.make(1) };
const organization: OrganizationRef = {
  kind: "organization",
  account,
  organizationId: ZeropsOrganizationId.make("org"),
};
const project = {
  kind: "project" as const,
  organization,
  projectId: ZeropsProjectId.make("project"),
};
const receiverIdentity = {
  accountEpoch: scope.epoch,
  receiverEpoch: ReceiverEpoch.make(1),
  receiverId: ZeropsReceiverId.make("receiver"),
};
const interest: InterestIdentity = {
  receiver: receiverIdentity,
  interestEpoch: InterestEpoch.make(1),
  key: InterestKey.make("interest"),
};
const context = (): RequestContext => ({
  abortSignal: new AbortController().signal,
  deadlineMs: 4_000_000_000_000,
});

const restartCommand: PlatformCommand = {
  kind: "restart-service",
  service: {
    kind: "service",
    project,
    serviceId: ZeropsServiceId.make("service"),
  },
  attemptId: ZeropsCommandAttemptId.make("restart-attempt"),
  accountEpoch: scope.epoch,
  startedAtReceiptOrdinal: ReceiptOrdinal.make(7),
  dispatchOrdinal: DispatchOrdinal.make(8),
};

const startServiceCommand: PlatformCommand = {
  kind: "start-service",
  service: {
    kind: "service",
    project,
    serviceId: ZeropsServiceId.make("service"),
  },
  attemptId: ZeropsCommandAttemptId.make("start-service-attempt"),
  accountEpoch: scope.epoch,
  startedAtReceiptOrdinal: ReceiptOrdinal.make(7),
  dispatchOrdinal: DispatchOrdinal.make(8),
};

const startProjectCommand: PlatformCommand = {
  kind: "start-project",
  project,
  attemptId: ZeropsCommandAttemptId.make("start-project-attempt"),
  accountEpoch: scope.epoch,
  startedAtReceiptOrdinal: ReceiptOrdinal.make(7),
  dispatchOrdinal: DispatchOrdinal.make(8),
};

const declareMateCommand: PlatformCommand = {
  kind: "update-project-tags",
  project,
  patch: { kind: "mate" },
  attemptId: ZeropsCommandAttemptId.make("declare-attempt"),
  accountEpoch: scope.epoch,
  startedAtReceiptOrdinal: ReceiptOrdinal.make(9),
  dispatchOrdinal: DispatchOrdinal.make(10),
};

const commandBase = {
  attemptId: ZeropsCommandAttemptId.make("import-attempt"),
  accountEpoch: scope.epoch,
  startedAtReceiptOrdinal: ReceiptOrdinal.make(11),
  dispatchOrdinal: DispatchOrdinal.make(12),
};

function updateRegistration(name = "opaque-service-updates"): RegistrationRequest {
  return {
    identity: interest,
    subscriptionName: ZeropsWireSubscriptionName.make(name),
    descriptor: { kind: "entity-updates", entity: "service", organization, project },
    baselineTicket: null,
  };
}

function directServiceTicket(): ReadTicket {
  return {
    kind: "direct",
    requestId: ZeropsRequestId.make("read"),
    owner: { kind: "interest", identity: interest },
    target: {
      kind: "service",
      ref: {
        kind: "service",
        project,
        serviceId: ZeropsServiceId.make("service"),
      },
    },
    receiptOrdinalAtStart: ReceiptOrdinal.make(0),
    readStartOrdinal: ReadStartOrdinal.make(1),
    dispatchOrdinal: DispatchOrdinal.make(1),
    startedAtMs: 0,
  };
}

function projectsTicket(): ReadTicket {
  return {
    kind: "baseline",
    requestId: ZeropsRequestId.make("projects-read"),
    owner: { kind: "interest", identity: interest },
    target: {
      kind: "query",
      descriptor: {
        kind: "projects-of-organization",
        organization,
        statuses: [],
        schemaVersion: 1,
      },
    },
    receiptOrdinalAtStart: ReceiptOrdinal.make(0),
    membershipReceiptOrdinalAtStart: ReceiptOrdinal.make(0),
    readStartOrdinal: ReadStartOrdinal.make(1),
    dispatchOrdinal: DispatchOrdinal.make(1),
    startedAtMs: 0,
  };
}

function servicesTicket(): ReadTicket {
  return {
    kind: "baseline",
    requestId: ZeropsRequestId.make("services-read"),
    owner: { kind: "interest", identity: interest },
    target: {
      kind: "query",
      descriptor: {
        kind: "services-of-project",
        project: project,
        schemaVersion: 1,
      },
    },
    receiptOrdinalAtStart: ReceiptOrdinal.make(0),
    membershipReceiptOrdinalAtStart: ReceiptOrdinal.make(0),
    readStartOrdinal: ReadStartOrdinal.make(1),
    dispatchOrdinal: DispatchOrdinal.make(1),
    startedAtMs: 0,
  };
}

function clientFor(
  respond: (url: string, init: RequestInit | undefined) => Promise<Response> | Response,
) {
  const client = new ZeropsApiClient({
    baseUrl: account.apiOrigin,
    fetch: (url, init) => Promise.resolve(respond(url, init)),
  });
  client.restoreSession({ accessToken: "account-token" });
  return client;
}

function pendingUntilAbort(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const abort = () => reject(new DOMException("aborted", "AbortError"));
    if (signal?.aborted) abort();
    else signal?.addEventListener("abort", abort, { once: true });
  });
}

function socketFactory(sockets: FakeSocket[]) {
  return () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    Promise.resolve().then(() => socket.openAndGreet());
    return socket;
  };
}

describe("ZeropsDataAdapter receiver", () => {
  it.effect(
    "accepts structurally equal account refs and retains a push before registration HTTP completes",
    () =>
      Effect.gen(function* () {
        const registrationResponse = Promise.withResolvers<Response>();
        const sockets: FakeSocket[] = [];
        const client = clientFor((url) =>
          url.endsWith("/web-socket/login")
            ? new Response(JSON.stringify({ webSocketToken: "socket-token" }), { status: 200 })
            : registrationResponse.promise,
        );
        const adapter = makeZeropsDataAdapter({
          client,
          makeSocket: socketFactory(sockets),
          timers,
        });
        const structurallyEqualOrganization: OrganizationRef = {
          ...organization,
          account: { ...account },
        };

        const events = yield* Effect.scoped(
          Effect.gen(function* () {
            const receiver = yield* adapter.openReceiver(
              { ...scope, account: { ...account } },
              structurallyEqualOrganization,
              receiverIdentity,
              context(),
            );
            const request = updateRegistration();
            const registering = yield* adapter
              .register(receiver, request, context())
              .pipe(Effect.forkScoped);
            yield* Effect.yieldNow;
            sockets[0]!.receive({
              type: "search",
              subscriptionName: request.subscriptionName,
              data: {
                update: [
                  {
                    id: "service",
                    projectId: "project",
                    name: "app",
                    status: "ACTIVE",
                  },
                ],
              },
            });
            registrationResponse.resolve(new Response('{"success":true}', { status: 200 }));
            yield* Fiber.join(registering);
            return yield* Stream.runCollect(Stream.take(receiver.events, 2));
          }),
        );

        expect(Array.from(events).map((event) => event.kind)).toEqual([
          "observation",
          "observation",
        ]);
      }),
  );

  it.effect(
    "rejects foreign organizations, stale receiver identities, and closed receivers before HTTP",
    () =>
      Effect.gen(function* () {
        const requests: string[] = [];
        const sockets: FakeSocket[] = [];
        const client = clientFor((url) => {
          requests.push(url);
          return new Response(
            url.endsWith("/web-socket/login")
              ? '{"webSocketToken":"socket-token"}'
              : '{"success":true}',
            { status: 200 },
          );
        });
        const adapter = makeZeropsDataAdapter({
          client,
          makeSocket: socketFactory(sockets),
          timers,
        });
        const foreignOrganization: OrganizationRef = {
          ...organization,
          account: {
            apiOrigin: makeZeropsApiOrigin("https://other-api.example.test"),
            accountId: ZeropsAccountId.make("other-account"),
          },
        };
        const foreignRequest: RegistrationRequest = {
          identity: interest,
          subscriptionName: ZeropsWireSubscriptionName.make("foreign-organization"),
          descriptor: {
            kind: "entity-updates",
            entity: "service",
            organization: foreignOrganization,
            project: { kind: "project", organization, projectId: ZeropsProjectId.make("project") },
          },
          baselineTicket: null,
        };
        const staleRequest: RegistrationRequest = {
          ...updateRegistration("stale-receiver"),
          identity: {
            ...interest,
            receiver: { ...receiverIdentity, receiverEpoch: ReceiverEpoch.make(2) },
          },
        };

        const results = yield* Effect.scoped(
          Effect.gen(function* () {
            const receiver = yield* adapter.openReceiver(
              scope,
              organization,
              receiverIdentity,
              context(),
            );
            const foreign = yield* adapter
              .register(receiver, foreignRequest, context())
              .pipe(Effect.result);
            const stale = yield* adapter
              .register(receiver, staleRequest, context())
              .pipe(Effect.result);
            sockets[0]!.serverClose();
            const remotelyClosed = yield* adapter
              .register(receiver, updateRegistration("closed-socket"), context())
              .pipe(Effect.result);
            yield* adapter.closeReceiver(receiver);
            const locallyClosed = yield* adapter
              .register(receiver, updateRegistration("closed-handle"), context())
              .pipe(Effect.result);
            return { foreign, stale, remotelyClosed, locallyClosed };
          }),
        );

        expect(results.foreign).toMatchObject({
          _tag: "Failure",
          failure: { kind: "registration" },
        });
        expect(results.stale).toMatchObject({ _tag: "Failure", failure: { kind: "registration" } });
        expect(results.remotelyClosed).toMatchObject({
          _tag: "Failure",
          failure: { kind: "socket-closed" },
        });
        expect(results.locallyClosed).toMatchObject({
          _tag: "Failure",
          failure: { kind: "socket-closed" },
        });
        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatch(/\/web-socket\/login$/);
      }),
  );

  it.effect("charges one raw frame's bytes once while budgeting each decoded event", () =>
    Effect.gen(function* () {
      const sockets: FakeSocket[] = [];
      const client = clientFor(
        (url) =>
          new Response(
            JSON.stringify(
              url.endsWith("/web-socket/login")
                ? { webSocketToken: "socket-token" }
                : { success: true },
            ),
            { status: 200 },
          ),
      );
      const adapter = makeZeropsDataAdapter({
        client,
        makeSocket: socketFactory(sockets),
        timers,
        policy: makeZeropsDataPolicy({
          ingressMaxEventsPerAccount: 3,
          ingressMaxBytesPerAccount: 1_024,
          ingressMaxFrameBytes: 1_024,
        }),
      });

      const events = yield* Effect.scoped(
        Effect.gen(function* () {
          const receiver = yield* adapter.openReceiver(
            scope,
            organization,
            receiverIdentity,
            context(),
          );
          const request = updateRegistration();
          yield* adapter.register(receiver, request, context());
          sockets[0]!.receive({
            type: "search",
            subscriptionName: request.subscriptionName,
            data: {
              update: [
                {
                  id: "service",
                  projectId: "project",
                  name: "app",
                  status: "ACTIVE",
                  ports: [{ port: 8080, protocol: "tcp", scheme: "http", httpSupport: true }],
                },
              ],
            },
          });
          return yield* Stream.runCollect(Stream.take(receiver.events, 3));
        }),
      );
      const delivered = Array.from(events);
      expect(delivered).toHaveLength(3);
      expect(delivered.map((event) => (event.kind === "observation" ? event.bytes : null))).toEqual(
        [expect.any(Number), 0, 0],
      );
    }),
  );

  it.effect(
    "shares the decoded-event ingress cap across receivers and preserves typed failures",
    () =>
      Effect.gen(function* () {
        const sockets: FakeSocket[] = [];
        const client = clientFor(
          (url) =>
            new Response(
              JSON.stringify(
                url.endsWith("/web-socket/login")
                  ? { webSocketToken: "socket-token" }
                  : { success: true },
              ),
              { status: 200 },
            ),
        );
        const adapter = makeZeropsDataAdapter({
          client,
          makeSocket: socketFactory(sockets),
          timers,
          policy: makeZeropsDataPolicy({
            ingressMaxEventsPerAccount: 4,
            ingressMaxBytesPerAccount: 4_096,
            ingressMaxFrameBytes: 1_024,
          }),
        });
        const secondIdentity = {
          accountEpoch: scope.epoch,
          receiverEpoch: ReceiverEpoch.make(2),
          receiverId: ZeropsReceiverId.make("receiver-two"),
        };

        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            const first = yield* adapter.openReceiver(
              scope,
              organization,
              receiverIdentity,
              context(),
            );
            const second = yield* adapter.openReceiver(
              scope,
              organization,
              secondIdentity,
              context(),
            );
            const request = updateRegistration("aggregate-budget");
            yield* adapter.register(first, request, context());
            sockets[0]!.receive({
              type: "search",
              subscriptionName: request.subscriptionName,
              data: {
                update: [
                  {
                    id: "service",
                    projectId: "project",
                    name: "app",
                    status: "ACTIVE",
                    ports: [{ port: 8080 }],
                  },
                ],
              },
            });
            sockets[1]!.receive({ type: "search", subscriptionName: "unknown-one", data: {} });
            sockets[1]!.receive({ type: "search", subscriptionName: "unknown-two", data: {} });

            const secondEvents: Array<{ readonly kind: string }> = [];
            const secondDelivery = yield* second.events.pipe(
              Stream.tap((event) => Effect.sync(() => secondEvents.push(event))),
              Stream.runDrain,
              Effect.result,
            );
            const retained = yield* Stream.runCollect(Stream.take(first.events, 3));
            return {
              secondDelivery,
              secondEvents,
              retained: Array.from(retained),
            };
          }),
        );

        expect(result.secondEvents).toEqual([expect.objectContaining({ kind: "malformed" })]);
        expect(result.secondDelivery).toMatchObject({
          _tag: "Failure",
          failure: { kind: "overflow" },
        });
        expect(result.retained).toHaveLength(3);
        expect(sockets[0]!.closed).toBe(true);
        expect(sockets[1]!.closed).toBe(true);
      }),
  );

  it.effect("shares the raw-byte ingress cap across receivers", () =>
    Effect.gen(function* () {
      const sockets: FakeSocket[] = [];
      const frame = { type: "search", subscriptionName: "unknown", data: {} };
      const frameBytes = new TextEncoder().encode(
        '{"type":"search","subscriptionName":"unknown","data":{}}',
      ).byteLength;
      const client = clientFor(
        () => new Response('{"webSocketToken":"socket-token"}', { status: 200 }),
      );
      const adapter = makeZeropsDataAdapter({
        client,
        makeSocket: socketFactory(sockets),
        timers,
        policy: makeZeropsDataPolicy({
          ingressMaxEventsPerAccount: 10,
          ingressMaxBytesPerAccount: frameBytes,
          ingressMaxFrameBytes: frameBytes,
        }),
      });
      const secondIdentity = {
        accountEpoch: scope.epoch,
        receiverEpoch: ReceiverEpoch.make(2),
        receiverId: ZeropsReceiverId.make("receiver-byte-two"),
      };

      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const first = yield* adapter.openReceiver(
            scope,
            organization,
            receiverIdentity,
            context(),
          );
          const second = yield* adapter.openReceiver(
            scope,
            organization,
            secondIdentity,
            context(),
          );
          sockets[0]!.receive(frame);
          sockets[1]!.receive(frame);
          const firstDelivery = yield* Stream.runHead(first.events);
          const secondDelivery = yield* second.events.pipe(Stream.runDrain, Effect.result);
          return { firstDelivery, secondDelivery };
        }),
      );

      expect(result.firstDelivery).toMatchObject({ value: { kind: "malformed" } });
      expect(result.secondDelivery).toMatchObject({
        _tag: "Failure",
        failure: { kind: "overflow" },
      });
    }),
  );

  it.effect(
    "surfaces malformed, oversize and close conditions instead of silently dropping them",
    () =>
      Effect.gen(function* () {
        const sockets: FakeSocket[] = [];
        const client = clientFor(
          (url) =>
            new Response(
              JSON.stringify(
                url.endsWith("/web-socket/login")
                  ? { webSocketToken: "socket-token" }
                  : { success: true },
              ),
              { status: 200 },
            ),
        );
        const adapter = makeZeropsDataAdapter({
          client,
          makeSocket: socketFactory(sockets),
          timers,
          policy: makeZeropsDataPolicy({
            ingressMaxBytesPerAccount: 120,
            ingressMaxFrameBytes: 120,
          }),
        });

        const observed = yield* Effect.scoped(
          Effect.gen(function* () {
            const receiver = yield* adapter.openReceiver(
              scope,
              organization,
              receiverIdentity,
              context(),
            );
            sockets[0]!.receive({ type: "search", subscriptionName: "not-registered", data: {} });
            const malformed = yield* Stream.runHead(receiver.events);
            sockets[0]!.serverClose();
            const closed = yield* Stream.runHead(receiver.events);
            return { malformed, closed };
          }),
        );
        expect(observed.malformed).toMatchObject({ value: { kind: "malformed" } });
        expect(observed.closed).toMatchObject({ value: { kind: "closed" } });

        const oversizedSockets: FakeSocket[] = [];
        const oversizedAdapter = makeZeropsDataAdapter({
          client,
          makeSocket: socketFactory(oversizedSockets),
          timers,
          policy: makeZeropsDataPolicy({
            ingressMaxBytesPerAccount: 100,
            ingressMaxFrameBytes: 100,
          }),
        });
        const exit = yield* Effect.exit(
          Effect.scoped(
            Effect.gen(function* () {
              const receiver = yield* oversizedAdapter.openReceiver(
                scope,
                organization,
                receiverIdentity,
                context(),
              );
              oversizedSockets[0]!.receive({
                type: "search",
                subscriptionName: "x".repeat(200),
                data: {},
              });
              return yield* Stream.runHead(receiver.events);
            }),
          ),
        );
        expect(exit).toMatchObject({ _tag: "Failure" });
      }),
  );

  it.effect("keeps a background 401 scoped and does not clear the account session", () =>
    Effect.gen(function* () {
      const client = clientFor(() => new Response(JSON.stringify({}), { status: 401 }));
      const adapter = makeZeropsDataAdapter({
        client,
        makeSocket: () => new FakeSocket(),
        timers,
      });
      const exit = yield* Effect.exit(adapter.read(directServiceTicket(), context()));
      expect(exit).toMatchObject({ _tag: "Failure" });
      expect(client.session?.accessToken).toBe("account-token");
    }),
  );

  it.effect("a read answered 429 carries the status and the wait the platform asked for", () =>
    Effect.gen(function* () {
      const client = clientFor(
        () => new Response("{}", { status: 429, headers: { "Retry-After": "9" } }),
      );
      const adapter = makeZeropsDataAdapter({
        client,
        makeSocket: () => new FakeSocket(),
        timers,
      });
      const read = yield* adapter.read(directServiceTicket(), context()).pipe(Effect.flip);
      expect({ status: read.status, retryAfterMs: read.retryAfterMs }).toEqual({
        status: 429,
        retryAfterMs: 9_000,
      });
    }),
  );

  it.effect("accepts the restart Process answered for the requested service", () =>
    Effect.gen(function* () {
      const requests: Array<{
        readonly url: string;
        readonly init: RequestInit | undefined;
      }> = [];
      const client = clientFor((url, init) => {
        requests.push({ url, init });
        return new Response(
          JSON.stringify({
            id: "independent-process-id",
            projectId: "project",
            serviceStackId: "service",
            serviceStacks: [{ id: "service" }],
            actionName: "stack.restart",
            status: "PENDING",
            sequence: 0,
            created: "2026-09-04T12:41:00.728Z",
            lastUpdate: "2026-09-04T12:41:00.728Z",
            started: null,
            finished: null,
            appVersion: null,
          }),
          { status: 200 },
        );
      });
      const adapter = makeZeropsDataAdapter({
        client,
        makeSocket: () => new FakeSocket(),
        timers,
      });

      const result = yield* adapter.execute(restartCommand, context());

      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        url: expect.stringMatching(/\/service-stack\/service\/restart$/),
        init: { method: "PUT" },
      });
      expect(result.result).toEqual({ kind: "restart-service", value: undefined });
    }),
  );

  it.effect("reports an accepted malformed restart response as non-retryable uncertainty", () =>
    Effect.gen(function* () {
      let requestCount = 0;
      const client = clientFor(() => {
        requestCount += 1;
        return new Response('{"success":true}', { status: 200 });
      });
      const adapter = makeZeropsDataAdapter({
        client,
        makeSocket: () => new FakeSocket(),
        timers,
      });

      const result = yield* adapter.execute(restartCommand, context()).pipe(Effect.result);

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: {
          kind: "uncertain",
          retryable: false,
          message: expect.stringContaining("accepted the restart"),
        },
      });
      expect(requestCount).toBe(1);
    }),
  );

  it.effect("accepts the start-service Process via PUT /service-stack/{id}/start", () =>
    Effect.gen(function* () {
      const requests: Array<{
        readonly url: string;
        readonly init: RequestInit | undefined;
      }> = [];
      const client = clientFor((url, init) => {
        requests.push({ url, init });
        return new Response(
          JSON.stringify({
            id: "start-process-id",
            projectId: "project",
            serviceStackId: "service",
            actionName: "stack.start",
            status: "PENDING",
            created: "2026-09-04T12:41:00.728Z",
          }),
          { status: 200 },
        );
      });
      const adapter = makeZeropsDataAdapter({
        client,
        makeSocket: () => new FakeSocket(),
        timers,
      });

      const result = yield* adapter.execute(startServiceCommand, context());

      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        url: expect.stringMatching(/\/service-stack\/service\/start$/),
        init: { method: "PUT" },
      });
      expect(result.result).toEqual({ kind: "start-service", value: undefined });
    }),
  );

  it.effect(
    "accepts a start-service response with an unexpected actionName instead of failing",
    () =>
      Effect.gen(function* () {
        const client = clientFor(
          () =>
            new Response(
              JSON.stringify({
                id: "start-process-id",
                projectId: "project",
                serviceStackId: "service",
                actionName: "stack.something-else",
                status: "PENDING",
                created: "2026-09-04T12:41:00.728Z",
              }),
              { status: 200 },
            ),
        );
        const adapter = makeZeropsDataAdapter({
          client,
          makeSocket: () => new FakeSocket(),
          timers,
        });

        const result = yield* adapter.execute(startServiceCommand, context());

        expect(result.result).toEqual({ kind: "start-service", value: undefined });
      }),
  );

  it.effect("accepts the start-project Process via PUT /project/{id}/start", () =>
    Effect.gen(function* () {
      const requests: Array<{
        readonly url: string;
        readonly init: RequestInit | undefined;
      }> = [];
      const client = clientFor((url, init) => {
        requests.push({ url, init });
        return new Response(
          JSON.stringify({
            id: "start-process-id",
            projectId: "project",
            actionName: "project.start",
            status: "PENDING",
            created: "2026-09-04T12:41:00.728Z",
          }),
          { status: 200 },
        );
      });
      const adapter = makeZeropsDataAdapter({
        client,
        makeSocket: () => new FakeSocket(),
        timers,
      });

      const result = yield* adapter.execute(startProjectCommand, context());

      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        url: expect.stringMatching(/\/project\/project\/start$/),
        init: { method: "PUT" },
      });
      expect(result.result).toEqual({ kind: "start-project", value: undefined });
    }),
  );

  it.effect("tells the runtime of every token write its client makes", () =>
    Effect.gen(function* () {
      const client = clientFor(() => new Response(JSON.stringify({}), { status: 200 }));
      const adapter = makeZeropsDataAdapter({ client, makeSocket: () => new FakeSocket(), timers });
      const heard: string[] = [];
      const stop = adapter.onTokensWritten?.((organizationId) => heard.push(organizationId));

      yield* Effect.promise(() =>
        client.setIntegrationTokenProjects({
          clientId: organization.organizationId,
          tokenId: "token-a",
          name: "t",
          projects: [],
        }),
      );
      stop?.();

      expect(heard).toEqual([organization.organizationId]);
    }),
  );

  it.effect("deletes a project the platform failed to create via DELETE /project/{id}", () =>
    Effect.gen(function* () {
      const requests: Array<{
        readonly url: string;
        readonly init: RequestInit | undefined;
      }> = [];
      const client = clientFor((url, init) => {
        requests.push({ url, init });
        return new Response(
          JSON.stringify({
            id: "delete-process-id",
            projectId: "project",
            actionName: "project.delete",
            status: "PENDING",
            created: "2026-09-16T20:30:00.000Z",
          }),
          { status: 200 },
        );
      });
      const adapter = makeZeropsDataAdapter({
        client,
        makeSocket: () => new FakeSocket(),
        timers,
      });

      const result = yield* adapter.execute(
        { kind: "delete-project", organization, projectId: "project", ...commandBase },
        context(),
      );

      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        url: expect.stringMatching(/\/project\/project$/),
        init: { method: "DELETE" },
      });
      expect(result.result).toEqual({ kind: "delete-project", value: undefined });
    }),
  );

  // Several requests in one command — its services, the org's keys, a key, the import — have a
  // minute between them, not one request's 15 s (`commandDeadlineMs`).
  it.effect("gives a Mate's container import a minute, and a project's creation its 15 s", () =>
    Effect.gen(function* () {
      const stageTimers = new ManualTimers();
      const adapter = makeZeropsDataAdapter({
        client: clientFor((_url, init) => pendingUntilAbort(init?.signal)),
        makeSocket: () => new FakeSocket(),
        timers: stageTimers,
      });
      const importing = yield* adapter
        .execute(
          {
            kind: "import-development-container",
            project,
            projectName: "Acme Docs - Ada",
            ...commandBase,
          },
          context(),
        )
        .pipe(Effect.result, Effect.forkChild);
      yield* waitForTimer(stageTimers, 60_000);
      expect(stageTimers.delays()).toEqual([60_000]);
      stageTimers.fire(60_000);
      expect(yield* Fiber.join(importing)).toMatchObject({
        _tag: "Failure",
        failure: { message: "Zerops command exceeded its deadline." },
      });

      const creating = yield* adapter
        .execute(
          { kind: "create-project", organization, name: "Acme", tagList: [], ...commandBase },
          context(),
        )
        .pipe(Effect.result, Effect.forkChild);
      yield* waitForTimer(stageTimers, 15_000);
      expect(stageTimers.delays()).toEqual([15_000]);
      stageTimers.fire(15_000);
      yield* Fiber.join(creating);
    }),
  );

  it.effect(
    "reports an accepted malformed start-project response as non-retryable uncertainty",
    () =>
      Effect.gen(function* () {
        let requestCount = 0;
        const client = clientFor(() => {
          requestCount += 1;
          return new Response('{"success":true}', { status: 200 });
        });
        const adapter = makeZeropsDataAdapter({
          client,
          makeSocket: () => new FakeSocket(),
          timers,
        });

        const result = yield* adapter.execute(startProjectCommand, context()).pipe(Effect.result);

        expect(result).toMatchObject({
          _tag: "Failure",
          failure: {
            kind: "uncertain",
            retryable: false,
            message: expect.stringContaining("accepted the start"),
          },
        });
        expect(requestCount).toBe(1);
      }),
  );

  it.effect("returns typed Project results and feeds their facets into shared observation", () =>
    Effect.gen(function* () {
      const requests: RequestInit[] = [];
      const client = clientFor((_url, init) => {
        requests.push(init ?? {});
        // The first read finds no marker; the write and its read-back carry it.
        return new Response(
          JSON.stringify({
            id: "project",
            name: "application",
            status: "ACTIVE",
            tagList: requests.length === 1 ? [] : ["mate"],
          }),
          { status: 200 },
        );
      });
      const adapter = makeZeropsDataAdapter({
        client,
        makeSocket: () => new FakeSocket(),
        timers,
      });

      const receipt = yield* adapter.execute(declareMateCommand, context());

      expect(requests.map((request) => request.method ?? "GET")).toEqual(["GET", "PUT", "GET"]);
      expect(receipt.result).toMatchObject({
        kind: "update-project-tags",
        value: { kind: "written", project: { id: "project", tagList: ["mate"] } },
      });
      expect(receipt.observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "project-presentation-observed",
            ref: project,
            observation: expect.objectContaining({
              source: "command-response",
              command: declareMateCommand,
            }),
          }),
        ]),
      );
    }),
  );

  // Set up Mate on a plain project (restored over 116a2c54c): the press declares the Mate on the
  // tags the write's own fresh read holds, and its PUT carries them back with the marker — an
  // owner's tags are theirs; only an earlier client's `mate:*` metadata tags go.
  it.effect("declares a Mate on a plain project keeping its own tags", () =>
    Effect.gen(function* () {
      const requests: RequestInit[] = [];
      const client = clientFor((_url, init) => {
        requests.push(init ?? {});
        return new Response(
          JSON.stringify({
            id: "project",
            name: "shop",
            status: "ACTIVE",
            tagList:
              requests.length === 1
                ? ["billing:team-a", "mate:face:rose:seal"]
                : ["billing:team-a", "mate"],
          }),
          { status: 200 },
        );
      });
      const adapter = makeZeropsDataAdapter({
        client,
        makeSocket: () => new FakeSocket(),
        timers,
      });

      yield* adapter.execute(declareMateCommand, context());

      expect(requests.map((request) => request.method ?? "GET")).toEqual(["GET", "PUT", "GET"]);
      expect(String(requests[1]?.body)).toContain(`"tagList":["billing:team-a","mate"]`);
    }),
  );

  // D3: a Mate's rename is its project's, through the one writer of the project's record.
  it.effect("renames a project on a fresh read, its tags put back, as a typed Project result", () =>
    Effect.gen(function* () {
      const requests: RequestInit[] = [];
      const client = clientFor((_url, init) => {
        requests.push(init ?? {});
        return new Response(
          JSON.stringify({
            id: "project",
            name: requests.length === 1 ? "Snap - Nova" : "Nova",
            status: "ACTIVE",
            tagList: ["mate"],
          }),
          { status: 200 },
        );
      });
      const adapter = makeZeropsDataAdapter({
        client,
        makeSocket: () => new FakeSocket(),
        timers,
      });
      const rename: PlatformCommand = {
        kind: "rename-project",
        project,
        name: "Nova",
        ...commandBase,
      };

      const receipt = yield* adapter.execute(rename, context());

      expect(requests.map((request) => request.method ?? "GET")).toEqual(["GET", "PUT", "GET"]);
      expect(String(requests[1]?.body)).toContain(
        '"name":"Nova","description":"","tagList":["mate"]',
      );
      expect(receipt.result).toMatchObject({
        kind: "rename-project",
        value: { kind: "written", project: { id: "project", name: "Nova" } },
      });
    }),
  );

  it.effect("validates import command results before exposing typed success", () =>
    Effect.gen(function* () {
      const responses: unknown[] = [
        { projectId: "imported-project" },
        { serviceStacks: [{ processes: [{ id: "process-1" }] }] },
      ];
      const client = clientFor(
        () => new Response(JSON.stringify(responses.shift()), { status: 200 }),
      );
      const adapter = makeZeropsDataAdapter({
        client,
        makeSocket: () => new FakeSocket(),
        timers,
      });
      const imported = yield* adapter.execute(
        { kind: "import-project", organization, yaml: "project: {}", ...commandBase },
        context(),
      );
      const services = yield* adapter.execute(
        { kind: "import-services", project, yaml: "services: []", ...commandBase },
        context(),
      );

      expect(imported.result).toEqual({
        kind: "import-project",
        value: { projectId: "imported-project" },
      });
      expect(services.result).toEqual({ kind: "import-services", value: undefined });
    }),
  );

  it.effect("reports malformed accepted import results as non-retryable uncertainty", () =>
    Effect.gen(function* () {
      const responses: unknown[] = [{}, { serviceStacks: [{ processes: [{}] }] }];
      const client = clientFor(
        () => new Response(JSON.stringify(responses.shift()), { status: 200 }),
      );
      const adapter = makeZeropsDataAdapter({
        client,
        makeSocket: () => new FakeSocket(),
        timers,
      });
      const imported = yield* adapter
        .execute(
          { kind: "import-project", organization, yaml: "project: {}", ...commandBase },
          context(),
        )
        .pipe(Effect.result);
      const services = yield* adapter
        .execute(
          { kind: "import-services", project, yaml: "services: []", ...commandBase },
          context(),
        )
        .pipe(Effect.result);

      expect(imported).toMatchObject({
        _tag: "Failure",
        failure: { kind: "uncertain", retryable: false },
      });
      expect(services).toMatchObject({
        _tag: "Failure",
        failure: { kind: "uncertain", retryable: false },
      });
    }),
  );

  it.effect(
    "traverses the opened project's direct service pages and publishes one exhausted membership baseline",
    () =>
      Effect.gen(function* () {
        const bodies: Array<Record<string, unknown>> = [];
        const row = (index: number) => ({
          id: `service-${index}`,
          projectId: "project",
          name: `app-${index}`,
          status: "ACTIVE",
        });
        const client = clientFor((url) => {
          const body = Object.fromEntries(new URL(url).searchParams);
          bodies.push(body);
          const offset = Number(body.offset ?? 0);
          const items =
            offset === 0 ? Array.from({ length: 2000 }, (_, index) => row(index)) : [row(2000)];
          return new Response(
            JSON.stringify({ list: items, totalCount: 2001, limit: 2000, offset }),
            {
              status: 200,
            },
          );
        });
        const adapter = makeZeropsDataAdapter({
          client,
          makeSocket: () => new FakeSocket(),
          timers,
        });
        const result = yield* adapter.read(servicesTicket(), context());
        const baseline = result.observations.at(-1);
        expect(baseline).toMatchObject({
          kind: "query-baseline-observed",
          members: expect.arrayContaining([
            expect.objectContaining({ serviceId: "service-0" }),
            expect.objectContaining({ serviceId: "service-2000" }),
          ]),
          coverage: { kind: "exhausted-traversal", traversedPages: 2, observedTotal: 2001 },
        });
        expect(bodies.map(({ offset }) => Number(offset ?? 0))).toEqual([0, 2000]);
      }),
  );

  it.effect(
    "registers current and history metrics under distinct opaque names with native bodies",
    () =>
      Effect.gen(function* () {
        const sockets: FakeSocket[] = [];
        const requests: Array<{ readonly url: string; readonly body: string }> = [];
        const client = clientFor((url, init) => {
          if (url.endsWith("/web-socket/login"))
            return new Response('{"webSocketToken":"socket-token"}', { status: 200 });
          requests.push({ url, body: String(init?.body) });
          return new Response('{"items":[],"limit":500,"offset":0,"totalHits":0}', {
            status: 200,
          });
        });
        const adapter = makeZeropsDataAdapter({
          client,
          makeSocket: socketFactory(sockets),
          timers,
        });
        const current = {
          identity: interest,
          subscriptionName: ZeropsWireSubscriptionName.make("opaque/current"),
          descriptor: {
            kind: "current-metrics",
            query: {
              kind: "current-metrics-of-project",
              project,
              groupBy: "containerId",
              schemaVersion: 1,
            },
          },
          baselineTicket: servicesTicket(),
        } as RegistrationRequest;
        const history = {
          identity: interest,
          subscriptionName: ZeropsWireSubscriptionName.make("opaque/history"),
          descriptor: {
            kind: "metric-history",
            query: {
              kind: "metric-history-of-project",
              project,
              groupBy: "serviceStackId",
              window: { timeGroupBy: "1m", limit: 10, timeZone: "UTC" },
              schemaVersion: 1,
            },
          },
          baselineTicket: servicesTicket(),
        } as RegistrationRequest;

        yield* Effect.scoped(
          Effect.gen(function* () {
            const receiver = yield* adapter.openReceiver(
              scope,
              organization,
              receiverIdentity,
              context(),
            );
            yield* adapter.register(receiver, current, context());
            yield* adapter.register(receiver, history, context());
          }),
        );

        expect(requests[0]!.url).toMatch(/\/current-stats\/group-by-search$/);
        expect(requests[1]!.url).toMatch(/\/stats-history\/group-by-search$/);
        expect(requests[0]!.body).toContain('"subscriptionName":"opaque/current"');
        expect(requests[0]!.body).toContain('"groupBy":"containerId"');
        expect(requests[1]!.body).toContain('"subscriptionName":"opaque/history"');
        expect(requests[1]!.body).toContain('"groupBy":"serviceStackId"');
        expect(requests[1]!.body).toContain('"timeGroupBy":"1m"');
        expect(requests[1]!.body).not.toContain("billingEnabled");
      }),
  );

  it.effect("honors an already-aborted token request", () =>
    Effect.gen(function* () {
      const sockets: FakeSocket[] = [];
      const client = clientFor((_url, init) =>
        init?.signal?.aborted
          ? Promise.reject(new DOMException("aborted", "AbortError"))
          : new Response(JSON.stringify({ webSocketToken: "socket-token" }), { status: 200 }),
      );
      const adapter = makeZeropsDataAdapter({ client, makeSocket: socketFactory(sockets), timers });
      const controller = new AbortController();
      controller.abort();
      const exit = yield* Effect.exit(
        Effect.scoped(
          adapter.openReceiver(scope, organization, receiverIdentity, {
            abortSignal: controller.signal,
            deadlineMs: 4_000_000_000_000,
          }),
        ),
      );
      expect(exit).toMatchObject({ _tag: "Failure" });
      expect(sockets).toHaveLength(0);
    }),
  );

  it.effect("rejects already-expired token and HTTP contexts before network I/O", () =>
    Effect.gen(function* () {
      let requests = 0;
      const sockets: FakeSocket[] = [];
      const client = clientFor(() => {
        requests += 1;
        return new Response('{"webSocketToken":"socket-token"}', { status: 200 });
      });
      const adapter = makeZeropsDataAdapter({ client, makeSocket: socketFactory(sockets), timers });
      const expired: RequestContext = {
        abortSignal: new AbortController().signal,
        deadlineMs: 0,
      };

      const opened = yield* Effect.scoped(
        adapter.openReceiver(scope, organization, receiverIdentity, expired).pipe(Effect.result),
      );
      const read = yield* adapter.read(directServiceTicket(), expired).pipe(Effect.result);

      expect(opened).toMatchObject({ _tag: "Failure", failure: { kind: "timeout" } });
      expect(read).toMatchObject({ _tag: "Failure", failure: { kind: "timeout" } });
      expect(requests).toBe(0);
      expect(sockets).toHaveLength(0);
    }),
  );

  it.effect("caps the socket-open stage by the absolute context deadline", () =>
    Effect.gen(function* () {
      const deadlineTimers = new ManualTimers();
      const sockets: FakeSocket[] = [];
      const adapter = makeZeropsDataAdapter({
        client: clientFor(() => new Response('{"webSocketToken":"socket-token"}', { status: 200 })),
        makeSocket: () => {
          const socket = new FakeSocket();
          sockets.push(socket);
          return socket;
        },
        timers: deadlineTimers,
        policy: makeZeropsDataPolicy({ socketOpenDeadlineMs: 10_000 }),
      });
      const remainingAtStart = 250;
      const opening = yield* Effect.scoped(
        Clock.currentTimeMillis.pipe(
          Effect.flatMap((now) =>
            adapter
              .openReceiver(scope, organization, receiverIdentity, {
                abortSignal: new AbortController().signal,
                deadlineMs: now + remainingAtStart,
              })
              .pipe(Effect.result),
          ),
        ),
      ).pipe(Effect.forkChild);
      for (
        let attempt = 0;
        attempt < 20 && (sockets.length === 0 || deadlineTimers.delays().length === 0);
        attempt += 1
      )
        yield* Effect.yieldNow;
      const [scheduled] = deadlineTimers.delays();
      expect(scheduled).toBeDefined();
      expect(scheduled!).toBeGreaterThan(0);
      expect(scheduled!).toBeLessThanOrEqual(remainingAtStart);
      expect(scheduled!).toBeLessThan(10_000);
      deadlineTimers.fire(scheduled!);

      expect(yield* Fiber.join(opening)).toMatchObject({
        _tag: "Failure",
        failure: { kind: "socket-open" },
      });
      expect(sockets[0]!.closed).toBe(true);
    }),
  );

  it.effect("bounds token, socket open, and greeting stages independently", () =>
    Effect.gen(function* () {
      const tokenTimers = new ManualTimers();
      const tokenSockets: FakeSocket[] = [];
      const tokenAdapter = makeZeropsDataAdapter({
        client: clientFor((_url, init) => pendingUntilAbort(init?.signal)),
        makeSocket: socketFactory(tokenSockets),
        timers: tokenTimers,
        policy: makeZeropsDataPolicy({ socketTokenDeadlineMs: 101 }),
      });
      const tokenOpening = yield* Effect.scoped(
        tokenAdapter.openReceiver(scope, organization, receiverIdentity, context()),
      ).pipe(Effect.exit, Effect.forkChild);
      yield* waitForTimer(tokenTimers, 101);
      tokenTimers.fire(101);
      expect(yield* Fiber.join(tokenOpening)).toMatchObject({ _tag: "Failure" });
      expect(tokenSockets).toHaveLength(0);

      const openTimers = new ManualTimers();
      const openSocket = new FakeSocket();
      const openAdapter = makeZeropsDataAdapter({
        client: clientFor(() => new Response('{"webSocketToken":"socket-token"}', { status: 200 })),
        makeSocket: () => openSocket,
        timers: openTimers,
        policy: makeZeropsDataPolicy({ socketOpenDeadlineMs: 102 }),
      });
      const opening = yield* Effect.scoped(
        openAdapter.openReceiver(scope, organization, receiverIdentity, context()),
      ).pipe(Effect.exit, Effect.forkChild);
      yield* waitForTimer(openTimers, 102);
      openTimers.fire(102);
      expect(yield* Fiber.join(opening)).toMatchObject({ _tag: "Failure" });
      expect(openSocket.closed).toBe(true);

      const greetingTimers = new ManualTimers();
      const greetingSocket = new FakeSocket();
      const greetingAdapter = makeZeropsDataAdapter({
        client: clientFor(() => new Response('{"webSocketToken":"socket-token"}', { status: 200 })),
        makeSocket: () => {
          Promise.resolve().then(() => greetingSocket.onopen?.());
          return greetingSocket;
        },
        timers: greetingTimers,
        policy: makeZeropsDataPolicy({ socketGreetingDeadlineMs: 103 }),
      });
      const greeting = yield* Effect.scoped(
        greetingAdapter.openReceiver(scope, organization, receiverIdentity, context()),
      ).pipe(Effect.exit, Effect.forkChild);
      yield* waitForTimer(greetingTimers, 103);
      greetingTimers.fire(103);
      expect(yield* Fiber.join(greeting)).toMatchObject({ _tag: "Failure" });
      expect(greetingSocket.closed).toBe(true);
    }),
  );

  it.effect("bounds an individual registration and removes its provisional route", () =>
    Effect.gen(function* () {
      const deadlineTimers = new ManualTimers();
      const sockets: FakeSocket[] = [];
      const client = clientFor((url, init) =>
        url.endsWith("/web-socket/login")
          ? new Response('{"webSocketToken":"socket-token"}', { status: 200 })
          : pendingUntilAbort(init?.signal),
      );
      const adapter = makeZeropsDataAdapter({
        client,
        makeSocket: socketFactory(sockets),
        timers: deadlineTimers,
        policy: makeZeropsDataPolicy({ registrationDeadlineMs: 104 }),
      });
      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const receiver = yield* adapter.openReceiver(
            scope,
            organization,
            receiverIdentity,
            context(),
          );
          const request = updateRegistration("deadline-route");
          const registration = yield* adapter
            .register(receiver, request, context())
            .pipe(Effect.forkScoped);
          yield* Effect.yieldNow;
          deadlineTimers.fire(104);
          const first = yield* Fiber.await(registration);
          const second = yield* adapter
            .register(receiver, request, context())
            .pipe(Effect.forkScoped);
          yield* Effect.yieldNow;
          deadlineTimers.fire(104);
          return [first, yield* Fiber.await(second)] as const;
        }),
      );
      expect(result).toEqual([
        expect.objectContaining({ _tag: "Failure" }),
        expect.objectContaining({ _tag: "Failure" }),
      ]);
    }),
  );

  it.effect.each([
    ["answered 429", () => new Response("{}", { status: 429 }), "registration", 429],
    ["answered 503", () => new Response("{}", { status: 503 }), "server", 503],
    ["answered 403", () => new Response("{}", { status: 403 }), "forbidden", 403],
    [
      "lost on the network",
      () => Promise.reject(new TypeError("Failed to fetch")),
      "network",
      null,
    ],
    [
      "answered 200 without confirming",
      () => new Response("{}", { status: 200 }),
      "malformed",
      null,
    ],
  ] as const)(
    "a registration %s carries the status the platform refused it with, or none",
    ([, answer, kind, status]) =>
      Effect.gen(function* () {
        const sockets: FakeSocket[] = [];
        const client = clientFor((url) =>
          url.endsWith("/web-socket/login")
            ? new Response('{"webSocketToken":"socket-token"}', { status: 200 })
            : answer(),
        );
        const adapter = makeZeropsDataAdapter({
          client,
          makeSocket: socketFactory(sockets),
          timers,
        });
        const result = yield* Effect.scoped(
          Effect.gen(function* () {
            const receiver = yield* adapter.openReceiver(
              scope,
              organization,
              receiverIdentity,
              context(),
            );
            return yield* adapter
              .register(receiver, updateRegistration(), context())
              .pipe(Effect.result);
          }),
        );
        expect(result).toMatchObject({ _tag: "Failure", failure: { kind } });
        expect(Result.isFailure(result) ? (result.failure.status ?? null) : undefined).toBe(status);
      }),
  );

  it.effect(
    "falls back to /project/search when the direct projects-of-organization read is forbidden",
    () =>
      Effect.gen(function* () {
        const requests: Array<{ readonly url: string; readonly body: string | undefined }> = [];
        const client = clientFor((url, init) => {
          requests.push({ url, body: init?.body === undefined ? undefined : String(init.body) });
          if (url.includes("/client/"))
            return new Response(JSON.stringify({ message: "forbidden" }), { status: 403 });
          return new Response(
            JSON.stringify({
              items: [{ id: "project", name: "app", status: "ACTIVE" }],
              limit: 500,
              offset: 0,
              totalHits: 1,
            }),
            { status: 200 },
          );
        });
        const adapter = makeZeropsDataAdapter({
          client,
          makeSocket: () => new FakeSocket(),
          timers,
        });

        const result = yield* adapter.read(projectsTicket(), context());

        expect(requests[0]!.url).toContain("/client/");
        expect(requests[1]!.url).toMatch(/\/project\/search$/);
        expect(requests[1]!.body).toContain('"clientId","operator":"eq","value":"org"');
        expect(result.observations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: "project-identity-observed",
              observation: expect.objectContaining({ source: "indexed-search" }),
            }),
            expect.objectContaining({
              kind: "query-baseline-observed",
              source: "indexed-search",
              members: [expect.objectContaining({ projectId: "project" })],
            }),
          ]),
        );
      }),
  );

  // A 403 there is the platform's final answer for the person (E2E 2026-10-03: asked on every
  // read, it answered 403 about 8 times a minute), whichever read heard it first.
  it.effect(
    "asks a forbidden direct project list once: later reads, and the client's own, go to the search",
    () =>
      Effect.gen(function* () {
        const requests: string[] = [];
        const client = clientFor((url) => {
          requests.push(new URL(url).pathname);
          if (url.includes("/client/"))
            return new Response(JSON.stringify({ message: "forbidden" }), { status: 403 });
          return new Response(JSON.stringify({ items: [], totalHits: 0 }), { status: 200 });
        });
        const adapter = makeZeropsDataAdapter({
          client,
          makeSocket: () => new FakeSocket(),
          timers,
        });

        yield* adapter.read(projectsTicket(), context());
        yield* adapter.read(projectsTicket(), context());
        yield* Effect.promise(() => client.listAccessibleClientProjects("org"));

        expect(requests).toEqual([
          "/api/rest/public/client/org/project",
          "/api/rest/public/project/search",
          "/api/rest/public/project/search",
          "/api/rest/public/project/search",
        ]);
      }),
  );

  it.effect(
    "a forbidden read of the organization's services fails at once, never tried again",
    () =>
      Effect.gen(function* () {
        const requests: string[] = [];
        const client = clientFor((url) => {
          requests.push(url);
          return new Response(JSON.stringify({ message: "forbidden" }), { status: 403 });
        });
        const adapter = makeZeropsDataAdapter({
          client,
          makeSocket: () => new FakeSocket(),
          timers,
        });

        const exit = yield* adapter.read(servicesTicket(), context()).pipe(Effect.result);

        expect(exit).toMatchObject({ _tag: "Failure", failure: { kind: "forbidden" } });
        expect(requests.map((url) => new URL(url).pathname)).toEqual([
          "/api/rest/public/project/project/service-stack",
        ]);
      }),
  );

  it.effect("never surfaces the backend error message in an adapter error", () =>
    Effect.gen(function* () {
      const client = clientFor(
        () =>
          new Response(JSON.stringify({ message: "super secret internal detail" }), {
            status: 403,
          }),
      );
      const adapter = makeZeropsDataAdapter({
        client,
        makeSocket: () => new FakeSocket(),
        timers,
      });

      const exit = yield* adapter.read(servicesTicket(), context()).pipe(Effect.result);

      expect(exit).toMatchObject({
        _tag: "Failure",
        failure: {
          kind: "forbidden",
          message: "Zerops rejected the request (forbidden).",
        },
      });
      expect(Result.isFailure(exit) && exit.failure.message).not.toMatch(
        /super secret internal detail/,
      );
    }),
  );

  it.effect("keeps the platform's own words for a refusal it clearly gave, as no maybe", () =>
    Effect.gen(function* () {
      const client = clientFor(
        () =>
          new Response(
            JSON.stringify({ code: "invalidUserInput", message: "project name must be unique" }),
            { status: 400 },
          ),
      );
      const adapter = makeZeropsDataAdapter({
        client,
        makeSocket: () => new FakeSocket(),
        timers,
      });

      const exit = yield* adapter
        .execute(
          { kind: "import-project", organization, yaml: "project: {}", ...commandBase },
          context(),
        )
        .pipe(Effect.result);

      expect(exit).toMatchObject({
        _tag: "Failure",
        failure: {
          kind: "rejected",
          retryable: false,
          message: "Zerops refused the request: project name must be unique",
        },
      });
    }),
  );

  it.effect(
    "cancels an already-aborted command instead of reporting it as uncertain or timed out",
    () =>
      Effect.gen(function* () {
        let requests = 0;
        const client = clientFor(() => {
          requests += 1;
          return new Response(JSON.stringify({}), { status: 200 });
        });
        const adapter = makeZeropsDataAdapter({
          client,
          makeSocket: () => new FakeSocket(),
          timers,
        });
        const controller = new AbortController();
        controller.abort();

        const exit = yield* adapter
          .execute(
            {
              kind: "enable-subdomain-access",
              service: { kind: "service", project, serviceId: ZeropsServiceId.make("service") },
              ...commandBase,
            },
            { abortSignal: controller.signal, deadlineMs: 4_000_000_000_000 },
          )
          .pipe(Effect.result);

        expect(exit).toMatchObject({ _tag: "Failure", failure: { kind: "cancelled" } });
        expect(requests).toBe(0);
      }),
  );
});

describe("an organization past one page of its search", () => {
  it.effect(
    "registers once and reads the rest page by page into one exhausted baseline of 2,500 services",
    () =>
      Effect.gen(function* () {
        const sockets: FakeSocket[] = [];
        const bodies: Array<Record<string, unknown>> = [];
        const row = (index: number) => ({
          id: `service-${index}`,
          projectId: "project",
          name: `app-${index}`,
          status: "ACTIVE",
        });
        const client = clientFor((url, init) => {
          if (url.endsWith("/web-socket/login"))
            return new Response('{"webSocketToken":"socket-token"}', { status: 200 });
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          bodies.push(body);
          const offset = (body.offset as number | undefined) ?? 0;
          const limit = body.limit as number;
          const items = Array.from(
            { length: Math.max(0, Math.min(limit, 2500 - offset)) },
            (_, index) => row(offset + index),
          );
          return new Response(JSON.stringify({ items, totalHits: 2500, limit, offset }), {
            status: 200,
          });
        });
        const adapter = makeZeropsDataAdapter({
          client,
          makeSocket: socketFactory(sockets),
          timers,
        });
        const receipt = yield* Effect.scoped(
          Effect.gen(function* () {
            const receiver = yield* adapter.openReceiver(
              scope,
              organization,
              receiverIdentity,
              context(),
            );
            return yield* adapter.register(
              receiver,
              {
                identity: interest,
                subscriptionName: ZeropsWireSubscriptionName.make("opaque-services"),
                descriptor: {
                  kind: "query-membership",
                  query: {
                    kind: "services-of-project",
                    project: {
                      kind: "project",
                      organization,
                      projectId: ZeropsProjectId.make("project"),
                    },
                    schemaVersion: 1,
                  },
                },
                baselineTicket: servicesTicket(),
              } as RegistrationRequest,
              context(),
            );
          }),
        );
        const baseline = receipt.responseObservations.at(-1) as {
          readonly members: ReadonlyArray<{ readonly serviceId: string }>;
        };

        expect(baseline).toMatchObject({
          kind: "query-baseline-observed",
          coverage: { kind: "exhausted-traversal", observedTotal: 2500 },
        });
        expect(new Set(baseline.members.map((member) => member.serviceId)).size).toBe(2500);
        // One registration, then plain searches for what is past its page: never a second one.
        expect(
          bodies.map((body) => ({
            registers: "subscriptionName" in body,
            offset: body.offset ?? 0,
          })),
        ).toEqual([
          { registers: true, offset: 0 },
          { registers: false, offset: 2000 },
        ]);
      }),
  );
});

describe("one malformed row of the organization's", () => {
  const good = { id: "service", projectId: "project", name: "app", status: "ACTIVE" };
  /** A row of a project this person may not even see, missing its status. */
  const broken = { id: "other-service", projectId: "elsewhere", name: "db" };

  it.effect("is dropped from a registration's baseline, which keeps the rest and succeeds", () =>
    Effect.gen(function* () {
      const sockets: FakeSocket[] = [];
      const client = clientFor((url) =>
        url.endsWith("/web-socket/login")
          ? new Response('{"webSocketToken":"socket-token"}', { status: 200 })
          : new Response(
              JSON.stringify({ items: [good, broken], limit: 2000, offset: 0, totalHits: 2 }),
              { status: 200 },
            ),
      );
      const adapter = makeZeropsDataAdapter({ client, makeSocket: socketFactory(sockets), timers });
      const receipt = yield* Effect.scoped(
        Effect.gen(function* () {
          const receiver = yield* adapter.openReceiver(
            scope,
            organization,
            receiverIdentity,
            context(),
          );
          return yield* adapter.register(
            receiver,
            {
              identity: interest,
              subscriptionName: ZeropsWireSubscriptionName.make("opaque-services"),
              descriptor: {
                kind: "query-membership",
                query: {
                  kind: "services-of-project",
                  project: {
                    kind: "project",
                    organization,
                    projectId: ZeropsProjectId.make("project"),
                  },
                  schemaVersion: 1,
                },
              },
              baselineTicket: servicesTicket(),
            } as RegistrationRequest,
            context(),
          );
        }),
      );
      const baseline = receipt.responseObservations.at(-1);

      expect(baseline).toMatchObject({
        kind: "query-baseline-observed",
        members: [expect.objectContaining({ serviceId: "service" })],
        coverage: { kind: "exhausted-traversal" },
      });
    }),
  );

  it.effect("in an update frame is dropped, and never says the socket is malformed", () =>
    Effect.gen(function* () {
      const sockets: FakeSocket[] = [];
      const client = clientFor(
        (url) =>
          new Response(
            JSON.stringify(
              url.endsWith("/web-socket/login")
                ? { webSocketToken: "socket-token" }
                : { success: true },
            ),
            { status: 200 },
          ),
      );
      const adapter = makeZeropsDataAdapter({ client, makeSocket: socketFactory(sockets), timers });
      const events = yield* Effect.scoped(
        Effect.gen(function* () {
          const receiver = yield* adapter.openReceiver(
            scope,
            organization,
            receiverIdentity,
            context(),
          );
          const request = updateRegistration();
          yield* adapter.register(receiver, request, context());
          sockets[0]!.receive({
            type: "search",
            subscriptionName: request.subscriptionName,
            data: { update: [broken, good] },
          });
          sockets[0]!.receive({ type: "pong" });
          return Array.from(
            yield* Stream.runCollect(
              Stream.takeUntil(receiver.events, (event) => event.kind === "pong"),
            ),
          );
        }),
      );

      expect(events.map((event) => event.kind)).not.toContain("malformed");
      expect(events.some((event) => event.kind === "observation")).toBe(true);
    }),
  );
});

describe("the entity table's streams", () => {
  const variables = {
    kind: "service-variables-of-services" as const,
    organization,
    serviceIds: ["s-1", "s-2", "service", "service-a", "app", "mate"],
    keys: ["ZCP_MATE_ENABLED", "appVersionId"],
    schemaVersion: 1 as const,
  };
  const variablesTicket = (): ReadTicket =>
    ({
      kind: "baseline",
      requestId: ZeropsRequestId.make("variables-read"),
      owner: { kind: "interest", identity: interest },
      target: { kind: "query", descriptor: variables },
      receiptOrdinalAtStart: ReceiptOrdinal.make(0),
      membershipReceiptOrdinalAtStart: ReceiptOrdinal.make(0),
      readStartOrdinal: ReadStartOrdinal.make(1),
      dispatchOrdinal: DispatchOrdinal.make(1),
      startedAtMs: 0,
    }) as ReadTicket;

  it.effect(
    "registers a kind's list and updates by organization and takes its frames without a read",
    () =>
      Effect.gen(function* () {
        const sockets: FakeSocket[] = [];
        const requests: Array<{ readonly url: string; readonly body: string }> = [];
        const client = clientFor((url, init) => {
          if (url.endsWith("/web-socket/login"))
            return new Response('{"webSocketToken":"socket-token"}', { status: 200 });
          requests.push({ url, body: String(init?.body) });
          return new Response(
            url.endsWith("/user-data/search") && String(init?.body).includes("listStream")
              ? JSON.stringify({
                  items: [
                    { id: "u-0", serviceStackId: "s-1", key: "appVersionId", content: "v-1" },
                  ],
                  limit: 2000,
                  offset: 0,
                  totalHits: 1,
                })
              : '{"success":true}',
            { status: 200 },
          );
        });
        const adapter = makeZeropsDataAdapter({
          client,
          makeSocket: socketFactory(sockets),
          timers,
        });
        const list = {
          identity: interest,
          subscriptionName: ZeropsWireSubscriptionName.make("opaque/list"),
          descriptor: { kind: "table-list", query: variables },
          baselineTicket: variablesTicket(),
        } as RegistrationRequest;
        const updates = {
          identity: interest,
          subscriptionName: ZeropsWireSubscriptionName.make("opaque/variables"),
          descriptor: {
            kind: "table-updates",
            entity: "user-data",
            organization,
            serviceIds: variables.serviceIds,
          },
          baselineTicket: null,
        } as RegistrationRequest;

        const { answered, events } = yield* Effect.scoped(
          Effect.gen(function* () {
            const receiver = yield* adapter.openReceiver(
              scope,
              organization,
              receiverIdentity,
              context(),
            );
            const answered = yield* adapter.register(receiver, list, context());
            yield* adapter.register(receiver, updates, context());
            sockets[0]!.receive({
              type: "search",
              subscriptionName: "opaque/list",
              data: { add: ["u-2"], delete: ["u-0"] },
            });
            sockets[0]!.receive({
              type: "search",
              subscriptionName: "opaque/variables",
              data: {
                update: [
                  { id: "u-1", serviceStackId: "s-1", key: "ZCP_MATE_ENABLED", content: "1" },
                ],
              },
            });
            const events = yield* Stream.runCollect(Stream.take(receiver.events, 3));
            return { answered, events: Array.from(events) };
          }),
        );

        expect(requests.map(({ url }) => new URL(url).pathname.replace(/^.*public/, ""))).toEqual([
          "/user-data/search",
          "/user-data/search",
        ]);
        expect(decodeBody(requests[0]!.body).search).toContainEqual({
          name: "serviceStackId",
          operator: "in",
          value: variables.serviceIds,
        });
        expect(requests[0]!.body).toContain('"wsOutputType":"listStream"');
        expect(requests[0]!.body).toContain('"subscriptionName":"opaque/list"');
        expect(decodeBody(requests[1]!.body).search).toContainEqual({
          name: "serviceStackId",
          operator: "in",
          value: variables.serviceIds,
        });
        expect(requests[1]!.body).toContain('"wsOutputType":"updateStream"');
        expect(answered.responseObservations).toEqual([
          expect.objectContaining({
            kind: "table-rows-observed",
            entity: "user-data",
            source: "direct-read",
            rows: [
              { id: "u-0", serviceId: "s-1", projectId: null, key: "appVersionId", content: "v-1" },
            ],
            coverage: expect.objectContaining({ kind: "exhausted-traversal" }),
          }),
        ]);
        const observed = events.flatMap((event) =>
          event.kind === "observation" ? [event.input] : [],
        );
        expect(observed).toEqual([
          expect.objectContaining({
            kind: "table-membership-observed",
            operation: "add",
            id: "u-2",
          }),
          expect.objectContaining({
            kind: "table-membership-observed",
            operation: "remove",
            id: "u-0",
          }),
          expect.objectContaining({
            kind: "table-rows-observed",
            entity: "user-data",
            source: "native-push",
            rows: [
              {
                id: "u-1",
                serviceId: "s-1",
                projectId: null,
                key: "ZCP_MATE_ENABLED",
                content: "1",
              },
            ],
          }),
        ]);
      }),
  );
});
