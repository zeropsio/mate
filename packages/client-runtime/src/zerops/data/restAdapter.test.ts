// @effect-diagnostics globalTimers:off -- the adapter requires an injected timer port; these tests own it.
import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
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

const nameProjectCommand: PlatformCommand = {
  kind: "name-project-agent",
  project,
  name: "Ada",
  attemptId: ZeropsCommandAttemptId.make("name-attempt"),
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
    descriptor: { kind: "entity-updates", entity: "service", organization },
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
      descriptor: { kind: "services-of-project", project, schemaVersion: 1 },
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

  it.effect("returns the accepted restart Process ref and command-response observations", () =>
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
      expect(result.processRefs).toEqual([
        expect.objectContaining({ kind: "process", processId: "independent-process-id" }),
      ]);
      expect(result.observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "process-lifecycle-observed",
            ref: expect.objectContaining({ processId: "independent-process-id" }),
            observation: expect.objectContaining({
              source: "command-response",
              command: restartCommand,
              fields: expect.objectContaining({ status: "PENDING" }),
            }),
          }),
        ]),
      );
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

  it.effect("returns typed Project results and feeds their facets into shared observation", () =>
    Effect.gen(function* () {
      const requests: RequestInit[] = [];
      const client = clientFor((_url, init) => {
        requests.push(init ?? {});
        return new Response(
          JSON.stringify({
            id: "project",
            name: "application",
            status: "ACTIVE",
            tagList: ["mate", "mate:bot:Ada"],
          }),
          { status: 200 },
        );
      });
      const adapter = makeZeropsDataAdapter({
        client,
        makeSocket: () => new FakeSocket(),
        timers,
      });

      const receipt = yield* adapter.execute(nameProjectCommand, context());

      expect(requests.map((request) => request.method ?? "GET")).toEqual(["GET", "PUT"]);
      expect(receipt.result).toMatchObject({
        kind: "name-project-agent",
        value: { id: "project", tagList: ["mate", "mate:bot:Ada"] },
      });
      expect(receipt.observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "project-presentation-observed",
            ref: project,
            observation: expect.objectContaining({
              source: "command-response",
              command: nameProjectCommand,
            }),
          }),
        ]),
      );
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
      expect(services.processRefs).toEqual([
        expect.objectContaining({ processId: "process-1", project }),
      ]);
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

  it.effect("traverses direct pagination and publishes one exhausted membership baseline", () =>
    Effect.gen(function* () {
      const firstPage = Array.from({ length: 500 }, (_, index) => ({
        id: `service-${index}`,
        projectId: "project",
        name: `app-${index}`,
        status: "ACTIVE",
      }));
      const client = clientFor(
        (url) =>
          new Response(
            JSON.stringify({
              list: url.includes("offset=500")
                ? [{ id: "service-500", projectId: "project", name: "last", status: "ACTIVE" }]
                : firstPage,
              totalCount: 501,
            }),
            { status: 200 },
          ),
      );
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
          expect.objectContaining({ serviceId: "service-500" }),
        ]),
        coverage: { kind: "exhausted-traversal", traversedPages: 2, observedTotal: 501 },
      });
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

  it.effect("does not retry a forbidden services-of-project read through search", () =>
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
      expect(requests).toHaveLength(1);
      expect(requests.some((url) => url.includes("/search"))).toBe(false);
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
